import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  attachSpace,
  authStatus,
  authedFetch,
  captureSpaceCode,
  changePassword,
  clearSpaceResetFlag,
  getSpaceCode,
  getWsToken,
  isAuthDisabled,
  login,
  logout,
  rotateSpaceCode,
  setAuthDisabled,
  setSpaceCode,
  setReloadPageForTests,
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

describe('认证与门开关', () => {
  beforeEach(() => {
    localStorage.clear()
    setAuthDisabled(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('authStatus 解析门开关与口令来源', async () => {
    stubFetch(async () =>
      jsonResponse({
        data: {
          configured: true,
          authRequired: true,
          source: 'env',
          canChangePassword: true,
          rotationLogsOutEveryone: true,
        },
      }),
    )
    const status = await authStatus()
    expect(status.authRequired).toBe(true)
    expect(status.configured).toBe(true)
    expect(status.source).toBe('env')
  })

  it('门关着的实例：authRequired=false、source=disabled', async () => {
    stubFetch(async () =>
      jsonResponse({
        data: {
          configured: false,
          authRequired: false,
          source: 'disabled',
          canChangePassword: false,
          rotationLogsOutEveryone: false,
        },
      }),
    )
    const status = await authStatus()
    expect(status.authRequired).toBe(false)
    expect(status.source).toBe('disabled')
  })

  it('旧后端没有 authRequired 字段时按「要口令」处理（绝不因字段缺失把门敞开）', async () => {
    stubFetch(async () =>
      jsonResponse({ data: { configured: true, source: 'env', canChangePassword: true } }),
    )
    const status = await authStatus()
    expect(status.authRequired).toBe(true)
  })

  it('门关着时不带令牌、但照样带空间码，且无本地会话也能启动', async () => {
    setAuthDisabled(true)
    expect(isAuthDisabled()).toBe(true)

    setSpaceCode('space-code-off')
    const mock = stubFetch(async () => jsonResponse({ ok: true }))
    await authedFetch('/api/space/me')

    const headers = new Headers(callInit(mock).headers)
    expect(headers.get('Authorization')).toBeNull()
    expect(headers.get('X-Space-Code')).toBe('space-code-off')

    // 没有本地会话也要能过 verifySession（服务端不校验令牌）
    const verifyMock = stubFetch(async () => jsonResponse({ data: { sub: 'visitor' } }))
    await expect(verifySession()).resolves.toBe(true)
    expect(new Headers(callInit(verifyMock).headers).get('Authorization')).toBeNull()
  })

  it('门关着时 WS 令牌不带 Authorization（否则会把人误导成「必须登录」）', async () => {
    setAuthDisabled(true)
    const mock = stubFetch(async () => jsonResponse({ token: 'ws-token', expiresIn: 600 }))

    await expect(getWsToken()).resolves.toBe('ws-token')
    expect(callUrl(mock)).toBe('/api/ws-token')
    expect(new Headers(callInit(mock).headers).get('Authorization')).toBeNull()
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
      return jsonResponse({
        id: 'space-9',
        createdAt: '',
        lastSeenAt: '',
        isLegacy: false,
        counts: [],
      })
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
    // 用**真实信封**做夹具：外层 `code` 是数字状态码，空间码在 `data.code` 里。
    // 曾经写成 `body.code ?? body.data?.code`，于是把 0 当成了空间码 ——
    // 服务端换了码、界面还显示旧码，用户存下来的是失效码。
    stubFetch(async () =>
      jsonResponse({ success: true, code: 0, data: { code: 'new-code' }, msg: 'success' }),
    )

    expect(await rotateSpaceCode()).toBe('new-code')
    expect(getSpaceCode()).toBe('new-code')
  })

  it('rotateSpaceCode 遇到没有 data.code 的响应要报错，而不是存下垃圾', async () => {
    setSpaceCode('old-code')
    stubFetch(async () => jsonResponse({ success: false, code: 500, data: null, msg: 'boom' }))

    await expect(rotateSpaceCode()).rejects.toThrow('服务端未返回新空间码')
    expect(getSpaceCode()).toBe('old-code')
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
    stubFetch(async () =>
      jsonResponse({ authenticated: true }, 200, { 'x-space-code': 'fresh-code-1' }),
    )
    expect(await verifySession()).toBe(true)

    expect(getSpaceCode()).toBe('fresh-code-1')
  })

  it('空间码失效时清码并刷新一次，而不是把用户卡在 400', async () => {
    stubFetch(async () => jsonResponse({ token: 't', expiresIn: 3600 }))
    await login('correct-password')
    setSpaceCode('dead-code')

    stubFetch(async () =>
      jsonResponse({ error: 'invalid space code' }, 400, { 'x-space-invalid': '1' }),
    )
    expect(await verifySession()).toBe(false)

    expect(getSpaceCode()).toBeNull()
    expect(reloadCount).toBe(1)
  })
})
