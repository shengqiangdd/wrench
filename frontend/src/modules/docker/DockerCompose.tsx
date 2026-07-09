import { memo, useCallback, useState } from 'react'
import {
  Layers,
  RefreshCw,
  Play,
  Square,
  StopCircle,
  FileText,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
  RotateCcw,
} from 'lucide-react'

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const ev = new CustomEvent('wrench-toast', { detail: { message, type } })
  window.dispatchEvent(ev)
}

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
  state?: string
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

  const handleManualLoad = useCallback(async () => {
    if (!manualPath.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, filePath: manualPath.trim() }),
      })
      const json = await res.json()
      if (!json.success) {
        notify(json.error || '加载失败', 'error')
        return
      }
      const path = manualPath.trim()
      const parts = path.replace(/\/+$/, '').split('/')
      const projectName =
        parts.slice(0, -1).filter(Boolean).pop() || path.replace(/\.(yml|yaml)$/, '')
      setProjects([{ path, name: projectName, services: [] }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      notify(msg, 'error')
    } finally {
      setLoading(false)
    }
  }, [connectionId, manualPath])

  const discoverProjects = useCallback(async () => {
    // 如果有手动路径，加载它
    if (manualPath.trim()) {
      return handleManualLoad()
    }
    setLoading(true)
    try {
      const res = await fetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = await res.json()
      if (!json.success) {
        notify(json.error || json.msg || '获取 Compose 文件失败', 'error')
        setProjects([])
        return
      }

      // 后端返回 { success, data: { projects: [...] } } 或 { success, data: { data: "raw" } }
      const projectsData =
        json.data?.projects ?? json.data?.data ?? json.data ?? json.projects ?? []

      let parsed: ComposeProject[] = []

      if (Array.isArray(projectsData)) {
        // 新格式：后端解析好的结构化数据
        parsed = projectsData.map(
          (p: { path?: string; name?: string; ConfigFiles?: string; Name?: string }) => {
            const filePath = p.path || p.ConfigFiles || ''
            const projName =
              p.name ||
              p.Name ||
              filePath
                .split('/')
                .pop()!
                .replace(/\.(yml|yaml)$/, '')
            return { path: filePath, name: projName, services: [] }
          },
        )
      } else {
        // 旧格式：原始字符串，每行一个路径
        const output = String(projectsData)
        const paths = output.trim().split('\n').filter(Boolean)
        parsed = paths.map((p: string) => {
          const parts = p.replace(/\/+$/, '').split('/')
          const fileName = parts[parts.length - 1] || 'docker-compose.yml'
          const dir = parts.slice(0, -1).join('/') || '/'
          const projectName =
            dir.split('/').filter(Boolean).pop() || fileName.replace(/\.(yml|yaml)$/, '')
          return { path: p, name: projectName, services: [] }
        })
      }

      setProjects(parsed)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      notify(msg, 'error')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [connectionId, manualPath, handleManualLoad])

  // 展开项目时获取 services 状态
  const fetchServices = useCallback(
    async (path: string) => {
      setActionLoading(`ps:${path}`)
      try {
        const res = await fetch('/api/docker/compose/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, filePath: path, action: 'ps' }),
        })
        const json = await res.json()
        if (json.success) {
          const output = (json.data?.data ?? json.data ?? '').toString()
          const lines = output.trim().split('\n').filter(Boolean)
          const services: ComposeService[] = lines.map((line: string) => {
            try {
              const parsed = JSON.parse(line)
              return {
                name: parsed.Name || parsed.Service || '-',
                status: parsed.Status || parsed.State || '-',
                image: parsed.Image || '-',
                ports: parsed.Ports || '',
                state: parsed.State || '',
              }
            } catch {
              // plain text format fallback
              const parts = line.split(/\s{2,}/)
              return {
                name: parts[0] || '-',
                status: parts[1] || '-',
                image: parts[2] || '-',
                ports: parts[3] || '',
              }
            }
          })
          setProjects((prev) => prev.map((p) => (p.path === path ? { ...p, services } : p)))
        } else {
          // compose ps 失败可能是 docker compose 不支持，不影响列表显示
          setProjects((prev) => prev.map((p) => (p.path === path ? { ...p, services: [] } : p)))
        }
      } catch {
        // ignore
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
      fetchServices(path)
    }
  }

  // Compose 操作
  const doAction = async (path: string, action: string, service?: string) => {
    const key = `${action}:${path}:${service || ''}`
    if (actionLoading) return
    setActionLoading(key)
    // Clear previous log data when fetching new logs
    if (action === 'logs') setLogData({ key, content: '' })
    try {
      const res = await fetch('/api/docker/compose/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, filePath: path, action, service }),
      })
      const json = await res.json()
      if (!json.success) {
        notify(`${action} 失败: ${json.error || json.msg || '未知错误'}`, 'error')
      } else if (action === 'logs') {
        const output = (json.data?.data ?? json.data ?? '').toString()
        setLogData({ key, content: output || '(empty)' })
      } else {
        notify(`${action} 成功`, 'success')
      }
      // 操作完成后刷新状态
      if (expandedPath === path && action !== 'logs') {
        setTimeout(() => fetchServices(path), 500)
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
  }

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div className="p-4">
      {/* 工具栏 */}
      <div className="mb-3 flex items-center gap-2">
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
      <div className="mb-3 flex items-center gap-2">
        <input
          type="text"
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          placeholder="手动输入 compose 文件路径..."
          className="focus:border-wrench-500/50 flex-1 rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300 placeholder-slate-500 outline-none"
        />
        <button
          onClick={() => handleManualLoad()}
          disabled={loading || !manualPath.trim()}
          className="bg-wrench-600 hover:bg-wrench-500 rounded-md px-3 py-1.5 text-xs text-white transition-colors disabled:opacity-50"
        >
          加载
        </button>
      </div>

      {/* 项目列表 */}
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
                    <div className="truncate text-sm font-medium text-slate-200">
                      {project.name}
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
                      disabled={actionLoading === `up:${project.path}`}
                      className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-emerald-400 disabled:opacity-40"
                      title="启动"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'down')}
                      disabled={actionLoading === `down:${project.path}`}
                      className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-amber-400 disabled:opacity-40"
                      title="停止"
                    >
                      <Square size={14} />
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'restart')}
                      disabled={actionLoading === `restart:${project.path}`}
                      className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-blue-400 disabled:opacity-40"
                      title="重启"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'logs')}
                      disabled={actionLoading === `logs:${project.path}`}
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
                        {project.services.map((svc) => (
                          <div
                            key={svc.name}
                            className="flex items-center gap-2 rounded px-2 py-1 text-xs"
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                svc.state === 'running'
                                  ? 'bg-emerald-500'
                                  : svc.state === 'exited'
                                    ? 'bg-red-500'
                                    : 'bg-slate-500'
                              }`}
                            />
                            <span className="min-w-0 flex-1 truncate text-slate-300">
                              {svc.name}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-500">
                              {svc.status}
                            </span>
                            <div className="flex shrink-0 gap-0.5">
                              <button
                                onClick={() => doAction(project.path, 'up', svc.name)}
                                disabled={!!actionLoading}
                                className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-emerald-400 disabled:opacity-40"
                                title="启动"
                              >
                                <Play size={10} />
                              </button>
                              <button
                                onClick={() => doAction(project.path, 'stop', svc.name)}
                                disabled={!!actionLoading}
                                className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-amber-400 disabled:opacity-40"
                                title="停止"
                              >
                                <StopCircle size={10} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 日志面板 */}
      {logData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
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
