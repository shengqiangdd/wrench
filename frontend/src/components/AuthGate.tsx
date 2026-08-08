import { useEffect, useState, type ReactNode } from 'react'

/** 认证状态 */
export type AuthState = 'loading' | 'ready' | 'error'

interface AuthGateProps {
  children: ReactNode
}

/**
 * 应用启动时初始化认证令牌。
 *
 * - 在子组件渲染前完成 token 获取
 * - 如果获取失败，显示错误并提供重试按钮
 * - 成功后，`auth.ts` 中的 `getToken()` 返回缓存的 token
 */
export function AuthGate({ children }: AuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const { initAuthFetch } = await import('../services/initAuthFetch')
        initAuthFetch()
        const { getWsClient } = await import('../services/websocket')
        await getWsClient()
        // 从客户端 SQLite 加载 SSH 连接
        const { useSshStore } = await import('../stores/ssh-store')
        const { isDbReady } = await import('../services/client-db')
        if (isDbReady()) {
          useSshStore.getState().loadFromDb()
        }
        if (!cancelled) {
          setAuthState('ready')
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setAuthState('error')
        }
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [])

  if (authState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-300">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-400">正在连接服务器...</p>
        </div>
      </div>
    )
  }

  if (authState === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-gray-300">
        <div className="max-w-md rounded-lg border border-red-800 bg-red-900/20 p-6 text-center">
          <p className="mb-2 text-lg font-semibold text-red-400">连接失败</p>
          <p className="mb-4 text-sm text-gray-400">
            {error || '无法获取认证令牌，请检查后端服务是否运行。'}
          </p>
          <button
            onClick={() => {
              setAuthState('loading')
              setError(null)
              import('../services/initAuthFetch').then(({ initAuthFetch }) => {
                initAuthFetch()
                import('../services/websocket').then(({ getWsClient }) =>
                  getWsClient().then(
                    () => setAuthState('ready'),
                    (err) => {
                      setError(err instanceof Error ? err.message : String(err))
                      setAuthState('error')
                    },
                  ),
                )
              })
            }}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
