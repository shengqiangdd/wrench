/**
 * terminal-paste —— 粘贴策略纯函数（batch 2b ①）
 *
 * 这里的每条分支都对应一个真实场景，改动前先想清楚会被谁踩到：
 * HTTP 部署（读不到剪贴板）、多行脚本（每个换行都是一次执行）、
 * 远端开了 bracketed paste（shell 端整块显示）、Windows 复制源的 CRLF。
 */
import { describe, expect, it } from 'vitest'
import {
  analyzePaste,
  decidePaste,
  decidePasteText,
  describeClipboardFailure,
  formatPasteStats,
  normalizePastedText,
  pasteSentHint,
  previewPaste,
} from '../../utils/terminal-paste'

describe('normalizePastedText', () => {
  it('CRLF / 单独 CR 都规范成 LF', () => {
    expect(normalizePastedText('a\r\nb\rc')).toBe('a\nb\nc')
  })
})

describe('analyzePaste', () => {
  it('单行：1 行、0 条立即执行', () => {
    const stats = analyzePaste('docker ps')
    expect(stats).toMatchObject({ chars: 9, lines: 1, nonEmptyLines: 1, executeNow: 0 })
  })

  it('末尾换行不算多一行，但会立即执行', () => {
    const stats = analyzePaste('docker ps\n')
    expect(stats.lines).toBe(1)
    expect(stats.executeNow).toBe(1)
  })

  it('多行：行数 = 去掉末尾换行后的行数，executeNow = 换行数', () => {
    const stats = analyzePaste('a\nb\nc\n')
    expect(stats).toMatchObject({ lines: 3, nonEmptyLines: 3, executeNow: 3 })
  })

  it('空行不计入 nonEmptyLines，但换行照样执行', () => {
    const stats = analyzePaste('a\n\n\n')
    expect(stats.lines).toBe(1)
    expect(stats.nonEmptyLines).toBe(1)
    expect(stats.executeNow).toBe(3)
  })

  it('纯空白视为没有内容', () => {
    expect(analyzePaste('   \n  ').chars).toBe(6)
  })

  it('CRLF 复制源按 LF 计数（Windows 里粘一段脚本不该多出幻影行）', () => {
    expect(analyzePaste('a\r\nb').lines).toBe(2)
    expect(analyzePaste('a\r\nb').executeNow).toBe(1)
  })

  it('识别破坏性命令（只提示，不阻断）', () => {
    expect(analyzePaste('rm -rf /tmp/x').dangers).toContain('rm -rf')
    expect(analyzePaste('sudo rm -fr /var').dangers).toContain('rm -rf')
    expect(analyzePaste('dd if=/dev/zero of=/dev/sda').dangers).toContain('dd of=/dev/…')
    expect(analyzePaste('curl https://x.sh | sh').dangers).toContain('curl | sh')
    expect(analyzePaste('chmod -R 777 /').dangers).toContain('chmod -R 777 /')
  })

  it('普通脚本不误报', () => {
    expect(analyzePaste('docker compose up -d\nkubectl get pods').dangers).toEqual([])
  })

  it('危险项最多保留 3 条（对话框里不刷屏）', () => {
    const stats = analyzePaste('rm -rf /\nmkfs.ext4 /dev/sda\nreboot\nshutdown now')
    expect(stats.dangers.length).toBeLessThanOrEqual(3)
  })
})

describe('formatPasteStats', () => {
  it('单行只说行数', () => {
    expect(formatPasteStats(analyzePaste('ls'))).toBe('1 行')
  })

  it('多行给出"其中 N 条会立即执行"', () => {
    expect(formatPasteStats(analyzePaste('a\nb\nc'))).toBe('3 行 · 其中 2 条会立即执行')
  })

  it('空内容给「没有内容」', () => {
    expect(formatPasteStats(analyzePaste(''))).toBe('没有内容')
  })
})

describe('previewPaste', () => {
  it('超过上限时截断并标记', () => {
    const text = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const preview = previewPaste(text, 12)
    expect(preview.truncated).toBe(true)
    expect(preview.text.split('\n')).toHaveLength(12)
  })

  it('不超上限时原样返回', () => {
    expect(previewPaste('a\nb', 12)).toEqual({ text: 'a\nb', truncated: false })
  })
})

describe('decidePasteText', () => {
  it('单行直接发送', () => {
    const d = decidePasteText('docker ps', { bracketed: false })
    expect(d).toMatchObject({ kind: 'send', hint: '已粘贴到终端' })
  })

  it('多行 + 远端没开 bracketed paste → 先确认（每个换行都会执行）', () => {
    const d = decidePasteText('a\nb\nc', { bracketed: false })
    expect(d.kind).toBe('confirm')
  })

  it('多行 + 远端开了 bracketed paste → 直接发送，提示里说清"回车才执行"', () => {
    const d = decidePasteText('a\nb\nc', { bracketed: true })
    expect(d).toMatchObject({ kind: 'send' })
    if (d.kind === 'send') {
      expect(d.hint).toContain('3 行')
      expect(d.hint).toContain('回车才执行')
    }
  })

  it('空 / 纯空白 → empty（不往终端发空字节）', () => {
    expect(decidePasteText('', { bracketed: false }).kind).toBe('empty')
    expect(decidePasteText('  \n ', { bracketed: false }).kind).toBe('empty')
  })
})

describe('decidePaste（剪贴板读取结果）', () => {
  it('读不到 → 去粘贴框，并带上原因', () => {
    expect(decidePaste({ ok: false, reason: 'unsupported' }, { bracketed: false })).toEqual({
      kind: 'reader',
      reason: 'unsupported',
    })
    expect(decidePaste({ ok: false, reason: 'denied' }, { bracketed: true })).toEqual({
      kind: 'reader',
      reason: 'denied',
    })
  })

  it('读到了 → 走文本判定', () => {
    expect(decidePaste({ ok: true, text: 'ls' }, { bracketed: false }).kind).toBe('send')
    expect(decidePaste({ ok: true, text: 'a\nb' }, { bracketed: false }).kind).toBe('confirm')
  })
})

describe('文案', () => {
  it('HTTP 与权限被拒的原因不同、该做的事都写在提示里', () => {
    const http = describeClipboardFailure('unsupported')
    expect(http).toContain('HTTP')
    expect(http).toContain('粘贴')
    const denied = describeClipboardFailure('denied')
    expect(denied).toContain('权限')
  })

  it('发送后的提示能区分「整块显示」与「已执行 N 条」', () => {
    expect(pasteSentHint('a\nb', true)).toContain('回车才执行')
    expect(pasteSentHint('a\nb', false)).toContain('已立即执行 1 条')
  })
})
