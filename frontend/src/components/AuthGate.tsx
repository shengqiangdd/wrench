import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { AUTH_REQUIRED_EVENT, isAuthenticated, login, verifySession } from '../services/auth'

/** 认证状态 */
export type AuthState = 'loading' | 'need-login' | 'ready' | 'error'

interface AuthGateProps {
  children: ReactNode
}

/**
 * 应用启动时的认证门。
 *
 * - 本地无会话 → 显示登录界面（口令只发给 POST /api/auth/login）
 * - 本地有会话 → 调 GET /api/auth/me 校验后初始化应用（WS 连接、客户端 SQLite）
 * - 任意请求收到 401（令牌过期 / 口令已轮换）→ 自动回到登录界面
 */
export function AuthGate({ children }: AuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>(() =>
    isAuthenticated() ? 'loading' : 'need-login',
  )
  const [error, setError] = useState<string | null>(null)

  // 初始化：校验会话 → 安装 fetch 拦截器 → 建立 WS → 载入本地 SSH 连接
  const boot = useCallback(async () => {
    setError(null)
    setAuthState('loading')
    try {
      const valid = await verifySession()
      if (!valid) {
        setAuthState('need-login')
        return
      }

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
      setAuthState('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setAuthState('error')
    }
  }, [])

  // 首次挂载：有会话才初始化应用
  useEffect(() => {
    if (!isAuthenticated()) return
    // 延到下一个任务再跑：避免在 effect 内同步 setState（初始状态已是 loading）
    const timer = setTimeout(() => void boot(), 0)
    return () => clearTimeout(timer)
  }, [boot])

  // 全局“需要登录”（令牌过期 / 被吊销 / 主动退出）
  useEffect(() => {
    const onAuthRequired = () => {
      setError(null)
      setAuthState('need-login')
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [])

  const handleLogin = useCallback(
    async (password: string) => {
      await login(password)
      await boot()
    },
    [boot],
  )

  if (authState === 'need-login') {
    return <LoginView onSubmit={handleLogin} />
  }

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
            {error || '无法连接后端服务，请检查后端是否运行。'}
          </p>
          <button
            data-testid="retry"
            onClick={() => void boot()}
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

interface LoginViewProps {
  /** 提交口令：成功返回，失败抛错 */
  onSubmit: (password: string) => Promise<void>
}

/** 登录界面 —— 只把口令发给 /api/auth/login，本地不保存口令 */
function LoginView({ onSubmit }: LoginViewProps) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(password)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-900 px-4 text-gray-300">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800/60 p-6"
      >
        <h1 className="mb-1 text-xl font-semibold text-white">Wrench</h1>
        <p className="mb-5 text-sm text-gray-400">请输入访问密码以继续</p>

        <label htmlFor="wrench-password" className="mb-2 block text-sm text-gray-300">
          密码
        </label>
        <input
          id="wrench-password"
          data-testid="login-password"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
          placeholder="服务端 WRENCH_AUTH_PASSWORD"
        />

        {error && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <button
          data-testid="login-submit"
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '登录中...' : '登录'}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          密码由服务端环境变量 <code className="text-gray-400">WRENCH_AUTH_PASSWORD</code> 配置；
          未配置时服务端会生成随机密码并保存在数据目录的{' '}
          <code className="text-gray-400">auth_password</code>。
        </p>
      </form>
    </div>
  )
}
