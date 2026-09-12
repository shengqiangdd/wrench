import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  attachSpace,
  authStatus,
  authedFetch,
  captureSpaceCode,
  changePassword,
  clearSpaceResetFlag,
  getSpaceCode,
  login,
  logout,
  rotateSpaceCode,
  setSpaceCode,
  setReloadPageForTests,
  setupPassword,
  verifySession,
  wasSpaceReset,
} from '../../services/auth'

let reloadCount = 0
// jsdom 不支持真实导航：把刷新替换成计数器
setReloadPageForTests(() => {
  reloadCount += 1
})

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** 安装 mock fetch 并保留类型化的 calls，便于断言请求头/请求体 */
function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl)
  vi.stubGlobal('fetch', mock)
  return mock
}

function callInit(mock: ReturnType<typeof stubFetch>, index = 0): RequestInit {
  const init = mock.mock.calls[index]?.[1]
  if (!init) throw new Error(`fetch call #${index} had no init`)
  return init
}

function callUrl(mock: ReturnType<typeof stubFetch>, index = 0): string {
  const url = mock.mock.calls[index]?.[0]
  if (!url) throw new Error(`fetch call #${index} had no url`)
  return url
}

describe('空间码（私有空间凭据）', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('从响应头捕获服务端下发的空间码', () => {
    expect(getSpaceCode()).toBeNull()

    captureSpaceCode(jsonResponse({}, 200, { 'x-space-code': 'abc123' }))
    expect(getSpaceCode()).toBe('abc123')

    // 没有该头时不覆盖已有值
    captureSpaceCode(jsonResponse({}))
    expect(getSpaceCode()).toBe('abc123')

    setSpaceCode('def456')
    expect(getSpaceCode()).toBe('def456')
  })

  it('authedFetch 同时带 Authorization 与 X-Space-Code', async () => {
    stubFetch(async () => jsonResponse({ token: 'session-token', expiresIn: 3600 }))
    await login('correct-password')

    setSpaceCode('space-code-1')
    const mock = stubFetch(async () => jsonResponse({ ok: true }))

    await authedFetch('/api/connections')
    const headers = new Headers(callInit(mock).headers)
    expect(headers.get('Authorization')).toBe('Bearer session-token')
    expect(headers.get('X-Space-Code')).toBe('space-code-1')
  })

  it('首次请求时把响应里的新空间码落到本地，后续请求带上', async () => {
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 3600 }))
    await login('pw')

    stubFetch(async () => jsonResponse({ ok: true }, 200, { 'x-space-code': 'brand-new' }))
    await authedFetch('/api/connections')
    expect(getSpaceCode()).toBe('brand-new')
  })

  it('登录会把「记住此设备」一起发给服务端', async () => {
    const mock = stubFetch(async () => jsonResponse({ token: 't', expiresIn: 100 }))

    await login('pw', true)
    const body = JSON.parse(String(callInit(mock).body))
    expect(body).toEqual({ password: 'pw', remember: true })
  })
})

describe('认证与首次设置', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('authStatus 解析 setupRequired', async () => {
    stubFetch(async () =>
      jsonResponse({
        data: {
          configured: false,
          setupRequired: true,
          source: 'none',
          canChangePassword: true,
          rotationLogsOutEveryone: true,
        },
      }),
    )
    const status = await authStatus()
    expect(status.setupRequired).toBe(true)
    expect(status.source).toBe('none')
  })

  it('setupPassword 带上一次性 setup token 并保存会话', async () => {
    const mock = stubFetch(async () => jsonResponse({ token: 'setup-token-session', expiresIn: 60 }))

    await setupPassword('a-strong-password', 'one-time-token')

    const init = callInit(mock)
    expect(new Headers(init.headers).get('X-Setup-Token')).toBe('one-time-token')
    expect(JSON.parse(String(init.body))).toEqual({ password: 'a-strong-password' })

    // 会话已生效：后续受保护请求带得上令牌
    const next = stubFetch(async (_url, req) => {
      expect(new Headers(req?.headers).get('Authorization')).toBe('Bearer setup-token-session')
      return jsonResponse({ ok: true })
    })
    await authedFetch('/api/space/me')
    expect(next.mock.calls.length).toBe(1)
  })

  it('setupPassword 对无效令牌给出可读错误', async () => {
    stubFetch(async () => jsonResponse({ msg: 'bad' }, 401))
    await expect(setupPassword('a-strong-password', 'wrong')).rejects.toThrow('启动令牌无效')
  })

  it('changePassword 把两个口令发给服务端，401 提示当前口令错误', async () => {
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 10 }))
    await login('old-password')

    const mock = stubFetch(async () => jsonResponse({ ok: true }))
    await changePassword('old-password', 'new-password-1')
    expect(callUrl(mock)).toBe('/api/auth/password')
    expect(JSON.parse(String(callInit(mock).body))).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    })

    stubFetch(async () => jsonResponse({ msg: 'nope' }, 401))
    await expect(changePassword('wrong', 'new-password-1')).rejects.toThrow('当前口令不正确')
  })
})

