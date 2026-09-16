/**
 * TerminalDisplayMenu —— 终端右上「显示」菜单（批次 2a：去术语 + 就地可调）
 *
 * 这个组件只做**入口聚合与措辞**，状态全部由 Terminal.tsx 持有：
 * 所以测试重点在「面板开关、开关状态映射、回调参数、边界禁用」，
 * 而不是几何或注入逻辑（那些在 terminal-canvas / quiet-env 的单测里）。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { TerminalDisplayMenu } from '../../components/terminal/TerminalDisplayMenu'
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN } from '../../utils/terminal-prefs'

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

interface Handlers {
  onToggleCanvas: ReturnType<typeof vi.fn<() => void>>
  onTogglePlain: ReturnType<typeof vi.fn<() => void>>
  onFontSizeChange: ReturnType<typeof vi.fn<(delta: number | 'reset') => void>>
}

async function render(
  overrides: Partial<{
    canvasOn: boolean
    plainOn: boolean
    fontSize: number
  }> = {},
): Promise<Handlers> {
  const handlers: Handlers = {
    onToggleCanvas: vi.fn<() => void>(),
    onTogglePlain: vi.fn<() => void>(),
    onFontSizeChange: vi.fn<(delta: number | 'reset') => void>(),
  }
  root.render(
    <TerminalDisplayMenu
      canvasOn={overrides.canvasOn ?? true}
      plainOn={overrides.plainOn ?? false}
      fontSize={overrides.fontSize ?? FONT_SIZE_DEFAULT}
      defaultFontSize={FONT_SIZE_DEFAULT}
      {...handlers}
    />,
  )
  await new Promise<void>((r) => setTimeout(r, 10))
  return handlers
}

const q = (testid: string) => container.querySelector(`[data-testid="${testid}"]`)

/**
 * 组件内所有交互都走 pointerdown（移动端合成 click 会被吞）。
 * jsdom 没有 PointerEvent，用同名的 MouseEvent 派发 —— React 按事件类型找
 * onPointerDown，读不到的 `pointerType` 在组件里也没被用到。
 */
function tap(el: Element | null) {
  if (!el) throw new Error('元素不存在')
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
}

describe('TerminalDisplayMenu', () => {
  it('默认只显示「显示」芯片，面板收起', async () => {
    await render()
    expect(q('terminal-display-chip')?.textContent).toContain('显示')
    expect(q('terminal-display-panel')).toBeNull()
  })

  it('沿用内部机制名之外的措辞（不出现 plain / 画布 字样）', async () => {
    await render()
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    const text = q('terminal-display-panel')?.textContent ?? ''
    expect(text).toContain('进度原地刷新')
    expect(text).toContain('日志逐行输出')
    expect(text).not.toContain('plain')
    expect(text).not.toContain('画布')
  })

  it('开关的 aria-checked 与 state 对齐（贴屏 + 逐行日志）', async () => {
    await render({ canvasOn: false, plainOn: true })
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(q('display-toggle-canvas')?.getAttribute('aria-checked')).toBe('false')
    expect(q('display-toggle-plain')?.getAttribute('aria-checked')).toBe('true')
  })

  it('点击两个开关分别回调（不关面板，方便连点）', async () => {
    const h = await render()
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    tap(q('display-toggle-canvas'))
    tap(q('display-toggle-plain'))
    expect(h.onToggleCanvas).toHaveBeenCalledTimes(1)
    expect(h.onTogglePlain).toHaveBeenCalledTimes(1)
  })

  it('字号 ± / 复位都按 delta 形式回调', async () => {
    const h = await render({ fontSize: 14 })
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(q('display-font-size')?.textContent).toBe('14px')
    tap(q('display-font-larger'))
    expect(h.onFontSizeChange).toHaveBeenLastCalledWith(1)
    tap(q('display-font-smaller'))
    expect(h.onFontSizeChange).toHaveBeenLastCalledWith(-1)
    tap(q('display-font-reset'))
    expect(h.onFontSizeChange).toHaveBeenLastCalledWith('reset')
  })

  it('到边界时按钮禁用且不再回调', async () => {
    const h = await render({ fontSize: FONT_SIZE_MIN })
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    const smaller = q('display-font-smaller') as HTMLButtonElement
    expect(smaller.disabled).toBe(true)
    tap(smaller)
    expect(h.onFontSizeChange).not.toHaveBeenCalled()
  })

  it('到上限时 + 禁用', async () => {
    await render({ fontSize: FONT_SIZE_MAX })
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect((q('display-font-larger') as HTMLButtonElement).disabled).toBe(true)
  })

  it('Esc 收起面板', async () => {
    await render()
    tap(q('terminal-display-chip'))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(q('terminal-display-panel')).not.toBeNull()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise<void>((r) => setTimeout(r, 10))
    expect(q('terminal-display-panel')).toBeNull()
  })

  it('非默认状态时芯片点亮（收起时也能看出改过）', async () => {
    await render({ canvasOn: false })
    expect(q('terminal-display-chip')?.className).toContain('bg-sky-600')
    await render({ canvasOn: true, plainOn: true })
    expect(q('terminal-display-chip')?.className).toContain('bg-sky-600')
    await render({ canvasOn: true, plainOn: false })
    expect(q('terminal-display-chip')?.className).toContain('bg-slate-800')
  })
})
