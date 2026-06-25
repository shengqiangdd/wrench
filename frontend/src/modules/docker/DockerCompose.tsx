import { useState, useEffect, useCallback } from 'react'
import {
  Layers,
  RefreshCw,
  Play,
  Square,
  RotateCcw,
  StopCircle,
  FileText,
  Terminal,
  AlertCircle,
  Loader2,
  ChevronRight,
  ChevronDown,
  Search,
} from 'lucide-react'

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

export default function DockerCompose({ connectionId }: Props) {
  const [projects, setProjects] = useState<ComposeProject[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const discoverProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 自动发现 compose 文件
      const res = await fetch('/api/docker/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error || '获取 Compose 文件失败')
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
        const projectName = dir.split('/').filter(Boolean).pop() || fileName.replace(/\.(yml|yaml)$/, '')
        return { path: p, name: projectName, services: [] }
      })
      setProjects(parsed)
    } catch (err: any) {
      setError(err.message || '请求失败')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // 展开项目时获取 services 状态
  const fetchServices = useCallback(async (path: string) => {
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
        setProjects((prev) =>
          prev.map((p) => (p.path === path ? { ...p, services } : p)),
        )
      } else {
        setProjects((prev) =>
          prev.map((p) => (p.path === path ? { ...p, services: [] } : p)),
        )
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null)
    }
  }, [connectionId])

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
    try {
      const res = await fetch('/api/docker/compose/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, filePath: path, action, service }),
      })
      const json = await res.json()
      // 操作完成后刷新状态
      if (expandedPath === path) {
        setTimeout(() => fetchServices(path), 500)
      }
      return json
    } catch {
      // ignore
    } finally {
      setActionLoading(null)
    }
  }

  useEffect(() => {
    discoverProjects()
  }, [discoverProjects])

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
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
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

      {/* 错误 */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-red-950/30 px-3 py-2 text-xs text-red-400">
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

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
                <Layers size={16} className="shrink-0 text-smartbox-400" />
                <div className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-200">{project.name}</span>
                    {project.services.length > 0 && (
                      <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {project.services.length} 服务
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500 font-mono">
                    {project.path}
                  </div>
                </div>
                {/* 快捷操作按钮 */}
                {expandedPath === project.path && (
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => doAction(project.path, 'up')}
                      disabled={!!actionLoading}
                      className="rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10 disabled:opacity-30"
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
                      className="rounded p-1 text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-30"
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
                      className="rounded p-1 text-orange-400 transition-colors hover:bg-orange-500/10 disabled:opacity-30"
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
                      className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-30"
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
                              <span className={`text-[10px] ${
                                svc.state === 'running' ? 'text-emerald-400' : 'text-slate-500'
                              }`}>
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
                              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300 disabled:opacity-30"
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
                              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300 disabled:opacity-30"
                              title={`查看 ${svc.name} 日志`}
                            >
                              <FileText size={12} />
                            </button>
                            <button
                              onClick={() => doAction(project.path, 'stop', svc.name)}
                              disabled={!!actionLoading}
                              className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-orange-400 disabled:opacity-30"
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
                  {actionLoading?.startsWith('logs:') && (
                    <div className="border-t border-slate-800/40 bg-slate-950/60 px-4 py-2">
                      <div className="flex items-center gap-2 text-xs text-amber-400/70">
                        <Loader2 size={12} className="animate-spin" />
                        获取日志...
                      </div>
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
