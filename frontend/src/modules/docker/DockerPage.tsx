import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react'
import { Container, RefreshCw, Activity, AlertCircle } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSshStore } from '../../stores/ssh-store'
import { ensureSshConnection } from '../../services/ssh-ensure'
import type { DockerContainer, DockerImage } from './index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

const DockerContainerList = lazy(() => import('./DockerContainerList'))
const DockerImages = lazy(() => import('./DockerImages'))
const DockerCompose = lazy(() => import('./DockerCompose'))
const DockerMonitor = lazy(() => import('./DockerMonitor'))

type Tab = 'containers' | 'images' | 'compose' | 'monitor'

export default function DockerPage() {
  const [tab, setTab] = useState<Tab>('containers')
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeNav = useAppStore((s) => s.activeNav)
  const isVisible = activeNav === 'docker'

  // SSH store: 活跃 session + 已保存的连接配置
  const sessions = useSshStore((s) => s.sessions)
  const connections = useSshStore((s) => s.connections)

  // 选中的主机（可以是 session.id 或 connection.id）
  const [selectedHost, setSelectedHost] = useState<string | null>(() => connections[0]?.id ?? null)

  // 实际用于 API 调用的 backend connectionId
  const [currentConnId, setCurrentConnId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  // 可选主机列表：所有已保存的连接（不管是否已连接 SSH）
  const availableHosts = useMemo(() => {
    return connections.map((conn) => ({
      id: conn.id,
      name: conn.name || conn.host,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.privateKey,
    }))
  }, [connections])

  // selectedHost 变化时自动 ensure 连接
  const ensureRef = useRef<ReturnType<typeof ensureSshConnection> | null>(null)
  useEffect(() => {
    if (!selectedHost) return
    const host = availableHosts.find((h) => h.id === selectedHost)
    if (!host) return

    let cancelled = false
    const run = async () => {
      // 先检查是否已有活跃 session 关联该 connectionId
      const existingSession = sessions.find((s) => s.connectionId === selectedHost)
      if (existingSession) {
        if (!cancelled) setCurrentConnId(existingSession.id)
        return
      }

      setConnecting(true)
      setError(null)
      try {
        const p = ensureSshConnection({
          host: host.host,
          port: host.port,
          username: host.username,
          password: host.password,
          privateKey: host.privateKey,
        })
        ensureRef.current = p
        const connId = await p
        if (!cancelled) setCurrentConnId(connId)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '连接失败'
        if (!cancelled) {
          setCurrentConnId(null)
          setError(msg)
        }
      } finally {
        if (!cancelled) setConnecting(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [selectedHost, availableHosts, sessions])

  const fetchContainers = useCallback(async () => {
    if (!currentConnId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/docker/ps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: currentConnId, all: true }),
      })
      const json = (await res.json()) as ApiResponse
      if (json.success) {
        const list: DockerContainer[] = json.data?.containers ?? []
        setContainers(list)
      } else {
        const errMsg = json.error || json.msg
        if (errMsg) setError(errMsg)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [currentConnId])

  const fetchImages = useCallback(async () => {
    if (!currentConnId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/docker/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: currentConnId }),
      })
      const json = (await res.json()) as ApiResponse
      if (json.success) {
        const output = (json.data?.data ?? json.data ?? '').toString()
        const lines = output.trim().split('\n').filter(Boolean)
        const list: DockerImage[] = lines
          .map((line: string) => {
            try {
              const obj = JSON.parse(line) as Record<string, string>
              return {
                ID: obj.ID || obj.id || '',
                Repository: obj.Repository || obj.repository || '<none>',
                Tag: obj.Tag || obj.tag || '<none>',
                Size: obj.Size || obj.size || '',
                CreatedAt: obj.CreatedAt || obj.created_at || '',
              }
            } catch {
              // 非 JSON 行，跳过
              return null
            }
          })
          .filter((img: DockerImage | null): img is DockerImage => img !== null)
        setImages(list)
      } else {
        const errMsg = json.error || json.msg
        if (errMsg) setError(errMsg)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [currentConnId])

  // Fetch data when tab or connection changes
  useEffect(() => {
    if (!isVisible || !currentConnId) return
    const run = async () => {
      if (tab === 'containers') await fetchContainers()
      else if (tab === 'images') await fetchImages()
    }
    void run()
  }, [isVisible, tab, currentConnId, fetchContainers, fetchImages])

  // Auto refresh
  useEffect(() => {
    if (autoRefresh && isVisible) {
      autoRef.current = setInterval(() => {
        if (tab === 'containers') fetchContainers()
        else if (tab === 'images') fetchImages()
      }, 10000)
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [autoRefresh, isVisible, tab, fetchContainers, fetchImages])

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 p-4">
        <div className="flex items-center gap-2">
          <Container className="h-5 w-5 text-cyan-400" />
          <h1 className="text-lg font-semibold">Docker 管理</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Host selector */}
          {availableHosts.length > 0 && (
            <select
              value={selectedHost || ''}
              onChange={(e) => setSelectedHost(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
            >
              {availableHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          )}
          {connecting && <span className="animate-pulse text-xs text-yellow-400">连接中...</span>}
          <button
            onClick={() => (tab === 'containers' ? fetchContainers() : fetchImages())}
            disabled={loading || !currentConnId}
            className="rounded p-1.5 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`rounded p-1.5 ${autoRefresh ? 'bg-cyan-900/50 text-cyan-400' : 'hover:bg-slate-800'}`}
          >
            <Activity className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && error !== 'success' && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded border border-red-800 bg-red-900/30 p-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* No connection — compact inline hint */}
      {!currentConnId && !connecting && (
        <div className="flex items-center justify-center border-b border-slate-800 bg-slate-900/50 px-4 py-6 text-slate-500">
          <p className="text-xs">
            {availableHosts.length === 0
              ? '请先在 SSH 页面添加并连接主机'
              : '从顶部下拉框选择主机以连接'}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-800">
        {(['containers', 'images', 'compose', 'monitor'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? 'border-b-2 border-cyan-400 text-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'containers'
              ? '容器'
              : t === 'images'
                ? '镜像'
                : t === 'compose'
                  ? 'Compose'
                  : '监控'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!currentConnId ? null : tab === 'containers' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8 text-slate-500">加载中...</div>
            }
          >
            <DockerContainerList
              containers={containers}
              loading={loading}
              connectionId={currentConnId}
              onRefresh={fetchContainers}
            />
          </Suspense>
        ) : tab === 'images' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8 text-slate-500">加载中...</div>
            }
          >
            <DockerImages
              images={images}
              loading={loading}
              connectionId={currentConnId}
              onRefresh={fetchImages}
            />
          </Suspense>
        ) : tab === 'compose' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8 text-slate-500">加载中...</div>
            }
          >
            <DockerCompose connectionId={currentConnId} />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8 text-slate-500">加载中...</div>
            }
          >
            <DockerMonitor connectionId={currentConnId} containers={containers} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
