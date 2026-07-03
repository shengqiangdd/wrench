/**
 * SmartBox 全局 fetch 认证拦截器
 *
 * 在应用启动时自动拦截所有 `/api/` 请求，添加 `Authorization: Bearer <token>` 头部。
 * 这样所有模块中的 `fetch('/api/...') 调用无需手动修改即可获得认证。
 *
 * 工作原理:
 *   1. 用 Proxy 代理 window.fetch，只拦截 /api/{...} 路径的请求
 *   2. 自动调用 getToken() 获取一次性 token 并注入 Authorization 头
 *   3. 401 响应自动清除 token 缓存，下次请求自动刷新
 *   4. /api/ws-token 端点跳过拦截（公开端点）
 */

import { getToken, clearToken } from './auth'

/** 安装全局 fetch 拦截器，返回取消函数 */
export function initAuthFetch(): () => void {
  if ((window as any).__AUTH_FETCH_INSTALLED) {
    return () => {}
  }

  const originalFetch = window.fetch

  const authFetch: typeof window.fetch = async (input, init) => {
    // 解析请求 URL
    const request = input instanceof Request ? input : new Request(input as RequestInfo, init)
    const url = new URL(request.url, window.location.origin)
    const path = url.pathname

    // 只拦截 /api/ 路径，跳过公开端点
    if (!path.startsWith('/api/') || path === '/api/ws-token') {
      return originalFetch(request)
    }

    try {
      const token = await getToken()
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${token}`)

      const authRequest = new Request(request, { headers })
      const resp = await originalFetch(authRequest)

      if (resp.status === 401) {
        clearToken()
      }

      return resp
    } catch (err) {
      console.warn('[AuthFetch] Token unavailable, falling back:', path)
      return originalFetch(request)
    }
  }

  Object.defineProperty(window, 'fetch', {
    value: authFetch,
    writable: true,
    configurable: true,
  })

  ;(window as any).__AUTH_FETCH_INSTALLED = true

  return () => {
    Object.defineProperty(window, 'fetch', {
      value: originalFetch,
      writable: true,
      configurable: true,
    })
    ;(window as any).__AUTH_FETCH_INSTALLED = false
  }
}
