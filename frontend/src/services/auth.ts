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
 * 例外：服务端可把门整体关掉（`WRENCH_REQUIRE_AUTH=off`）。此时上面的令牌环节全部
 * 短路 —— 不显示登录界面、不要求口令，访客零输入直进；**数据隔离照旧**（每个浏览器
 * 仍有自己的私有空间，靠空间码识别，与门无关）。
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
/**
 * 空间码（私有空间的唯一凭据）。
 *
 * 服务端只存 SHA-256；明文只在空间创建时通过 `X-Space-Code` 响应头下发一次。
 * 保存在 localStorage 里，换设备时把这串码粘到「用空间码进入」即可找回自己的数据。
 */
const SPACE_KEY = 'wrench_space_code'
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
/**
 * 服务端是否关掉了门（`WRENCH_REQUIRE_AUTH=off`）。
 *
 * AuthGate 启动时用 `/api/auth/status` 的结果写入。为 true 时：登录/首次设置界面
 * 完全不出现，所有「取令牌」的路径短路 —— 访客零输入直接进入（每个浏览器仍有
 * 自己的私有空间，数据隔离不依赖门）。
 */
let _authDisabled = false

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

/** 服务端未设入口口令：访客零输入直进（没有登录环节） */
export function isAuthDisabled(): boolean {
  return _authDisabled
}

