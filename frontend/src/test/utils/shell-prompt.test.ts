import { describe, expect, it } from 'vitest'
import { isAtShellPrompt, type TerminalBufferLike } from '../../utils/shell-prompt'

/**
 * 造一个假 buffer：lines 是全部行（自 0 开始），cursorY 相对 baseY。
 *
 * ⚠️ 忠实模拟 xterm 6.0 的真实行为：`translateToString(true)` **不会**去掉行尾空白
 * —— 实测 bash 提示符 `admin@fnos:~$ `（行尾一个空格）原样返回。
 * 这个 mock 曾经"好心"替 xterm 做了 trim，于是单测全绿、真机上自动注入从未触发过。
 */
function makeBuffer(
  lines: string[],
  opts: { cursorY?: number; baseY?: number; type?: string } = {},
): TerminalBufferLike {
  const { cursorY = 0, baseY = 0, type = 'normal' } = opts
  return {
    type,
    baseY,
    cursorY,
    getLine(y: number) {
      const text = lines[y]
      if (text === undefined) return undefined
      return {
        translateToString: () => text,
      }
    },
  }
}

describe('isAtShellPrompt', () => {
  it('识别常见 shell 提示符行尾', () => {
    expect(isAtShellPrompt(makeBuffer(['user@host:~$ ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['root@host:/# ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['[me@host ~]% ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['PS C:\\Users\\me> ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['~/proj on  main ❯ ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['➜  proj git:(main)']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['λ ']))).toBe(true)
  })

  it('真实 xterm 的行尾空白不能让判定失效（回归：mock 曾替 xterm trim）', () => {
    // xterm 6.0 的真实返回：`admin@fnos:~$ ` 带行尾空格；`translateToString(true)` 不会去掉它。
    // 线上实测：自动注入因此从未触发，20 服务 compose pull 往 scrollback 堆了 3000+ 行重复块。
    expect(isAtShellPrompt(makeBuffer(['admin@fnos:~$ ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['admin@fnos:~$   ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['root@nas:/tmp# ']))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(['me@host:~$ \u00a0']))).toBe(true)
  })

  it('非提示符行判否（密码提示 / 命令输出 / 续行符）', () => {
    expect(isAtShellPrompt(makeBuffer(['me@host password: ']))).toBe(false)
    expect(isAtShellPrompt(makeBuffer(['Password:']))).toBe(false)
    expect(isAtShellPrompt(makeBuffer(['Building 3/5']))).toBe(false)
    expect(isAtShellPrompt(makeBuffer(['docker compose pull']))).toBe(false)
    expect(isAtShellPrompt(makeBuffer(['[sudo] password for me:']))).toBe(false)
    expect(isAtShellPrompt(makeBuffer(['> ']))).toBe(true) // PowerShell 续提示符：保守判"可注入"
  })

  it('备用屏（vim/htop/less）一律判否，即使末行像提示符', () => {
    expect(isAtShellPrompt(makeBuffer(['user@host:~$ '], { type: 'alternate' }))).toBe(false)
  })

  it('从光标行往上取第一条非空行', () => {
    const lines = ['user@host:~$ ', 'docker compose pull', '', '', '']
    // 光标停在最后一行（空行）→ 回溯到第 2 行输出 → 判否
    expect(isAtShellPrompt(makeBuffer(lines, { cursorY: 4 }))).toBe(false)
    // 光标停在提示符行
    expect(isAtShellPrompt(makeBuffer(lines, { cursorY: 0 }))).toBe(true)
  })

  it('baseY 参与定位（滚动后光标行是绝对行号 baseY + cursorY）', () => {
    const lines = ['old output', 'still output', 'user@host:~$ ']
    expect(isAtShellPrompt(makeBuffer(lines, { baseY: 2, cursorY: 0 }))).toBe(true)
    expect(isAtShellPrompt(makeBuffer(lines, { baseY: 0, cursorY: 0 }))).toBe(false)
  })

  it('空 buffer / null / 抛错时 fail-closed', () => {
    expect(isAtShellPrompt(makeBuffer(['', '   '], { cursorY: 1 }))).toBe(false)
    expect(isAtShellPrompt(null)).toBe(false)
    expect(isAtShellPrompt(undefined)).toBe(false)
    const throwing: TerminalBufferLike = {
      type: 'normal',
      baseY: 0,
      cursorY: 0,
      getLine() {
        throw new Error('disposed')
      },
    }
    expect(isAtShellPrompt(throwing)).toBe(false)
  })

  it('type 缺失时按 normal 处理（老版本 buffer 兼容）', () => {
    const buf = makeBuffer(['user@host:~$ '])
    delete (buf as { type?: string }).type
    expect(isAtShellPrompt(buf)).toBe(true)
  })
})
