import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from '../../components/AuthGate'

// ─── Shared mock state ───
let _authenticated = true
let _sessionValid = true
let _verifyError: Error | null = null
let _pendingVerify = false
let _loginError: Error | null = null
let _wsError: Error | null = null

vi.mock('../../services/auth', () => ({
  AUTH_REQUIRED_EVENT: 'wrench:auth-required',
  isAuthenticated: vi.fn(() => _authenticated),
  verifySession: vi.fn(async () => {
    if (_pendingVerify) return new Promise<boolean>(() => {})
    if (_verifyError) throw _verifyError
    return _sessionValid
  }),
  login: vi.fn(async (password: string) => {
    if (_loginError) throw _loginError
    if (password !== 'correct-password') throw new Error('密码错误')
    _authenticated = true
    _sessionValid = true
  }),
  notifyAuthRequired: vi.fn(),
  clearToken: vi.fn(),
  getToken: vi.fn(async () => 'mock-token'),
  getWsToken: vi.fn(async () => 'mock-ws-token'),
  buildWsUrl: vi.fn(async () => 'ws://localhost/ws?token=mock-ws-token'),
}))

vi.mock('../../services/websocket', () => ({
  getWsClient: vi.fn(async () => {
    if (_wsError) throw _wsError
    return {
      connect: vi.fn(),
      send: vi.fn(),
      on: vi.fn(() => vi.fn()),
      status: 'connected' as const,
    }
  }),
  getWsClientSync: vi.fn(() => ({
    connect: vi.fn(),
    send: vi.fn(),
    on: vi.fn(() => vi.fn()),
    status: 'disconnected' as const,
  })),
}))

vi.mock('../../services/initAuthFetch', () => ({
  initAuthFetch: vi.fn(() => vi.fn()),
}))

/** 已登录且会话有效 */
function mockLoggedIn() {
  _authenticated = true
  _sessionValid = true
  _verifyError = null
  _pendingVerify = false
  _loginError = null
  _wsError = null
}

/** 未登录 */
function mockLoggedOut() {
  _authenticated = false
  _sessionValid = false
  _verifyError = null
  _pendingVerify = false
  _loginError = null
  _wsError = null
}

/** 有本地会话但服务端已不接受 */
function mockStaleSession() {
  mockLoggedIn()
  _sessionValid = false
}

/**
 * Helper: render a React node into a detached DOM container.
 */
function renderReact(node: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(node)
  return {
    container,
    root,
    cleanup: () => {
      root.unmount()
      if (container.parentNode) {
        document.body.removeChild(container)
      }
    },
  }
}

/**
 * 模拟用户输入：React 追踪 input.value 的原生 setter，直接赋值不会触发 onChange，
 * 因此这里用原型上的 setter 再派发 input 事件。
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function renderGate(containerText?: string) {
  return renderReact(
    <AuthGate>
      <div data-testid="children">{containerText ?? 'App Content'}</div>
    </AuthGate>,
  )
}

describe('AuthGate', () => {
  beforeEach(() => {
    mockLoggedIn()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows login form when no session exists', async () => {
    mockLoggedOut()

    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-password"]')).not.toBeNull()
    })
    expect(container.textContent).toContain('请输入访问密码')
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('shows loading state while verifying the session', async () => {
    mockLoggedIn()
    _pendingVerify = true

    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('正在连接服务器...')
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('renders children when the session is valid', async () => {
    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('App Content')
    })
    expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    cleanup()
  })

  it('falls back to the login form when the server rejects the stored session', async () => {
    mockStaleSession()

    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-password"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('logs in and renders children on correct password', async () => {
    mockLoggedOut()

    const { container, cleanup } = renderGate()
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-password"]')).not.toBeNull()
    })

    const input = container.querySelector<HTMLInputElement>('[data-testid="login-password"]')!
    typeInto(input, 'correct-password')

    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="login-submit"]')!.disabled,
      ).toBe(false)
    })

    container
      .querySelector<HTMLFormElement>('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })
    cleanup()
  })

  it('shows an error message on wrong password', async () => {
    mockLoggedOut()

    const { container, cleanup } = renderGate()
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-password"]')).not.toBeNull()
    })

    const input = container.querySelector<HTMLInputElement>('[data-testid="login-password"]')!
    typeInto(input, 'wrong-password')
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLButtonElement>('[data-testid="login-submit"]')!.disabled,
      ).toBe(false)
    })

    container
      .querySelector<HTMLFormElement>('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(container.textContent).toContain('密码错误')
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('shows error state when WebSocket init fails', async () => {
    mockLoggedIn()
    _wsError = new Error('Network error')

    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })
    expect(container.textContent).toContain('Network error')
    expect(container.querySelector('[data-testid="retry"]')).not.toBeNull()
    cleanup()
  })

  it('retries boot when the retry button is clicked', async () => {
    mockLoggedIn()
    _wsError = new Error('Network error')

    const { container, cleanup } = renderGate()
    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })

    // 服务恢复后重试应成功
    _wsError = null
    container.querySelector<HTMLButtonElement>('[data-testid="retry"]')!.click()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })
    cleanup()
  })

  it('returns to the login form when auth-required is dispatched', async () => {
    const { container, cleanup } = renderGate()
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })

    window.dispatchEvent(new CustomEvent('wrench:auth-required', { detail: { reason: '401' } }))

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-password"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })
})
