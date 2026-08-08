import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Container, RefreshCw, Activity, AlertCircle, ChevronDown } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { authedFetch } from '../../services/auth'
import { useSshHostSelector } from '../../hooks/useSshHostSelector'
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

  // ── 统一主机选择器 ──
  const {
    hosts,
    selectedId,
    setSelectedId,
    connectionId,
    connecting,
    error: sshError,
    hostLabel,
    hasHosts,
  } = useSshHostSelector()

  const fetchContainers = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch('/api/docker/ps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, all: true }),
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
  }, [connectionId])

  const fetchImages = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch('/api/docker/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
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
  }, [connectionId])

  // Fetch data when tab or connection changes
  useEffect(() => {
    if (!isVisible || !connectionId) return
    const run = async () => {
      if (tab === 'containers') await fetchContainers()
      else if (tab === 'images') await fetchImages()
    }
    void run()
  }, [isVisible, tab, connectionId, fetchContainers, fetchImages])

  // Auto refresh — 页面不可见时暂停
  useEffect(() => {
    if (autoRefresh && isVisible && document.visibilityState === 'visible') {
      autoRef.current = setInterval(() => {
        if (tab === 'containers') fetchContainers()
        else if (tab === 'images') fetchImages()
      }, 10000)
    }
    return () => {
      if (autoRef.current) clearInterval(autoRef.current)
    }
  }, [autoRefresh, isVisible, tab, fetchContainers, fetchImages])

  // 页面可见性变化时恢复/暂停自动刷新
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && autoRefresh && isVisible && !autoRef.current) {
        if (tab === 'containers') fetchContainers()
        else if (tab === 'images') fetchImages()
        autoRef.current = setInterval(() => {
          if (tab === 'containers') fetchContainers()
          else if (tab === 'images') fetchImages()
        }, 10000)
      } else if (document.visibilityState !== 'visible' && autoRef.current) {
        clearInterval(autoRef.current)
        autoRef.current = null
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [autoRefresh, isVisible, tab, fetchContainers, fetchImages])

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 sm:p-4">
        <div className="flex items-center gap-2">
          <Container className="h-5 w-5 shrink-0 text-cyan-400" />
          <h1 className="text-base font-semibold sm:text-lg">Docker 管理</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Host selector */}
          {hosts.length > 0 && (
            <div className="relative">
              <select
                value={selectedId || ''}
                onChange={(e) => setSelectedId(e.target.value)}
                className="appearance-none rounded border border-slate-700 bg-slate-800 px-2 py-1 pr-6 text-xs sm:text-sm"
              >
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.source === 'test-config' ? '⚡ ' : ''}
                    {h.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 h-3 w-3 -translate-y-1/2 text-slate-500" />
            </div>
          )}
          {connecting && <span className="animate-pulse text-xs text-yellow-400">连接中...</span>}
          {hostLabel && !connecting && (
            <span className="hidden rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">
              {hostLabel}
            </span>
          )}
          <button
            onClick={() => (tab === 'containers' ? fetchContainers() : fetchImages())}
            disabled={loading || !connectionId}
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
      {(error || sshError) && (error || sshError) !== 'success' && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded border border-red-800 bg-red-900/30 p-2 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error || sshError}
        </div>
      )}

      {/* No connection — compact inline hint */}
      {!connectionId && !connecting && (
        <div className="flex items-center justify-center border-b border-slate-800 bg-slate-900/50 px-4 py-6 text-slate-500">
          {hasHosts ? (
            <p className="text-xs">从顶部下拉框选择主机以连接</p>
          ) : (
            <p className="text-xs">未找到可用主机，请先在 SSH 页面添加连接</p>
          )}
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
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!connectionId && !connecting ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <p className="text-sm">选择主机后自动加载</p>
          </div>
        ) : connecting ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="h-6 w-6 animate-spin text-cyan-400" />
              <p className="text-sm text-slate-400">正在连接 SSH...</p>
            </div>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            }
          >
            {tab === 'containers' && (
              <DockerContainerList
                connectionId={connectionId!}
                containers={containers}
                loading={loading}
                onRefresh={fetchContainers}
              />
            )}
            {tab === 'images' && (
              <DockerImages
                connectionId={connectionId!}
                images={images}
                loading={loading}
                onRefresh={fetchImages}
              />
            )}
            {tab === 'compose' && <DockerCompose connectionId={connectionId!} />}
            {tab === 'monitor' && (
              <DockerMonitor connectionId={connectionId!} containers={containers} />
            )}
          </Suspense>
        )}
      </div>
    </div>
  )
}
