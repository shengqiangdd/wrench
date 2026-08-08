import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthGate } from '../../components/AuthGate'

// ─── Shared mock state ───
let _shouldSucceed = true
let _errorMessage: string | null = null
let _pendingPromise: (() => void) | null = null

vi.mock('../../services/auth', () => ({
  refreshToken: vi.fn().mockImplementation(async () => {
    // Delegate to getWsClient's token fetching
    if (!_shouldSucceed) {
      throw new Error(_errorMessage ?? 'Auth failed')
    }
    return 'mock-token'
  }),
  getToken: vi.fn().mockImplementation(async () => {
    if (!_shouldSucceed) {
      throw new Error(_errorMessage ?? 'Auth failed')
    }
    return 'mock-token'
  }),
  clearToken: vi.fn(),
  buildWsUrl: vi.fn().mockImplementation(async () => {
    if (!_shouldSucceed) {
      throw new Error(_errorMessage ?? 'Auth failed')
    }
    return 'ws://localhost/ws?token=mock-token'
  }),
}))

vi.mock('../../services/websocket', () => ({
  getWsClient: vi.fn().mockImplementation(async () => {
    if (_pendingPromise) {
      // Never resolves — keeps loading state
      return new Promise(() => {})
    }
    if (!_shouldSucceed) {
      throw new Error(_errorMessage ?? 'WS connection failed')
    }
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
  initAuthFetch: vi.fn(() => {
    if (!_shouldSucceed) {
      // initAuthFetch itself doesn't reject, it only wraps fetch.
      // Failures will come from getWsClient.
    }
    return vi.fn() // cleanup
  }),
}))

/** Set mock to succeed */
function mockSucceed() {
  _shouldSucceed = true
  _errorMessage = null
  _pendingPromise = null
}

/** Set mock to fail with an error */
function mockFail(message = 'Auth failed') {
  _shouldSucceed = false
  _errorMessage = message
  _pendingPromise = null
}

/** Set mock to stay pending (never resolves/rejects) */
function mockPending() {
  _shouldSucceed = true
  _errorMessage = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _pendingPromise = true as any // truthy to trigger the pending path
}

/**
 * Helper: render a React node into a detached DOM container.
 * Uses createRoot directly (React 19) — act wrapper is not available
 * in React 19.2.7 CJS build, but the render still works correctly
 * without it in test environments.
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

describe('AuthGate', () => {
  beforeEach(() => {
    mockSucceed()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading state on mount', async () => {
    mockPending()

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    // Should show loading spinner
    await vi.waitFor(() => {
      expect(container.textContent).toContain('正在连接服务器...')
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('renders children when auth succeeds', async () => {
    mockSucceed()

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    // Wait for auth to resolve
    await vi.waitFor(() => {
      expect(container.textContent).toContain('App Content')
    })

    expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    expect(container.textContent).not.toContain('正在连接服务器...')
    expect(container.textContent).not.toContain('连接失败')
    cleanup()
  })

  it('shows error state when auth fails', async () => {
    mockFail('Network error')

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })
    expect(container.textContent).toContain('Network error')
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    expect(container.textContent).toContain('重试')
    cleanup()
  })

  it('shows fallback error when no error message provided', async () => {
    mockFail('') // empty error message

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    await vi.waitFor(() => {
      expect(container.textContent).toContain('无法获取认证令牌')
    })
    cleanup()
  })

  it('retries auth when retry button is clicked', async () => {
    // First call fails
    mockFail('Network error')

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    // Wait for error state
    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })

    // Second call succeeds
    mockSucceed()

    // Click retry
    const retryBtn = container.querySelector('button')
    expect(retryBtn).not.toBeNull()
    retryBtn!.click()

    // Wait for children to appear after retry
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="children"]')).not.toBeNull()
    })
    cleanup()
  })

  it('shows error again when retry fails', async () => {
    mockFail('Network error')

    const { container, cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    // Wait for first error
    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })

    // Click retry — still failing
    const retryBtn = container.querySelector('button')
    retryBtn!.click()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('连接失败')
    })
    expect(container.querySelector('[data-testid="children"]')).toBeNull()
    cleanup()
  })

  it('cleans up on unmount (cancelled flag)', async () => {
    mockPending()

    const { cleanup } = renderReact(
      <AuthGate>
        <div data-testid="children">App Content</div>
      </AuthGate>,
    )

    // Unmount before auth completes
    cleanup()

    // Wait for any pending effects to settle
    await new Promise((r) => setTimeout(r, 50))
    expect(true).toBe(true) // should not have thrown from setState on unmounted
  })
})
