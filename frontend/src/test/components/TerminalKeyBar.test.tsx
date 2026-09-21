import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyTerminalKeyModifiers, TerminalKeyBar } from '../../components/terminal/TerminalKeyBar'

describe('TerminalKeyBar', () => {
  it('默认顺序优先中断、退出、补全和方向键', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalKeyBar, {
        collapsed: true,
        onToggle: vi.fn(),
        onSend: vi.fn(),
        onPaste: vi.fn(),
      }),
    )
    expect(html.indexOf('Ctrl')).toBeLessThan(html.indexOf('Alt'))
    expect(html.indexOf('Alt')).toBeLessThan(html.indexOf('Tab'))
    expect(html.indexOf('Tab')).toBeLessThan(html.indexOf('Esc'))
    expect(html).toContain('Enter')
    expect(html).toContain('粘贴')
    expect(html).not.toContain('Home')
  })

  it('展开后提供导航和清屏键', () => {
    const html = renderToStaticMarkup(
      createElement(TerminalKeyBar, {
        collapsed: false,
        onToggle: vi.fn(),
        onSend: vi.fn(),
        onPaste: vi.fn(),
      }),
    )
    expect(html).toContain('Home')
    expect(html).toContain('End')
    expect(html).toContain('PgUp')
    expect(html).toContain('Ctrl+L')
    expect(html).toContain('C')
    for (const label of ['Ins', 'Del', '-', '|', '/', '..', '()', '[]', '{}']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('&amp;&amp;')
    expect(html).toContain('&gt;&gt;')
    expect(html).toContain('overflow-x-auto')
  })

  it('applies Ctrl and Alt as one-shot modifiers for literal quick keys', () => {
    expect(applyTerminalKeyModifiers('c', new Set(['ctrl']))).toBe('')
    expect(applyTerminalKeyModifiers('d', new Set(['alt']))).toBe('d')
    expect(applyTerminalKeyModifiers('[A', new Set(['ctrl']))).toBe('[A')
  })
})
