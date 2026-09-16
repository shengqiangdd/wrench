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
/** 服务端门开关：true = 需要口令；false = 零输入直进 */
let _authRequired = true
/** 服务端是否已配置口令（门开着时才有意义） */
let _configured = true
/** AuthGate 从 /api/auth/status 写入的本地标志 */
let _authDisabled = false

vi.mock('../../services/auth', () => ({
  AUTH_REQUIRED_EVENT: 'wrench:auth-required',
  isAuthenticated: vi.fn(() => _authenticated),
  verifySession: vi.fn(async () => {
    if (_pendingVerify) return new Promise<boolean>(() => {})
    if (_verifyError) throw _verifyError
    // 门关着时服务端不校验令牌：没有本地会话也算「可用」（真实实现同理）
    return _sessionValid || _authDisabled
  }),
  login: vi.fn(async (password: string, _remember: boolean = false) => {
    if (_loginError) throw _loginError
    if (password !== 'correct-password') throw new Error('密码错误')
    _authenticated = true
    _sessionValid = true
  }),
  authStatus: vi.fn(async () => ({
    configured: _configured,
    authRequired: _authRequired,
    source: !_authRequired ? 'disabled' : _configured ? 'env' : 'none',
    canChangePassword: _configured,
    rotationLogsOutEveryone: true,
  })),
  isAuthDisabled: vi.fn(() => _authDisabled),
  setAuthDisabled: vi.fn((value: boolean) => {
    _authDisabled = value
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
  _authRequired = true
  _configured = true
  _authDisabled = false
}

/** 未登录 */
function mockLoggedOut() {
  _authenticated = false
  _sessionValid = false
  _verifyError = null
  _pendingVerify = false
  _loginError = null
  _wsError = null
  _authRequired = true
  _configured = true
  _authDisabled = false
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

describe('AuthGate · 不设门（WRENCH_REQUIRE_AUTH=off）', () => {
  beforeEach(() => {
    mockLoggedOut() // 连本地会话都没有：门关着时也不该看到登录框
    _authRequired = false
    _authDisabled = false
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enters the app with zero input — no login, no setup form', async () => {
    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })
    expect(container.querySelector('[data-testid="login-password"]')).toBeNull()
    expect(container.textContent).not.toContain('请输入访问密码')
    cleanup()
  })

  it('records the disabled gate locally so 401 handling does not bounce users to a login box', async () => {
    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })
    expect(_authDisabled).toBe(true)

    // 门关着时收到 auth-required 事件：不能把用户丢回登录界面
    window.dispatchEvent(new CustomEvent('wrench:auth-required', { detail: { reason: '401' } }))
    await new Promise((r) => setTimeout(r, 10))
    expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="login-password"]')).toBeNull()
    cleanup()
  })
})

describe('AuthGate · 门开但部署侧没配口令', () => {
  beforeEach(() => {
    mockLoggedOut()
    _configured = false
    _authRequired = true
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks the deployer to configure — never the visitor', async () => {
    const { container, cleanup } = renderGate()

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="retry-config"]')).not.toBeNull()
    })
    // 使用者没有任何可填的东西：既没有登录框，也没有「设置口令」表单
    expect(container.querySelector('[data-testid="login-password"]')).toBeNull()
    expect(container.textContent).not.toContain('首次设置')
    // 两条出路都写清楚：设口令，或直接不设口令
    expect(container.textContent).toContain('WRENCH_AUTH_PASSWORD')
    expect(container.textContent).toContain('WRENCH_REQUIRE_AUTH=off')
    cleanup()
  })
})