/** 记录服务端的门开关状态（AuthGate 启动时调用一次） */
export function setAuthDisabled(value: boolean): void {
  _authDisabled = value
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

// ── 空间码（私有空间身份） ──

/** 本浏览器保存的空间码（没有则为 null：说明空间还没建立或换了浏览器） */
export function getSpaceCode(): string | null {
  try {
    const code = localStorage.getItem(SPACE_KEY)
    return code && code.length > 0 ? code : null
  } catch {
    return null
  }
}

/** 保存空间码（服务端下发或用户手动粘贴） */
export function setSpaceCode(code: string): void {
  try {
    localStorage.setItem(SPACE_KEY, code)
  } catch (err) {
    console.warn('[Space] Failed to persist space code:', err)
  }
}

/**
 * 从响应头里捕获新空间码（服务端只在「首次创建空间」时下发一次）。
 *
 * 注意：必须在 `await fetch(...)` 之后、响应体被消费之前读取 header。
 */
export function captureSpaceCode(resp: Response): void {
  const code = resp.headers.get('x-space-code')
  if (code && code.length > 0) {
    setSpaceCode(code)
  }
}

/** 清除本地空间码（空间码失效或被用户显式丢弃时） */
export function clearSpaceCode(): void {
  try {
    localStorage.removeItem(SPACE_KEY)
  } catch (err) {
    console.warn('[Space] Failed to clear space code:', err)
  }
}

/**
 * 刷新当前页面。
 *
 * 抽成可替换的导出是为了让单测能拦下导航（jsdom 不支持真实导航，
 * 直接调用会抛出 "Not implemented: navigation"）。
 */
export let reloadPage: () => void = () => {
  window.location.reload()
}

/** 仅供测试：替换页面刷新行为 */
export function setReloadPageForTests(fn: () => void): void {
  reloadPage = fn
}

/** 空间码失效标记：刷新后据此提示用户「已新建空空间」 */
const SPACE_RESET_FLAG = 'wrench_space_reset'

export function wasSpaceReset(): boolean {
  try {
    return sessionStorage.getItem(SPACE_RESET_FLAG) === '1'
  } catch {
    return false
  }
}

export function clearSpaceResetFlag(): void {
  try {
    sessionStorage.removeItem(SPACE_RESET_FLAG)
  } catch {
    /* ignore */
  }
}

/**
 * 处理「空间码失效」响应：清掉本地失效码并刷新一次，让服务端给一个空空间。
 *
 * 不做这一步的话，用户会因为每个请求都 400 而完全卡死 —— 连设置页都进不去，
 * 也就没法粘贴正确的空间码。刷新用 sessionStorage 打标，避免在异常情况下循环刷新。
 */
export function handleInvalidSpace(resp: Response): boolean {
  if (!resp.headers.get('x-space-invalid')) return false

  clearSpaceCode()
  try {
    if (sessionStorage.getItem(SPACE_RESET_FLAG) !== '1') {
      sessionStorage.setItem(SPACE_RESET_FLAG, '1')
      reloadPage()
    }
  } catch {
    /* sessionStorage/reload 不可用时静默降级 */
  }
  return true
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
export async function login(password: string, remember: boolean = false): Promise<void> {
  const resp = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, remember }),
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

/** 认证服务端状态：判断该显示「登录」「部署侧需配置」还是直接进入 */
export interface AuthStatus {
  /** 门户口令是否已配置（部署侧提供或网页改过） */
  configured: boolean
  /** 门是否启用；false = 零输入直进，没有口令界面 */
  authRequired: boolean
  /** 口令来源：`database` / `env` / `none` / `disabled` */
  source: string
  canChangePassword: boolean
  rotationLogsOutEveryone: boolean
}

/** 查询认证状态（公开接口，无需令牌） */
export async function authStatus(): Promise<AuthStatus> {
  const resp = await fetch('/api/auth/status', { headers: { Accept: 'application/json' } })
  if (!resp.ok) {
    throw new Error(`无法获取认证状态 (${resp.status})`)
  }
  const data = (await resp.json()) as AuthStatus & { data?: AuthStatus }
  const payload = data.data ?? data
  return {
    configured: Boolean(payload.configured),
    // 旧版后端没有这个字段：缺省按「要口令」处理，绝不因为字段缺失就把门敞开
    authRequired: payload.authRequired ?? true,
    source: payload.source ?? 'none',
    canChangePassword: payload.canChangePassword ?? true,
    rotationLogsOutEveryone: payload.rotationLogsOutEveryone ?? true,
  }
}

/** 修改门户口令（会自动使所有人重新登录；各人的空间数据不受影响） */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const resp = await authedFetch('/api/auth/password', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
  if (resp.status === 401) {
    throw new Error('当前口令不正确')
  }
  if (resp.status === 400) {
    const msg = await resp.json().catch(() => null)
    throw new Error((msg as { msg?: string })?.msg ?? '新口令不符合强度要求')
  }
  if (!resp.ok) {
    throw new Error(`修改失败 (${resp.status})`)
  }
}

// ── 私有空间 ──

export interface SpaceInfo {
  id: string
  createdAt: string
  lastSeenAt: string
  isLegacy: boolean
  counts: { table: string; count: number }[]
}

/** 当前空间信息（不含空间码：服务端只有哈希） */
export async function getSpaceInfo(): Promise<SpaceInfo> {
  const resp = await authedFetch('/api/space/me')
  if (!resp.ok) throw new Error(`无法获取空间信息 (${resp.status})`)
  const data = (await resp.json()) as SpaceInfo & { data?: SpaceInfo }
  return data.data ?? data
}

/** 用空间码把当前浏览器切换到该空间（换设备 / 认领历史数据） */
export async function attachSpace(code: string): Promise<SpaceInfo> {
  const resp = await authedFetch('/api/space/attach', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (resp.status === 400) {
    if (resp.headers.get('x-space-invalid')) {
      throw new Error('空间码无效（可能拼错，或已被重新生成）')
    }
    const msg = await resp.json().catch(() => null)
    throw new Error((msg as { msg?: string })?.msg ?? '进入空间失败')
  }
  if (!resp.ok) {
    throw new Error(`进入空间失败 (${resp.status})`)
  }
  setSpaceCode(code.trim().toLowerCase())
  return getSpaceInfo()
}

/** 重新生成空间码：旧码立即失效（本浏览器自动使用新码） */
export async function rotateSpaceCode(): Promise<string> {
  const resp = await authedFetch('/api/space/rotate', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!resp.ok) throw new Error(`生成新空间码失败 (${resp.status})`)
  const body = (await resp.json()) as { code?: unknown; data?: { code?: unknown } }
  // ⚠️ 响应外层还有一个**数字** `code`（API 状态码 0 / 400…）。写成
  // `body.code ?? body.data?.code` 会把 0 当成空间码，结果：服务端已经换了码，
  // 界面却还显示旧码 —— 用户存下来的是失效码，等换设备时才发现数据「不见了」。
  const code = typeof body.data?.code === 'string' ? body.data.code : undefined
  if (!code) throw new Error('服务端未返回新空间码')
  setSpaceCode(code)
  return code
}

/** 退出登录（本地清除；服务端令牌由口令轮换或 JWT_SECRET 变更使其失效） */
export function logout(): void {
  notifyAuthRequired('logout')
}

/** 校验本地会话是否仍被服务端接受（不产生副作用） */
export async function verifySession(): Promise<boolean> {
  const session = getSession()
  // 门关着时不需要会话：直接问服务端「我是谁」，顺带把首访的空间码领回来
  if (!session && !isAuthDisabled()) return false
  try {
    const headers = new Headers({ Accept: 'application/json' })
    // 门关着时不带令牌（带着旧令牌只会让人以为「非登录不可」）
    if (session && !isAuthDisabled()) headers.set('Authorization', `Bearer ${session.token}`)
    const resp = await fetch('/api/auth/me', { headers })
    // ⚠️ 这一步跑在 `initAuthFetch()` 之前（AuthGate 的启动顺序），而「首次访问建空间」
    // 恰好就发生在这个请求上：不在这里捕获，一次性下发的空间码就永远丢了 ——
    // cookie 已经落地，之后每个请求都会命中「已有空间」，服务端不会再重发明文码。
    // 漏掉它的表现是：功能正常，但用户永远看不到自己的空间码，也搬不到别的设备上。
    captureSpaceCode(resp)
    if (handleInvalidSpace(resp)) return false
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
 * 给请求头补上认证信息（令牌 + 空间码）。
 *
 * * 门开着 → 必须带会话令牌（没会话时按原语义抛 `AuthRequiredError`）；
 * * 门关着（`WRENCH_REQUIRE_AUTH=off`）→ **不带令牌**：服务端本来就不校验，
 *   带着可能过期的旧令牌只会让人误会「必须要登录」。
 *
 * 空间码一律带上：它是 cookie 之外的第二通道，禁用 cookie 的浏览器靠它找回自己的空间。
 */
export async function applyAuthHeaders(headers: Headers): Promise<void> {
  if (!isAuthDisabled()) {
    headers.set('Authorization', `Bearer ${await getToken()}`)
  }
  const code = getSpaceCode()
  if (code) {
    headers.set('X-Space-Code', code)
  }
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
    const headers = new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' })
    await applyAuthHeaders(headers)
    const resp = await fetch('/api/ws-token', {
      method: 'POST',
      headers,
      body: '{}',
    })

    if (resp.status === 401 || resp.status === 403) {
      if (!isAuthDisabled()) {
        notifyAuthRequired('ws-token rejected')
      }
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
  const headers = new Headers(options.headers ?? {})
  // 令牌（门关着时不带）+ 空间码
  await applyAuthHeaders(headers)

  const resp = await fetch(url, { ...options, headers })

  // 服务端只会在「首次创建空间」时下发空间码
  captureSpaceCode(resp)
  handleInvalidSpace(resp)

  if (resp.status === 401 && !isAuthDisabled()) {
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
