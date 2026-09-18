import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TerminalKeyBar } from '../../components/terminal/TerminalKeyBar'

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
    expect(html.indexOf('Ctrl+C')).toBeLessThan(html.indexOf('Ctrl+D'))
    expect(html.indexOf('Ctrl+D')).toBeLessThan(html.indexOf('Tab'))
    expect(html.indexOf('Tab')).toBeLessThan(html.indexOf('Esc'))
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
  })
})