describe('进入 / 切换空间', () => {
  beforeEach(async () => {
    localStorage.clear()
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 3600 }))
    await login('pw')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('attachSpace 成功后保存规范化后的空间码', async () => {
    stubFetch(async (url) => {
      if (url === '/api/space/attach') return jsonResponse({ ok: true })
      return jsonResponse({ id: 'space-9', createdAt: '', lastSeenAt: '', isLegacy: false, counts: [] })
    })

    const info = await attachSpace('  ABC-123  ')
    expect(info.id).toBe('space-9')
    expect(getSpaceCode()).toBe('abc-123')
  })

  it('attachSpace 把服务端的空间码错误透出来', async () => {
    stubFetch(async () => jsonResponse({ msg: '空间码无效或已失效' }, 400))
    await expect(attachSpace('nope')).rejects.toThrow('空间码无效或已失效')
  })

  it('attachSpace 遇到统一的 x-space-invalid 400 用固定文案', async () => {
    stubFetch(async () => jsonResponse({}, 400, { 'x-space-invalid': '1' }))
    await expect(attachSpace('nope')).rejects.toThrow('空间码无效（可能拼错，或已被重新生成）')
  })

  it('rotateSpaceCode 用新码覆盖本地保存的旧码', async () => {
    setSpaceCode('old-code')
    stubFetch(async () => jsonResponse({ code: 'new-code' }))

    expect(await rotateSpaceCode()).toBe('new-code')
    expect(getSpaceCode()).toBe('new-code')
  })

  it('空间码失效时清掉本地码并打标，避免用户卡在 400 上', async () => {
    sessionStorage.clear()
    reloadCount = 0
    setSpaceCode('dead-code')
    stubFetch(async () => jsonResponse({ msg: 'nope' }, 400, { 'x-space-invalid': '1' }))

    await authedFetch('/api/connections')

    expect(getSpaceCode()).toBeNull()
    expect(wasSpaceReset()).toBe(true)
    expect(reloadCount).toBe(1)
    clearSpaceResetFlag()
    expect(wasSpaceReset()).toBe(false)
  })

  it('logout 清空本地会话', async () => {
    expect(getSpaceCode()).not.toBe('x')
    logout()
    // 退出后受保护请求会要求重新登录
    stubFetch(async () => jsonResponse({}, 200))
    await expect(authedFetch('/api/connections')).rejects.toThrow()
  })
})

describe('启动路径必须捕获空间码（verifySession 早于 fetch 拦截器）', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    reloadCount = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('登录后首次 /auth/me 会把一次性下发的空间码落到本地', async () => {
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 3600 }))
    await login('correct-password')
    expect(getSpaceCode()).toBeNull()

    // 这一枪发生在 initAuthFetch() 安装之前，服务端正是在这里建空间并下发空间码；
    // 不在这里捕获 → cookie 已落地 → 之后永远不会再发 → 用户再也看不到自己的码。
    stubFetch(async () => jsonResponse({ authenticated: true }, 200, { 'x-space-code': 'fresh-code-1' }))
    expect(await verifySession()).toBe(true)

    expect(getSpaceCode()).toBe('fresh-code-1')
  })

  it('空间码失效时清码并刷新一次，而不是把用户卡在 400', async () => {
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 3600 }))
    await login('correct-password')
    setSpaceCode('dead-code')

    stubFetch(async () => jsonResponse({ error: 'invalid space code' }, 400, { 'x-space-invalid': '1' }))
    expect(await verifySession()).toBe(false)

    expect(getSpaceCode()).toBeNull()
    expect(reloadCount).toBe(1)
  })
})
