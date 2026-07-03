/**
 * SmartBox 认证服务 (JWT + 一次性令牌兼容)
 *
 * 管理与后端通信的访问令牌（WS 和 REST API）。
 *
 * 流程:
 *   1. 应用启动时调用 initAuth() → POST /api/ws-token 获取 JWT 令牌（24h 有效）
 *   2. WebSocket 连接使用 ?token=<jwt> 进行认证
 *   3. REST API 通过 Authorization: Bearer <jwt> 头部认证
 *   4. JWT 在有效期内复用，仅在过期(401)或手动清除时刷新
 *   5. 兼容旧版一次性令牌（后端中间件同时支持两种验证）
 */

// ── JWT 令牌缓存 ──

let _jwtToken: string | null = null
let _jwtExpiresAt = 0 // Unix epoch (ms), 0 表示未知
let _jwtPromise: Promise<string> | null = null

/** 提前刷新阈值：到期前 5 分钟刷新 */
const JWT_REFRESH_AHEAD_MS = 5 * 60 * 1000

/** 获取当前 JWT（如果有效则直接返回，否则自动刷新） */
export async function getToken(): Promise<string> {
  // JWT 仍然有效 → 直接返回
  if (_jwtToken && _jwtExpiresAt > Date.now() + JWT_REFRESH_AHEAD_MS) {
    return _jwtToken
  }
  // JWT 过期或不存在 → 刷新
  return refreshToken()
}

/** 从后端请求新的 JWT 令牌 */
export async function refreshToken(): Promise<string> {
  // 防止并发重复请求
  if (_jwtPromise) return _jwtPromise

  _jwtPromise = (async () => {
    const protocol = window.location.protocol
    const host = window.location.host
    const resp = await fetch(`${protocol}//${host}/api/ws-token`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error')
      throw new Error(`Failed to get auth token (${resp.status}): ${errText}`)
    }

    const data = await resp.json()
    // 兼容两种响应格式：直接 token 或嵌套在 data 中
    const tokenField = (data as { token?: string }).token ?? data.data?.token
    const expiresIn: number =
      (data as { expiresIn?: number }).expiresIn ?? data.data?.expiresIn ?? 86400

    if (!tokenField) {
      throw new Error('Auth token endpoint returned no token')
    }

    _jwtToken = tokenField
    // 记录过期时间（减去提前刷新阈值）
    _jwtExpiresAt = Date.now() + expiresIn * 1000 - JWT_REFRESH_AHEAD_MS
    return tokenField
  })()

  try {
    return await _jwtPromise
  } finally {
    _jwtPromise = null
  }
}

/** 清除缓存的令牌（连接断开或认证失败时调用） */
export function clearToken() {
  _jwtToken = null
  _jwtExpiresAt = 0
  _jwtPromise = null
}

/**
 * 包装 fetch 自动添加 Authorization 头部
 *
 * 遇到 401 时自动清除缓存并重试一次。
 */
export async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(options.headers ?? {})
  headers.set('Authorization', `Bearer ${token}`)

  const resp = await fetch(url, { ...options, headers })

  // 401 Unauthorized → 令牌过期，清除缓存并重试一次
  if (resp.status === 401) {
    clearToken()
    const newToken = await refreshToken()
    headers.set('Authorization', `Bearer ${newToken}`)
    return fetch(url, { ...options, headers })
  }

  return resp
}

/**
 * 构建带 WebSocket 认证的 URL
 */
export async function buildWsUrl(path: string): Promise<string> {
  const token = await getToken()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const basePath = path.startsWith('/') ? path : `/${path}`
  return `${protocol}//${host}${basePath}?token=${token}`
}
