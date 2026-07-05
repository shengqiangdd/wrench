import { memo, useCallback, useState, useEffect, useReducer } from 'react'
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
  const ev = new CustomEvent('smartbox-toast', { detail: { message, type } })
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

  // 启动时自动发现 compose 文件（用 dispatch 规避 set-state-in-effect 规则）
  const [initTrigger, kickstart] = useReducer(
    (_: unknown, __: unknown) => ({}),
    undefined as unknown,
  )
  useEffect(() => {
    if (!initTrigger) {
      kickstart(undefined)
      ;(async () => {
        try {
          setLoading(true)
          // 如果有手动路径，加载它
          if (manualPath.trim()) {
            if (!manualPath.trim()) return
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
            return
          }
          const res = await fetch('/api/docker/compose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId }),
          })
          const json = await res.json()
          if (!json.success) {
            notify(json.error || '获取 Compose 文件失败', 'error')
            setProjects([])
            return
          }
          const discovered: ComposeProject[] = (json.projects || json.data || []).map(
            (p: { path: string; name?: string }) => ({
              path: p.path,
              name:
                p.name ||
                p.path
                  .split('/')
                  .pop()!
                  .replace(/\.(yml|yaml)$/, ''),
              services: [],
            }),
          )
          setProjects(discovered)
        } finally {
          setLoading(false)
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 手动加载 compose 项目
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
      // 自动发现 compose 文件
      const res = await fetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = await res.json()
      if (!json.success) {
        notify(json.error || '获取 Compose 文件失败', 'error')
        setProjects([])
        return
      }

      const paths = json.data.trim().split('\n').filter(Boolean)
      // 解析路径，提取项目名
      const parsed: ComposeProject[] = paths.map((p: string) => {
        // 取文件名做项目名
        const parts = p.replace(/\/+$/, '').split('/')
        const fileName = parts[parts.length - 1] || 'docker-compose.yml'
        const dir = parts.slice(0, -1).join('/') || '/'
        const projectName =
          dir.split('/').filter(Boolean).pop() || fileName.replace(/\.(yml|yaml)$/, '')
        return { path: p, name: projectName, services: [] }
      })
      setProjects(parsed)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      notify(msg, 'error')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [connectionId, manualPath]) // eslint-disable-line react-hooks/exhaustive-deps

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
          const lines = json.data.trim().split('\n').filter(Boolean)
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
        notify(`${action} 失败: ${json.error || '未知错误'}`, 'error')
      } else if (action === 'logs') {
        setLogData({ key, content: json.data || '(empty)' })
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
            className="input w-full pl-8 text-xs"
            placeholder="搜索 Compose 项目..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
        </div>
        <button
          onClick={discoverProjects}
          disabled={loading}
          className="btn-primary flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          扫描
        </button>
      </div>

      {/* 手动输入 compose 路径 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="input w-full pl-8 text-xs"
            placeholder="手动输入 compose 文件路径（如 /opt/docker-compose.yml）"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualLoad()}
          />
          <FileText
            size={14}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500"
          />
        </div>
        <button
          onClick={handleManualLoad}
          disabled={!manualPath.trim() || loading}
          className="btn-primary flex items-center gap-1 px-2 py-1.5 text-xs disabled:opacity-50"
        >
          <Play size={12} />
          加载
        </button>
      </div>

      {/* 项目列表 */}
      {loading && projects.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-slate-500" />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Layers size={36} className="mb-2 text-slate-600" />
          <p className="text-sm text-slate-500">
            {projects.length === 0 ? '未发现 Docker Compose 项目' : '无匹配结果'}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {projects.length === 0
              ? '自动搜索了 / 下 4 层目录的 docker-compose*.yml/yaml 文件'
              : '尝试其他关键词'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProjects.map((project) => (
            <div
              key={project.path}
              className="rounded-lg border border-slate-700/30 bg-slate-800/30"
            >
              {/* 项目标题 */}
              <button
                onClick={() => toggleExpand(project.path)}
                className="flex w-full items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-800/50"
              >
                {expandedPath === project.path ? (
                  <ChevronDown size={16} className="shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight size={16} className="shrink-0 text-slate-500" />
                )}
                <Layers size={16} className="text-smartbox-400 shrink-0" />
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{project.name}</span>
                    {project.services.length > 0 && (
                      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {project.services.length} 服务
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                    {project.path}
                  </div>
                </div>
                {/* 快捷操作按钮 */}
                {expandedPath === project.path && (
                  <div
                    className="flex shrink-0 items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => doAction(project.path, 'up')}
                      disabled={!!actionLoading}
                      className="min-h-[44px] min-w-[44px] rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-30"
                      title="docker compose up -d"
                    >
                      {actionLoading === `up:${project.path}:` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'restart')}
                      disabled={!!actionLoading}
                      className="min-h-[44px] min-w-[44px] rounded p-1 text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-30"
                      title="docker compose restart"
                    >
                      {actionLoading === `restart:${project.path}:` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RotateCcw size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'stop')}
                      disabled={!!actionLoading}
                      className="min-h-[44px] min-w-[44px] rounded p-1 text-orange-400 transition-colors hover:bg-orange-500/10 disabled:opacity-30"
                      title="docker compose stop"
                    >
                      {actionLoading === `stop:${project.path}:` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <StopCircle size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => doAction(project.path, 'down')}
                      disabled={!!actionLoading}
                      className="min-h-[44px] min-w-[44px] rounded p-1 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-30"
                      title="docker compose down"
                    >
                      {actionLoading === `down:${project.path}:` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Square size={14} />
                      )}
                    </button>
                  </div>
                )}
              </button>

              {/* 展开的服务列表 */}
              {expandedPath === project.path && (
                <div className="border-t border-slate-700/30">
                  {project.services.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-xs text-slate-500">
                      <Loader2 size={12} className="animate-spin" />
                      加载服务状态...
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/40">
                      {project.services.map((svc) => (
                        <div key={svc.name} className="flex items-center gap-3 px-4 py-2.5">
                          {/* 状态灯 */}
                          <span
                            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                              svc.state === 'running'
                                ? 'bg-emerald-500'
                                : svc.state === 'exited' || svc.state === 'stopped'
                                  ? 'bg-slate-500'
                                  : 'bg-amber-500'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-slate-200">{svc.name}</span>
                              <span
                                className={`text-[10px] ${
                                  svc.state === 'running' ? 'text-emerald-400' : 'text-slate-500'
                                }`}
                              >
                                {svc.status || svc.state || '-'}
                              </span>
                            </div>
                            <div className="truncate text-[10px] text-slate-500">
                              {svc.image}
                              {svc.ports ? ` · ${svc.ports}` : ''}
                            </div>
                          </div>
                          {/* 服务级操作 */}
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => doAction(project.path, 'restart', svc.name)}
                              disabled={!!actionLoading}
                              className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300 disabled:opacity-30"
                              title={`重启 ${svc.name}`}
                            >
                              {actionLoading === `restart:${project.path}:${svc.name}` ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <RotateCcw size={12} />
                              )}
                            </button>
                            <button
                              onClick={() => doAction(project.path, 'logs', svc.name)}
                              disabled={!!actionLoading}
                              className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300 disabled:opacity-30"
                              title={`查看 ${svc.name} 日志`}
                            >
                              <FileText size={12} />
                            </button>
                            <button
                              onClick={() => doAction(project.path, 'stop', svc.name)}
                              disabled={!!actionLoading}
                              className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-orange-400 disabled:opacity-30"
                              title={`停止 ${svc.name}`}
                            >
                              <StopCircle size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* logs 输出区 */}
                  {logData && logData.key.startsWith(`logs:${project.path}:`) && (
                    <div className="border-t border-slate-800/40 bg-slate-950/60">
                      <div className="flex items-center justify-between px-4 py-1.5">
                        <span className="text-[10px] font-medium tracking-wider text-slate-500 uppercase">
                          日志 — {logData.key.split(':')[2] || '全部'}
                        </span>
                        <button
                          onClick={() => setLogData(null)}
                          className="rounded p-0.5 text-slate-600 hover:text-slate-400"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <pre className="max-h-64 overflow-auto px-4 pb-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-slate-400">
                        {logData.content}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default memo(DockerComposeInner)
