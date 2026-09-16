import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { OpenAccessNotice } from '../../components/OpenAccessNotice'

let _authDisabled = true

vi.mock('../../services/auth', () => ({
  isAuthDisabled: vi.fn(() => _authDisabled),
}))

function renderNotice() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(<OpenAccessNotice />)
  return {
    container,
    cleanup: () => {
      root.unmount()
      if (container.parentNode) document.body.removeChild(container)
    },
  }
}

describe('OpenAccessNotice', () => {
  beforeEach(() => {
    localStorage.clear()
    _authDisabled = true
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('提示本实例未设入口口令（并说明能连的机器由出口白名单决定）', async () => {
    const { container, cleanup } = renderNotice()
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="open-access-notice"]')).not.toBeNull()
    })
    expect(container.textContent).toContain('未设入口口令')
    expect(container.textContent).toContain('出口白名单')
    cleanup()
  })

  it('门开着（有口令）时完全不出现', async () => {
    _authDisabled = false
    const { container, cleanup } = renderNotice()
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-testid="open-access-notice"]')).toBeNull()
    cleanup()
  })

  it('可以关掉，且关闭状态被记住', async () => {
    const first = renderNotice()
    await vi.waitFor(() => {
      expect(
        first.container.querySelector('[data-testid="open-access-notice-close"]'),
      ).not.toBeNull()
    })
    first.container
      .querySelector<HTMLButtonElement>('[data-testid="open-access-notice-close"]')!
      .click()
    await vi.waitFor(() => {
      expect(first.container.querySelector('[data-testid="open-access-notice"]')).toBeNull()
    })
    expect(localStorage.getItem('wrench_open_access_notice_dismissed')).toBe('1')
    first.cleanup()

    // 重新挂载（相当于刷新页面）：仍然不显示
    const second = renderNotice()
    await new Promise((r) => setTimeout(r, 20))
    expect(second.container.querySelector('[data-testid="open-access-notice"]')).toBeNull()
    second.cleanup()
  })
})
