import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

import AccountSection from '../../modules/settings/AccountSection'

let _spaceCode: string | null = 'space-code-abc'
let _attachError: Error | null = null

vi.mock('../../services/auth', () => ({
  getSession: vi.fn(() => ({ token: 't', exp: Date.now() + 3600_000 })),
  logout: vi.fn(),
  getSpaceCode: vi.fn(() => _spaceCode),
  getSpaceInfo: vi.fn(async () => ({
    id: 'space-1',
    createdAt: '2026-09-12T10:00:00Z',
    lastSeenAt: '2026-09-12T11:00:00Z',
    isLegacy: false,
    counts: [{ table: 'ssh_connections', count: 3 }],
  })),
  attachSpace: vi.fn(async (code: string) => {
    if (_attachError) throw _attachError
    _spaceCode = code.toLowerCase()
    return {
      id: 'space-2',
      createdAt: '2026-01-01T00:00:00Z',
      lastSeenAt: '2026-01-01T00:00:00Z',
      isLegacy: false,
      counts: [],
    }
  }),
  rotateSpaceCode: vi.fn(async () => {
    _spaceCode = 'rotated-code-xyz'
    return _spaceCode
  }),
  changePassword: vi.fn(async (current: string) => {
    if (current !== 'right') throw new Error('当前口令不正确')
  }),
  wasSpaceReset: vi.fn(() => false),
  clearSpaceResetFlag: vi.fn(),
  // 组件切换空间后会刷新页面；单测里拦下，别让 jsdom 报导航未实现
  reloadPage: vi.fn(),
}))

vi.mock('../../services/websocket', () => ({
  getWsClientSync: vi.fn(() => ({ disconnect: vi.fn() })),
}))

function render(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(node)
  return {
    container,
    cleanup: () => {
      root.unmount()
      container.remove()
    },
  }
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('AccountSection · 我的空间', () => {
  beforeEach(() => {
    _spaceCode = 'space-code-abc'
    _attachError = null
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('展示空间信息与空间码', async () => {
    const { container, cleanup } = render(<AccountSection />)

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-code"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="space-code"]')!.textContent).toBe('space-code-abc')
    expect(container.textContent).toContain('space-1')
    expect(container.textContent).toContain('3 条')
    cleanup()
  })

  it('提示本浏览器没有空间码时给出引导而不是留白', async () => {
    _spaceCode = null
    const { container, cleanup } = render(<AccountSection />)

    await vi.waitFor(() => {
      expect(container.textContent).toContain('本浏览器没有保存空间码')
    })
    expect(container.querySelector('[data-testid="space-code"]')).toBeNull()

    // 没码时也必须能拿到一个「可保存的新码」：否则数据虽在，却永远搬不到别的设备上
    const rotate = container.querySelector<HTMLButtonElement>('[data-testid="space-rotate"]')
    expect(rotate).not.toBeNull()
    rotate!.click()
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-code"]')?.textContent).toBe('rotated-code-xyz')
    })
    cleanup()
  })

  it('用空间码进入后展示新的空间码', async () => {
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-attach-input"]')).not.toBeNull()
    })

    typeInto(container.querySelector<HTMLInputElement>('[data-testid="space-attach-input"]')!, 'OTHER-CODE')

    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="space-attach"]')!.disabled,
      ).toBe(false)
    })
    container.querySelector<HTMLButtonElement>('[data-testid="space-attach"]')!.click()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-code"]')!.textContent).toBe('other-code')
    })
    cleanup()
  })

  it('空间码无效时给出可读错误', async () => {
    _attachError = new Error('空间码无效（可能拼错，或已被重新生成）')
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-attach-input"]')).not.toBeNull()
    })

    typeInto(container.querySelector<HTMLInputElement>('[data-testid="space-attach-input"]')!, 'nope')
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="space-attach"]')!.disabled,
      ).toBe(false)
    })
    container.querySelector<HTMLButtonElement>('[data-testid="space-attach"]')!.click()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('空间码无效')
    })
    cleanup()
  })

  it('重新生成空间码后立即展示新码', async () => {
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-rotate"]')).not.toBeNull()
    })

    container.querySelector<HTMLButtonElement>('[data-testid="space-rotate"]')!.click()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="space-code"]')!.textContent).toBe('rotated-code-xyz')
    })
    expect(container.textContent).toContain('旧码立即失效')
    cleanup()
  })
})

describe('AccountSection · 修改门户口令', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('两次输入不一致时本地拦下', async () => {
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="pw-current"]')).not.toBeNull()
    })

    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-current"]')!, 'right')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-new"]')!, 'new-password-1')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-confirm"]')!, 'new-password-2')
    container.querySelector<HTMLButtonElement>('[data-testid="pw-submit"]')!.click()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('两次输入的新口令不一致')
    })
    cleanup()
  })

  it('当前口令错误时展示服务端错误', async () => {
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="pw-current"]')).not.toBeNull()
    })

    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-current"]')!, 'wrong')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-new"]')!, 'new-password-1')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-confirm"]')!, 'new-password-1')
    container.querySelector<HTMLButtonElement>('[data-testid="pw-submit"]')!.click()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('当前口令不正确')
    })
    cleanup()
  })

  it('修改成功后给出明确反馈', async () => {
    const { container, cleanup } = render(<AccountSection />)
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="pw-current"]')).not.toBeNull()
    })

    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-current"]')!, 'right')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-new"]')!, 'new-password-1')
    typeInto(container.querySelector<HTMLInputElement>('[data-testid="pw-confirm"]')!, 'new-password-1')
    container.querySelector<HTMLButtonElement>('[data-testid="pw-submit"]')!.click()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('口令已更新')
    })
    cleanup()
  })
})
