/**
 * TerminalPasteDialog —— 粘贴框 / 粘贴确认框（batch 2b ①）
 *
 * 两种模式共用一个组件，测试重点：
 * - reader：读不到剪贴板时能贴、能发、空内容禁发、说明文案区分 HTTP / 权限
 * - confirm：把内容摆出来 + 统计 + 危险项提醒；取消不发
 * - 通用：Esc / 遮罩关闭
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { TerminalPasteDialog } from '../../components/terminal/TerminalPasteDialog'

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  root.unmount()
  container.parentNode?.removeChild(container)
})

const q = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)
const settle = () => new Promise<void>((r) => setTimeout(r, 10))

function click(el: Element | null) {
  if (!el) throw new Error('元素不存在')
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

async function render(props: Parameters<typeof TerminalPasteDialog>[0]) {
  root.render(<TerminalPasteDialog {...props} />)
  await settle()
}

describe('TerminalPasteDialog', () => {
  describe('reader 模式（HTTP / 无权限时把内容贴进来）', () => {
    it('HTTP 访问的说明指向粘贴框，而不是让人去按 Ctrl+V 了事', async () => {
      await render({
        mode: 'reader',
        reason: 'unsupported',
        onSubmit: vi.fn(),
        onClose: vi.fn(),
      })
      const note = q('paste-dialog-note')?.textContent ?? ''
      expect(note).toContain('HTTP')
      expect(note).toContain('粘贴')
      expect(q('paste-dialog-textarea')).not.toBeNull()
    })

    it('权限被拒时文案不同', async () => {
      await render({ mode: 'reader', reason: 'denied', onSubmit: vi.fn(), onClose: vi.fn() })
      expect(q('paste-dialog-note')?.textContent).toContain('权限')
    })

    it('空内容时「发送到终端」禁用', async () => {
      const onSubmit = vi.fn()
      await render({ mode: 'reader', onSubmit, onClose: vi.fn() })
      const send = q('paste-dialog-send') as HTMLButtonElement
      expect(send.disabled).toBe(true)
      click(send)
      expect(onSubmit).not.toHaveBeenCalled()
    })

    it('贴进来的内容按原样提交（含多行）', async () => {
      const onSubmit = vi.fn()
      await render({ mode: 'reader', onSubmit, onClose: vi.fn() })
      const ta = q('paste-dialog-textarea') as HTMLTextAreaElement
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(ta, 'docker ps\nkubectl get pods')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      expect(q('paste-dialog-stats')?.textContent).toContain('2 行')
      click(q('paste-dialog-send'))
      expect(onSubmit).toHaveBeenCalledWith('docker ps\nkubectl get pods')
    })

    it('边贴边提示危险命令', async () => {
      await render({ mode: 'reader', onSubmit: vi.fn(), onClose: vi.fn() })
      const ta = q('paste-dialog-textarea') as HTMLTextAreaElement
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set
      setter?.call(ta, 'rm -rf /tmp/x')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await settle()
      expect(q('paste-dialog-danger')?.textContent).toContain('rm -rf')
    })
  })

  describe('confirm 模式（多行 + 远端没开 bracketed paste）', () => {
    it('摆出内容与统计，确认后按原文本提交', async () => {
      const onSubmit = vi.fn()
      await render({ mode: 'confirm', text: 'cd /tmp\nrm -rf build', onSubmit, onClose: vi.fn() })
      expect(q('paste-dialog-preview')?.textContent).toContain('cd /tmp')
      expect(q('paste-dialog-stats')?.textContent).toContain('2 行')
      expect(q('paste-dialog-stats')?.textContent).toContain('1 条会立即执行')
      click(q('paste-dialog-send'))
      expect(onSubmit).toHaveBeenCalledWith('cd /tmp\nrm -rf build')
    })

    it('超长内容预览截断但说明总行数', async () => {
      const text = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n')
      await render({ mode: 'confirm', text, onSubmit: vi.fn(), onClose: vi.fn() })
      expect(q('paste-dialog-preview')?.textContent).toContain('共 30 行')
    })

    it('取消不发任何东西', async () => {
      const onSubmit = vi.fn()
      const onClose = vi.fn()
      await render({ mode: 'confirm', text: 'a\nb', onSubmit, onClose })
      click(q('paste-dialog-cancel'))
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('Esc 关闭', async () => {
    const onClose = vi.fn()
    await render({ mode: 'reader', onSubmit: vi.fn(), onClose })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
