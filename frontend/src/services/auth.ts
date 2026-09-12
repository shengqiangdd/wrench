/**
 * Wrench 认证服务
 *
 * 认证模型（服务端校验，客户端只做缓存与刷新）:
 *   1. 登录：POST /api/auth/login { password } → 会话令牌（scope=`api+ws`，7 天）
 *   2. 会话令牌保存在 localStorage（`wrench_session`），REST 请求走 `Authorization: Bearer`
 *   3. WebSocket 需要令牌在 URL 查询串里，因此**不直接使用会话令牌**，
 *      而是用会话令牌换一个 10 分钟、scope=`ws` 的短时令牌（POST /api/ws-token），
 *      降低查询串泄露（浏览器历史 / 代理日志）的影响
 *   4. 令牌过期或被服务端吊销（例如口令已修改）→ 401 → 触发登录界面
 *
 * 安全约束：本文件从不保存口令，只保存令牌；口令只发送给 /api/auth/login。
 */

/** 需要重新登录（未登录 / 令牌过期 / 令牌被吊销） */
export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message)
    this.name = 'AuthRequiredError'
  }
}

/** 登录状态变化事件，AuthGate 监听后切回登录界面 */
export const AUTH_REQUIRED_EVENT = 'wrench:auth-required'

const SESSION_KEY = 'wrench_session'
/** WS 令牌提前刷新阈值 */
const WS_TOKEN_REFRESH_AHEAD_MS = 60 * 1000

interface StoredSession {
  /** 会话 JWT */
  token: string
  /** 过期时间（Unix epoch，毫秒） */
  exp: number
}

let _session: StoredSession | null = null
let _sessionLoaded = false
let _wsToken: string | null = null
let _wsTokenExp = 0
let _wsTokenPromise: Promise<string> | null = null

// ── 会话存取 ──

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed || typeof parsed.token !== 'string' || parsed.token.length === 0) return null
    if (!parsed.exp || parsed.exp <= Date.now()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** 本地缓存的会话（未登录返回 null） */
export function getSession(): StoredSession | null {
  if (!_sessionLoaded) {
    _session = readStoredSession()
    _sessionLoaded = true
  }
  return _session
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}

function saveSession(token: string, expiresInSeconds: number): void {
  _session = { token, exp: Date.now() + expiresInSeconds * 1000 }
  _sessionLoaded = true
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(_session))
  } catch (err) {
    // 隐私模式等场景下写入失败：内存中仍可用，只是刷新页面需重新登录
    console.warn('[Auth] Failed to persist session:', err)
  }
}

/** 清除缓存的令牌（退出登录或认证失败时调用） */
export function clearToken(): void {
  _session = null
  _sessionLoaded = true
  _wsToken = null
  _wsTokenExp = 0
  _wsTokenPromise = null
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** 触发“需要登录”：清空本地会话并通知 UI */
export function notifyAuthRequired(reason: string): void {
  clearToken()
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { reason } }))
}

/**
 * 登录：用口令换取会话令牌。
 *
 * @throws Error 口令错误（401）、尝试过于频繁（429）或服务端未配置认证（503）
 */
export async function login(password: string): Promise<void> {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })

  if (resp.status === 429) {
    throw new Error('尝试次数过多，请稍等一分钟后再试')
  }
  if (resp.status === 503) {
    throw new Error('服务端未启用登录保护，请检查 WRENCH_AUTH_PASSWORD 配置')
  }
  if (resp.status === 401) {
    throw new Error('密码错误')
  }
  if (!resp.ok) {
    throw new Error(`登录失败 (${resp.status})`)
  }

  const data = (await resp.json()) as {
    token?: string
    expiresIn?: number
    data?: { token?: string; expiresIn?: number }
  }
  const token = data.token ?? data.data?.token
  const expiresIn = data.expiresIn ?? data.data?.expiresIn ?? 3600
  if (!token) {
    throw new Error('登录响应中缺少令牌')
  }
  saveSession(token, expiresIn)
}

/** 退出登录（本地清除；服务端令牌由口令轮换或 JWT_SECRET 变更使其失效） */
export function logout(): void {
  notifyAuthRequired('logout')
}

/** 校验本地会话是否仍被服务端接受（不产生副作用） */
export async function verifySession(): Promise<boolean> {
  const session = getSession()
  if (!session) return false
  try {
    const resp = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.token}` },
    })
    if (resp.status === 401 || resp.status === 403) {
      clearToken()
      return false
    }
    return resp.ok
  } catch {
    // 网络异常不应清掉会话（可能只是暂时离线）
    return true
  }
}

// ── 令牌获取 ──

/**
 * 获取会话令牌（REST 请求用）。
 *
 * @throws AuthRequiredError 未登录或已过期
 */
export async function getToken(): Promise<string> {
  const session = getSession()
  if (!session) {
    throw new AuthRequiredError('Not logged in')
  }
  return session.token
}

/**
 * 获取短时 WebSocket 令牌（scope=`ws`，10 分钟，带缓存）。
 *
 * @throws AuthRequiredError 会话失效
 */
export async function getWsToken(): Promise<string> {
  if (_wsToken && _wsTokenExp > Date.now() + WS_TOKEN_REFRESH_AHEAD_MS) {
    return _wsToken
  }
  if (_wsTokenPromise) return _wsTokenPromise

  _wsTokenPromise = (async () => {
    const sessionToken = await getToken()
    const resp = await fetch('/api/ws-token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: '{}',
    })

    if (resp.status === 401 || resp.status === 403) {
      notifyAuthRequired('ws-token rejected')
      throw new AuthRequiredError('Session rejected when requesting WS token')
    }
    if (!resp.ok) {
      throw new Error(`Failed to get WS token (${resp.status})`)
    }

    const data = (await resp.json()) as {
      token?: string
      expiresIn?: number
      data?: { token?: string; expiresIn?: number }
    }
    const token = data.token ?? data.data?.token
    const expiresIn = data.expiresIn ?? data.data?.expiresIn ?? 600
    if (!token) {
      throw new Error('WS token endpoint returned no token')
    }
    _wsToken = token
    _wsTokenExp = Date.now() + expiresIn * 1000
    return token
  })()

  try {
    return await _wsTokenPromise
  } finally {
    _wsTokenPromise = null
  }
}

/** 会话失效时清掉 WS 令牌缓存（供 WS 层调用） */
export function clearWsToken(): void {
  _wsToken = null
  _wsTokenExp = 0
}

/**
 * 包装 fetch 自动添加 Authorization 头部。
 *
 * 遇到 401 时清除本地会话并通知 UI 重新登录（不再自动重试，因为
 * 令牌只能由登录接口签发，无法“静默续期”）。
 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(options.headers ?? {})
  headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(url, { ...options, headers })

  if (resp.status === 401) {
    notifyAuthRequired(`401 from ${url}`)
  }

  return resp
}

/**
 * 构建带 WebSocket 认证的 URL（使用短时 `ws` 令牌）。
 *
 * @deprecated Token in URL query parameter is insecure (exposed in server logs,
 * browser history, proxy logs). Will migrate to first-message auth in a future release.
 * Backend currently accepts both header and query param (with deprecation warning).
 */
export async function buildWsUrl(path: string): Promise<string> {
  const token = await getWsToken()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const basePath = path.startsWith('/') ? path : `/${path}`
  return `${protocol}//${host}${basePath}?token=${token}`
}
