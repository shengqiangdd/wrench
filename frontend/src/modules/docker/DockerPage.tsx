import { useState, useEffect, useCallback, useRef, lazy, Suspense, useMemo } from 'react'
import { Container, RefreshCw, Activity, AlertCircle } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSshStore } from '../../stores/ssh-store'
import type { DockerContainer, DockerImage } from './index'

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

  // 获取当前 SSH 连接 ID
  const sessions = useSshStore((s) => s.sessions)
  const connections = useSshStore((s) => s.connections)
  const setActiveNav = useAppStore((s) => s.setActiveNav)

  // 所有可用连接：活跃 session + 已保存的连接
  const availableHosts = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; name: string; connected: boolean }[] = []
    for (const sess of sessions) {
      const name = sess.connectionName || sess.host || sess.id.slice(0, 8)
      if (!seen.has(sess.id)) {
        list.push({ id: sess.id, name, connected: true })
        seen.add(sess.id)
      }
    }
    for (const conn of connections) {
      if (!seen.has(conn.id) && !seen.has(conn.host || '')) {
        list.push({ id: conn.id, name: conn.name, connected: false })
        seen.add(conn.id)
      }
    }
    return list
  }, [sessions, connections])

  const [selectedHost, setSelectedHost] = useState<string | null>(null)
  const currentConnId =
    selectedHost && availableHosts.some((h) => h.id === selectedHost && h.connected)
      ? selectedHost
      : sessions.length > 0
        ? sessions[0]!.id
        : null

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
      const json = await res.json()
      if (json.success) {
        const lines = json.data.trim().split('\n').filter(Boolean)
        const list: DockerContainer[] = lines
          .map((line: string) => {
            try {
              return JSON.parse(line)
            } catch {
              return null
            }
          })
          .filter(Boolean)
        setContainers(list)
      } else {
        setError(json.error || '获取容器列表失败')
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
      const json = await res.json()
      if (json.success) {
        const lines = json.data.trim().split('\n').filter(Boolean)
        const list: DockerImage[] = lines
          .map((line: string) => {
            try {
              return JSON.parse(line)
            } catch {
              return null
            }
          })
          .filter(Boolean)
        setImages(list)
      } else {
        setError(json.error || '获取镜像列表失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [currentConnId])

  const refresh = useCallback(() => {
    if (tab === 'containers') fetchContainers()
    else if (tab === 'images') fetchImages()
    // monitor tab has its own polling
  }, [tab, fetchContainers, fetchImages])

  // 自动刷新
  useEffect(() => {
    if (autoRefresh && isVisible) {
      autoRef.current = setInterval(refresh, 5000)
    }
    return () => {
      if (autoRef.current) {
        clearInterval(autoRef.current)
        autoRef.current = null
      }
    }
  }, [autoRefresh, isVisible, refresh])

  // 切换 tab 时自动加载
  useEffect(() => {
    if (isVisible) {
      const t = setTimeout(() => refresh(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [tab, isVisible, refresh])

  // 切回页面时刷新
  useEffect(() => {
    if (isVisible) {
      const t = setTimeout(() => refresh(), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [isVisible, refresh])

  if (!currentConnId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
        <Container size={48} className="text-slate-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">未连接到任何 SSH</p>
          <p className="mt-1 text-xs text-slate-600">选择一个已保存的连接，或前往 SSH 页面连接</p>
        </div>
        {availableHosts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableHosts.map((host) => (
              <button
                key={host.id}
                onClick={() => {
                  if (host.connected) {
                    setSelectedHost(host.id)
                  } else {
                    // 不跳转，保留在当前页面，让用户点击快速连接
                    setSelectedHost(host.id)
                  }
                }}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xs transition-colors ${
                  host.connected
                    ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${host.connected ? 'bg-emerald-500' : 'bg-slate-600'}`}
                />
                {host.name}
                {host.connected ? ' (已连接)' : ' → 连接'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setActiveNav('ssh')}
          className="bg-smartbox-600 hover:bg-smartbox-500 mt-2 rounded-md px-4 py-2 text-xs text-white transition-colors"
        >
          前往 SSH 页面
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <Container size={18} className="text-smartbox-400 mr-1" />
        <h1 className="text-sm font-semibold text-slate-200">Docker 管理</h1>
        <div className="ml-auto flex items-center gap-2">
          {/* 自动刷新开关 */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="text-smartbox-500 h-3 w-3 rounded border-slate-600 bg-slate-700"
            />
            自动刷新
          </label>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex shrink-0 border-b border-slate-700/30 px-4">
        <button
          onClick={() => setTab('containers')}
          className={`border-b-2 px-4 py-2 text-xs transition-colors ${
            tab === 'containers'
              ? 'border-smartbox-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          容器 ({containers.length})
        </button>
        <button
          onClick={() => setTab('images')}
          className={`border-b-2 px-4 py-2 text-xs transition-colors ${
            tab === 'images'
              ? 'border-smartbox-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          镜像 ({images.length})
        </button>
        <button
          onClick={() => setTab('compose')}
          className={`border-b-2 px-4 py-2 text-xs transition-colors ${
            tab === 'compose'
              ? 'border-smartbox-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          Compose
        </button>
        <button
          onClick={() => setTab('monitor')}
          className={`flex items-center gap-1 border-b-2 px-4 py-2 text-xs transition-colors ${
            tab === 'monitor'
              ? 'border-smartbox-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <Activity size={12} />
          监控
        </button>
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-400">
          <AlertCircle size={14} />
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-500 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 overflow-auto">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
            </div>
          }
        >
          {tab === 'containers' && (
            <DockerContainerList
              connectionId={currentConnId}
              containers={containers}
              loading={loading}
              onRefresh={fetchContainers}
            />
          )}
          {tab === 'images' && (
            <DockerImages
              connectionId={currentConnId}
              images={images}
              loading={loading}
              onRefresh={fetchImages}
            />
          )}
          {tab === 'compose' && <DockerCompose connectionId={currentConnId} />}
          {tab === 'monitor' && (
            <DockerMonitor connectionId={currentConnId} containers={containers} />
          )}
        </Suspense>
      </div>
    </div>
  )
}
