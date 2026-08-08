import { memo, useCallback, useState, useEffect } from 'react'
import { authedFetch } from '../../services/auth'
import { notify } from '../../services/event-bus'
import {
  Layers,
  RefreshCw,
  Play,
  Square,
  FileText,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
  RotateCcw,
} from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

interface ComposeProject {
  path: string
  name: string
  services: ComposeService[]
}

interface ComposeService {
  name: string
  status: string
  image: string
  ports: string
  state: string // running, exited, paused, etc.
}

interface Props {
  connectionId: string
}

function DockerComposeInner({ connectionId }: Props) {
  const [projects, setProjects] = useState<ComposeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [logData, setLogData] = useState<{ key: string; content: string } | null>(null)
  const [search, setSearch] = useState('')
  const [manualPath, setManualPath] = useState('')

  // 加载项目列表
  const discoverProjects = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = (await res.json()) as ApiResponse
      if (!json.success) {
        notify(json.error || json.msg || '获取 Compose 文件失败', 'error')
        setProjects([])
        return
      }

      // 后端返回结构化数据: { projects: [{ID, Name, Status, ConfigFiles}] }
      const projectsData: Array<{
        ID?: string
        Name?: string
        Status?: string
        ConfigFiles?: string
      }> = json.data?.projects ?? []
      const parsed: ComposeProject[] = projectsData.map((p) => ({
        path: p.ConfigFiles || '',
        name: p.Name || 'unknown',
        services: [],
      }))

      setProjects(parsed)

      // 并行预加载所有项目的 services（不阻塞 UI）
      void Promise.all(
        parsed.map(async (p) => {
          try {
            const r = await authedFetch('/api/docker/compose/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ connectionId, filePath: p.path, action: 'ps' }),
            })
            const j = (await r.json()) as ApiResponse
            if (j.success) {
              const sd: Array<{
                Name?: string
                Image?: string
                State?: string
                Status?: string
                Ports?: string
              }> = j.data?.services ?? []
              return {
                path: p.path,
                services: sd.map((s) => ({
                  name: s.Name || '-',
                  status: s.Status || '-',
                  image: s.Image || '-',
                  ports: s.Ports || '',
                  state: (s.State || '').toLowerCase(),
                })),
              }
            }
          } catch {
            // ignore
          }
          return { path: p.path, services: [] as ComposeService[] }
        }),
      ).then((results) => {
        setProjects((prev) =>
          prev.map((p) => {
            const r = results.find((x) => x.path === p.path)
            return r && r.services.length > 0 ? { ...p, services: r.services } : p
          }),
        )
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      notify(msg, 'error')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // 手动加载指定路径
  const handleManualLoad = useCallback(async () => {
    if (!manualPath.trim()) return
    setLoading(true)
    try {
      const res = await authedFetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, filePath: manualPath.trim() }),
      })
      const json = (await res.json()) as ApiResponse
      if (!json.success) {
        notify(json.error || '加载失败', 'error')
        return
      }
      const path = manualPath.trim()
      const parts = path.replace(/\/+$/, '').split('/')
      const projectName =
        parts.slice(0, -1).filter(Boolean).pop() || path.replace(/\.(yml|yaml)$/, '')
      setProjects((prev) => {
        // 避免重复添加
        if (prev.some((p) => p.path === path)) return prev
        return [...prev, { path, name: projectName, services: [] }]
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      notify(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [connectionId, manualPath])

  // 初始加载 & connectionId 变化时重新加载
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    discoverProjects()
  }, [discoverProjects])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 展开项目时获取 services 状态
  const fetchServices = useCallback(
    async (path: string) => {
      setActionLoading(`ps:${path}`)
      try {
        const res = await authedFetch('/api/docker/compose/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, filePath: path, action: 'ps' }),
        })
        const json = (await res.json()) as ApiResponse
        if (json.success) {
          // 后端返回结构化数据: { services: [{Name, Image, State, Status, Ports}] }
          const servicesData: Array<{
            Name?: string
            Image?: string
            State?: string
            Status?: string
            Ports?: string
          }> = json.data?.services ?? []
          const services: ComposeService[] = servicesData.map((s) => ({
            name: s.Name || '-',
            status: s.Status || '-',
            image: s.Image || '-',
            ports: s.Ports || '',
            state: (s.State || '').toLowerCase(),
          }))
          setProjects((prev) => prev.map((p) => (p.path === path ? { ...p, services } : p)))
        } else {
          notify(json.error || json.msg || '获取服务列表失败', 'error')
          setProjects((prev) => prev.map((p) => (p.path === path ? { ...p, services: [] } : p)))
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '请求失败'
        notify(msg, 'error')
      } finally {
        setActionLoading(null)
      }
    },
    [connectionId],
  )

  const toggleExpand = (path: string) => {
    if (expandedPath === path) {
      setExpandedPath(null)
    } else {
      setExpandedPath(path)
      // 自动刷新 services
      fetchServices(path)
    }
  }

  // Compose 操作
  const doAction = useCallback(
    async (path: string, action: string, service?: string) => {
      const key = `${action}:${path}:${service || ''}`
      if (actionLoading) return
      setActionLoading(key)
      if (action === 'logs') setLogData({ key, content: '' })
      try {
        const res = await authedFetch('/api/docker/compose/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, filePath: path, action, service }),
        })
        const json = (await res.json()) as ApiResponse
        if (!json.success) {
          notify(`${action} 失败: ${json.error || json.msg || '未知错误'}`, 'error')
        } else if (action === 'logs') {
          // 后端返回 { success, data: { output: "..." } } 或旧格式 { success, data: { data: "..." } }
          const output = json.data?.output ?? json.data?.data ?? json.data ?? ''
          setLogData({
            key,
            content: typeof output === 'string' ? output : JSON.stringify(output) || '(empty)',
          })
        } else {
          notify(`${action} 成功`, 'success')
          // 操作完成后自动刷新状态
          setTimeout(() => fetchServices(path), 800)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '请求失败'
        if (action === 'logs') {
          setLogData({ key, content: `请求失败: ${msg}` })
        }
        notify(`${action} 请求失败: ${msg}`, 'error')
      } finally {
        setActionLoading(null)
      }
    },
    [connectionId, actionLoading, fetchServices],
  )

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="flex h-full flex-col p-4">
      {/* 工具栏 */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目名称 / 路径..."
            className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/60 py-1.5 pr-3 pl-8 text-xs text-slate-300 placeholder-slate-500 outline-none"
          />
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
        </div>
        <button
          onClick={() => discoverProjects()}
          disabled={loading}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 手动输入路径 */}
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <input
          type="text"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualLoad()}
          placeholder="手动输入 compose 文件路径..."
          className="focus:border-wrench-500/50 flex-1 rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 placeholder-slate-500 outline-none"
        />
        <button
          onClick={handleManualLoad}
          disabled={loading || !manualPath.trim()}
          className="bg-wrench-600 hover:bg-wrench-500 rounded-md px-3 py-1.5 text-xs text-white transition-colors disabled:opacity-50"
        >
          加载
        </button>
      </div>

      {/* 项目列表 */}
      <div className="flex-1 overflow-auto">
        {loading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-slate-500" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            {search ? '未找到匹配的项目' : '未发现 Compose 项目'}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredProjects.map((project) => {
              const isExpanded = expandedPath === project.path
              const runningCount = project.services.filter((s) => s.state === 'running').length
              const totalCount = project.services.length
              return (
                <div
                  key={project.path}
                  className="rounded-lg border border-slate-700/30 bg-slate-800/30"
                >
                  {/* 项目头 */}
                  <div
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-slate-800/50"
                    onClick={() => toggleExpand(project.path)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0 text-slate-500" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0 text-slate-500" />
                    )}
                    <Layers size={14} className="text-wrench-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-200">
                          {project.name}
                        </span>
                        {totalCount > 0 && (
                          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {runningCount}/{totalCount} 运行中
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{project.path}</div>
                    </div>
                    {/* 操作按钮 */}
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => doAction(project.path, 'up')}
                        disabled={!!actionLoading}
                        className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-emerald-400 disabled:opacity-40"
                        title="启动所有服务"
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={() => doAction(project.path, 'down')}
                        disabled={!!actionLoading}
                        className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-amber-400 disabled:opacity-40"
                        title="停止所有服务"
                      >
                        <Square size={14} />
                      </button>
                      <button
                        onClick={() => doAction(project.path, 'restart')}
                        disabled={!!actionLoading}
                        className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-blue-400 disabled:opacity-40"
                        title="重启所有服务"
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        onClick={() => doAction(project.path, 'logs')}
                        disabled={!!actionLoading}
                        className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300 disabled:opacity-40"
                        title="查看日志"
                      >
                        <FileText size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 服务列表 */}
                  {isExpanded && (
                    <div className="border-t border-slate-700/30 px-3 py-2">
                      {actionLoading === `ps:${project.path}` ? (
                        <div className="flex items-center justify-center py-2">
                          <Loader2 size={14} className="animate-spin text-slate-500" />
                        </div>
                      ) : project.services.length === 0 ? (
                        <div className="py-2 text-center text-[11px] text-slate-500">
                          无运行中的服务
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {project.services.map((svc) => {
                            const isRunning = svc.state === 'running'
                            return (
                              <div
                                key={svc.name}
                                className="flex items-center gap-2 rounded px-2 py-1.5"
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    isRunning
                                      ? 'bg-emerald-500'
                                      : svc.state === 'exited'
                                        ? 'bg-slate-500'
                                        : 'bg-amber-500'
                                  }`}
                                />
                                <div className="min-w-0 flex-1">
                                  <span className="text-xs font-medium text-slate-300">
                                    {svc.name}
                                  </span>
                                  <span className="ml-2 text-[10px] text-slate-500">
                                    {svc.status}
                                  </span>
                                </div>
                                <div className="flex shrink-0 gap-0.5">
                                  {isRunning ? (
                                    <button
                                      onClick={() => doAction(project.path, 'stop', svc.name)}
                                      disabled={!!actionLoading}
                                      className="flex items-center gap-0.5 rounded px-2 py-1 text-[10px] text-slate-500 transition-colors hover:bg-slate-700 hover:text-amber-400 disabled:opacity-40"
                                      title="停止"
                                    >
                                      <Square size={10} />
                                      停止
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => doAction(project.path, 'start', svc.name)}
                                      disabled={!!actionLoading}
                                      className="flex items-center gap-0.5 rounded px-2 py-1 text-[10px] text-slate-500 transition-colors hover:bg-slate-700 hover:text-emerald-400 disabled:opacity-40"
                                      title="启动"
                                    >
                                      <Play size={10} />
                                      启动
                                    </button>
                                  )}
                                  <button
                                    onClick={() => doAction(project.path, 'logs', svc.name)}
                                    disabled={!!actionLoading}
                                    className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-40"
                                    title="日志"
                                  >
                                    <FileText size={10} />
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 日志面板 */}
      {logData && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
          onClick={() => setLogData(null)}
        >
          <div
            className="mx-4 flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-3">
              <FileText size={16} className="text-wrench-400 mr-2" />
              <h2 className="text-sm font-semibold text-slate-200">Compose 日志</h2>
              <button
                onClick={() => setLogData(null)}
                className="ml-auto rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-300">
              {logData.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(DockerComposeInner)
