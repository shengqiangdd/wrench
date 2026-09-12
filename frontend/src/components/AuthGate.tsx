import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'

import {
  AUTH_REQUIRED_EVENT,
  authStatus,
  isAuthenticated,
  login,
  setupPassword,
  verifySession,
} from '../services/auth'

/** 认证状态 */
export type AuthState = 'loading' | 'need-setup' | 'need-login' | 'ready' | 'error'

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

  // 首次挂载：先问服务端「口令配了吗」——未配置就走首次设置界面（不再教用户去 docker exec 读 env）
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const status = await authStatus()
        if (cancelled) return
        if (status.setupRequired) {
          setAuthState('need-setup')
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

  const handleSetup = useCallback(
    async (password: string, setupToken: string) => {
      await setupPassword(password, setupToken)
      await boot()
    },
    [boot],
  )

  if (authState === 'need-setup') {
    return <SetupView onSubmit={handleSetup} />
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
          这是实例的「入口口令」，由首次设置的人自定，服务端保存的是哈希（明文不落盘）。
          改口令只会让所有人重新登录一次，各人的主机与凭据数据不受影响。
        </p>
      </form>
    </div>
  )
}

interface SetupViewProps {
  /** 首次设置：口令 + 启动日志里的一次性 setup token */
  onSubmit: (password: string, setupToken: string) => Promise<void>
}

/**
 * 首次设置界面 —— 服务端尚未配置入口口令时显示。
 *
 * 需要部署者从容器启动日志里取一次性 setup token（`docker logs <容器>` 里那行
 * `WRENCH_SETUP_TOKEN`／随机令牌），在网页里设置口令后即可进入，无需再登录。
 */
function SetupView({ onSubmit }: SetupViewProps) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (submitting) return
    if (password.length < 8) {
      setError('口令至少 8 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的口令不一致')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(password, setupToken.trim())
      setPassword('')
      setConfirm('')
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
        <h1 className="mb-1 text-xl font-semibold text-white">Wrench · 首次设置</h1>
        <p className="mb-5 text-sm text-gray-400">为本实例设置入口口令</p>

        <label htmlFor="setup-token" className="mb-2 block text-sm text-gray-300">
          启动令牌
        </label>
        <input
          id="setup-token"
          data-testid="setup-token"
          type="text"
          autoFocus
          autoComplete="off"
          value={setupToken}
          onChange={(e) => setSetupToken(e.target.value)}
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-blue-500"
          placeholder="容器启动日志里的一次性令牌"
        />

        <label htmlFor="setup-password" className="mb-2 block text-sm text-gray-300">
          新口令
        </label>
        <input
          id="setup-password"
          data-testid="setup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
          placeholder="至少 8 位，含两类字符"
        />

        <label htmlFor="setup-confirm" className="mb-2 block text-sm text-gray-300">
          确认口令
        </label>
        <input
          id="setup-confirm"
          data-testid="setup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mb-4 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
          placeholder="再输入一次"
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
          data-testid="setup-submit"
          type="submit"
          disabled={submitting || password.length === 0 || setupToken.length === 0}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '设置中...' : '设置并进入'}
        </button>

        <p className="mt-4 text-xs leading-relaxed text-gray-500">
          取启动令牌：<code className="text-gray-400">docker logs &lt;容器名&gt; 2&gt;&amp;1 | grep -i &quot;setup token&quot;</code>
          。口令以 PBKDF2 哈希保存到数据库，明文不写任何文件。
        </p>
      </form>
    </div>
  )
}
