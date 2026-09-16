import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import {
  AUTH_REQUIRED_EVENT,
  authStatus,
  isAuthDisabled,
  isAuthenticated,
  login,
  setAuthDisabled,
  verifySession,
} from '../services/auth'

/** 认证状态 */
export type AuthState = 'loading' | 'need-config' | 'need-login' | 'ready' | 'error'

interface AuthGateProps {
  children: ReactNode
}

/**
 * 应用启动时的认证门。
 *
 * 四种去向（按顺序判断）：
 * 1. 服务端**没设门**（`WRENCH_REQUIRE_AUTH=off`）→ 零输入直接进入，没有任何口令环节；
 * 2. 门开着但没有口令 → 显示「部署侧需配置」说明页（使用者设不了口令，也不该由他设）；
 * 3. 本地无会话 → 登录界面（口令只发给 POST /api/auth/login）；
 * 4. 本地有会话 → 调 GET /api/auth/me 校验后初始化应用（WS 连接、客户端 SQLite）。
 *
 * 任意请求收到 401（令牌过期 / 口令已轮换）→ 自动回到登录界面（门关着时不会发生）。
 */
export function AuthGate({ children }: AuthGateProps) {
  // 初始一律 loading：门关着时不知道要不要登录，先别闪一下登录框
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [error, setError] = useState<string | null>(null)

  // 初始化：校验会话 → 安装 fetch 拦截器 → 建立 WS → 载入本地 SSH 连接
  const boot = useCallback(async () => {
    setError(null)
    setAuthState('loading')
    try {
      const valid = await verifySession()
      if (!valid) {
        if (isAuthDisabled()) {
          // 门关着时没有「登录」可回：这是真的连不上，交给错误页重试
          setError('无法连接服务器，请稍后重试')
          setAuthState('error')
          return
        }
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

  // 首次挂载：先问服务端「要不要口令」
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const status = await authStatus()
        if (cancelled) return
        // 门关着：不显示任何口令界面，直接进入（服务端也不校验令牌）
        setAuthDisabled(!status.authRequired)
        if (!status.authRequired) {
          await boot()
          return
        }
        if (!status.configured) {
          // 门开着但部署侧没配口令：受保护接口一律 503，得让部署者去配
          setAuthState('need-config')
          return
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setAuthState('error')
        return
      }
      if (!isAuthenticated()) {
        setAuthState('need-login')
        return
      }
      await boot()
    }
    // 延到下一个任务再跑：避免在 effect 内同步 setState
    const timer = setTimeout(() => void init(), 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [boot])

  // 全局“需要登录”（令牌过期 / 被吊销 / 主动退出）
  useEffect(() => {
    const onAuthRequired = () => {
      // 门关着时没有「登录」可回：别把用户丢到一个用不上的登录框里
      if (isAuthDisabled()) return
      setError(null)
      setAuthState('need-login')
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired)
  }, [])

  const handleLogin = useCallback(
    async (password: string, remember: boolean = false) => {
      await login(password, remember)
      await boot()
    },
    [boot],
  )

  if (authState === 'need-config') {
    return <DeployerConfigNeeded onRetry={() => void boot()} />
  }

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
  onSubmit: (password: string, remember: boolean) => Promise<void>
}

/** 登录界面 —— 只把口令发给 /api/auth/login，本地不保存口令 */
function LoginView({ onSubmit }: LoginViewProps) {
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(password, remember)
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
          placeholder="请输入入口口令"
        />

        {error && (
          <p
            role="alert"
            className="mb-4 rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <label className="mb-3 flex items-center gap-2 text-xs text-gray-400">
          <input
            data-testid="login-remember"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900"
          />
          记住此设备（30 天）
        </label>

        <button
          data-testid="login-submit"
          type="submit"
          disabled={submitting || password.length === 0}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '登录中...' : '登录'}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          这是实例的「入口口令」，由部署侧设置（服务端只保存哈希，明文不落盘）。
          改口令只会让所有人重新登录一次，各人的主机与凭据数据不受影响。
        </p>
      </form>
    </div>
  )
}

/**
 * 「部署侧需要配置」说明页 —— 门开着但服务端没有任何口令时显示。
 *
 * 使用者在这里**做不了**任何事（我们不提供「由使用者设置口令」这条路）：
 * 受保护接口此时一律 503（fail-closed），必须由部署者二选一 ——
 * 设置 `WRENCH_AUTH_PASSWORD`，或把门关掉（`WRENCH_REQUIRE_AUTH=off`）让访客零输入直进。
 */
function DeployerConfigNeeded({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-900 px-4 text-gray-300">
      <div className="w-full max-w-md rounded-lg border border-amber-800 bg-amber-900/20 p-6">
        <h1 className="mb-1 text-xl font-semibold text-white">Wrench · 等待部署侧配置</h1>
        <p className="mb-4 text-sm text-gray-400">
          本实例开启了入口口令，但服务端还没有配置口令。为避免「任何人都能进来」，
          所有接口此刻都拒绝服务（fail-closed）。
        </p>

        <p className="mb-2 text-sm text-gray-300">部署者二选一后重启容器即可：</p>
        <ul className="mb-5 space-y-2 text-xs leading-relaxed text-gray-400">
          <li>
            需要口令：
            <code className="ml-1 rounded bg-gray-900 px-1.5 py-0.5 text-gray-300">
              WRENCH_AUTH_PASSWORD=&lt;口令&gt;
            </code>
          </li>
          <li>
            不需要口令（访问者零输入直进）：
            <code className="ml-1 rounded bg-gray-900 px-1.5 py-0.5 text-gray-300">
              WRENCH_REQUIRE_AUTH=off
            </code>
          </li>
        </ul>

        <button
          data-testid="retry-config"
          onClick={onRetry}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          我配好了，重新检查
        </button>
      </div>
    </div>
  )
}
