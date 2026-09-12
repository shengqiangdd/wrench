/**
 * Wrench 全局 fetch 认证拦截器
 *
 * 在应用启动时自动拦截所有 `/api/` 请求，添加 `Authorization: Bearer <session token>` 头部。
 * 这样所有模块中的 `fetch('/api/...') 调用无需手动修改即可获得认证。
 *
 * 工作原理:
 *   1. 用 Proxy 代理 window.fetch，只拦截 /api/{...} 路径的请求
 *   2. 自动调用 getToken() 取会话令牌并注入 Authorization 头
 *   3. 401 响应 → 清除本地会话并通知 AuthGate 切回登录界面
 *   4. 公开端点（/api/health、/api/auth/login）跳过拦截
 */

import {
  AuthRequiredError,
  captureSpaceCode,
  getSpaceCode,
  getToken,
  handleInvalidSpace,
  notifyAuthRequired,
} from './auth'

/** 无需注入令牌的公开端点 */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
])

/** 安装全局 fetch 拦截器，返回取消函数 */
export function initAuthFetch(): () => void {
  if ((window as unknown as Record<string, unknown>).__AUTH_FETCH_INSTALLED) {
    return () => {}
  }

  const originalFetch = window.fetch

  const authFetch: typeof window.fetch = async (input, init) => {
    // 解析请求 URL
    const request = input instanceof Request ? input : new Request(input as RequestInfo, init)
    const url = new URL(request.url, window.location.origin)
    const path = url.pathname

    if (!path.startsWith('/api/')) {
      return originalFetch(request)
    }

    // 公开端点不需要注入令牌，但仍然要看一眼响应头：空间码/失效标记是
    // 「一次性下发、错过就没有」的东西，任何一条 /api/ 响应都不该被浪费。
    if (PUBLIC_PATHS.has(path)) {
      const resp = await originalFetch(request)
      captureSpaceCode(resp)
      handleInvalidSpace(resp)
      return resp
    }

    try {
      const token = await getToken()
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${token}`)
      // 空间码：服务端据此定位私有空间（cookie 之外的第二通道）
      const spaceCode = getSpaceCode()
      if (spaceCode) {
        headers.set('X-Space-Code', spaceCode)
      }

      const authRequest = new Request(request, { headers })
      const resp = await originalFetch(authRequest)

      // 首次访问时服务端会下发新空间码，必须在这里捕获（响应体被读之前）
      captureSpaceCode(resp)
      handleInvalidSpace(resp)

      if (resp.status === 401) {
        notifyAuthRequired(`401 from ${path}`)
      }

      return resp
    } catch (err) {
      // 未登录（本地无会话）不属于异常路径：交给调用方处理 401
      if (!(err instanceof AuthRequiredError)) {
        console.warn('[AuthFetch] Token unavailable, falling back:', path, err)
      }
      return originalFetch(request)
    }
  }

  Object.defineProperty(window, 'fetch', {
    value: authFetch,
    writable: true,
    configurable: true,
  })
  ;(window as unknown as Record<string, unknown>).__AUTH_FETCH_INSTALLED = true

  return () => {
    Object.defineProperty(window, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    })
    ;(window as unknown as Record<string, unknown>).__AUTH_FETCH_INSTALLED = false
  }
}
