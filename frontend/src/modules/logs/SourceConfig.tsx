import { useState, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Plus,
  FileText,
  FolderOpen,
  Settings,
  Loader2,
} from 'lucide-react'
import type { LogSource } from './index'

// 按类别分组的预设日志路径
const LOG_CATEGORIES = [
  {
    label: '系统日志',
    icon: '🖥',
    paths: [
      { path: '/var/log/syslog', label: 'syslog' },
      { path: '/var/log/messages', label: 'messages' },
      { path: '/var/log/kern.log', label: 'kern.log' },
      { path: '/var/log/dmesg', label: 'dmesg' },
    ],
  },
  {
    label: '认证日志',
    icon: '🔐',
    paths: [
      { path: '/var/log/auth.log', label: 'auth.log' },
      { path: '/var/log/secure', label: 'secure' },
      { path: '/var/log/btmp', label: 'btmp (登录失败)' },
    ],
  },
  {
    label: 'Web 服务',
    icon: '🌐',
    paths: [
      { path: '/var/log/nginx/access.log', label: 'Nginx 访问' },
      { path: '/var/log/nginx/error.log', label: 'Nginx 错误' },
      { path: '/var/log/apache2/access.log', label: 'Apache 访问' },
      { path: '/var/log/apache2/error.log', label: 'Apache 错误' },
      { path: '/var/log/httpd/access_log', label: 'httpd 访问' },
      { path: '/var/log/httpd/error_log', label: 'httpd 错误' },
    ],
  },
  {
    label: '数据库',
    icon: '🗄',
    paths: [
      { path: '/var/log/mysql/error.log', label: 'MySQL 错误' },
      { path: '/var/log/mariadb/mariadb.log', label: 'MariaDB' },
      { path: '/var/log/postgresql/postgresql.log', label: 'PostgreSQL' },
      { path: '/var/lib/mongodb/mongod.log', label: 'MongoDB' },
      { path: '/var/log/redis/redis-server.log', label: 'Redis' },
    ],
  },
  {
    label: '应用日志',
    icon: '📦',
    paths: [
      { path: '/var/log/docker.log', label: 'Docker 守护进程' },
      { path: '/var/log/pm2/', label: 'PM2 日志目录' },
      { path: '/var/log/supervisor/', label: 'Supervisor 日志目录' },
      { path: '/var/log/cron.log', label: 'Cron 日志' },
      { path: '/var/log/cron', label: 'Cron (RHEL)' },
    ],
  },
  {
    label: '安全审计',
    icon: '🛡',
    paths: [
      { path: '/var/log/audit/audit.log', label: 'auditd 审计' },
      { path: '/var/log/fail2ban.log', label: 'fail2ban' },
      { path: '/var/log/ufw.log', label: 'UFW 防火墙' },
    ],
  },
]

interface Props {
  connectionId: string
  onSelectPath: (path: string) => void
}

export default function SourceConfig({ connectionId, onSelectPath }: Props) {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [discoverResults, setDiscoverResults] = useState<LogSource[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    系统日志: true,
  })
  const [customPath, setCustomPath] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [customSources, setCustomSources] = useState<LogSource[]>(() => {
    try {
      const saved = localStorage.getItem('wrench_log_custom')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // 保存自定义日志源
  const saveCustom = useCallback((list: LogSource[]) => {
    setCustomSources(list)
    try {
      localStorage.setItem('wrench_log_custom', JSON.stringify(list))
    } catch {
      /* ignore */
    }
  }, [])

  // 远程扫描：检查所有预设路径哪些存在
  const handleRemoteScan = useCallback(async () => {
    setDiscovering(true)
    try {
      // 将所有路径一次性发给后端扫描
      const allPaths = LOG_CATEGORIES.flatMap((c) => c.paths.map((p) => p.path))
      const res = await fetch('/api/logs/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, paths: allPaths }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        const existing: LogSource[] = json.data
          .filter((item: { exists: boolean }) => item.exists)
          .map((item: { path: string; size: string }) => {
            const preset = LOG_CATEGORIES.flatMap((c) => c.paths).find((p) => p.path === item.path)
            return {
              path: item.path,
              label: preset?.label || item.path.split('/').pop() || item.path,
              size: item.size || '',
            }
          })
        setDiscoverResults(existing)
      }
    } catch {
      // ignore
    } finally {
      setDiscovering(false)
    }
  }, [connectionId])

  const handleClick = (path: string) => {
    setActivePath(path)
    onSelectPath(path)
  }

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const handleAddCustom = () => {
    if (!customPath.trim()) return
    const label = customLabel.trim() || customPath.split('/').pop() || customPath
    const newSource = { path: customPath.trim(), label, size: '' }
    const updated = [...customSources.filter((s) => s.path !== newSource.path), newSource]
    saveCustom(updated)
    setCustomPath('')
    setCustomLabel('')
    handleClick(newSource.path)
  }

  // 检查某个路径是否在扫描结果中存在
  const isPathAvailable = (path: string) => discoverResults.some((r) => r.path === path)
  const getPathSize = (path: string) => discoverResults.find((r) => r.path === path)?.size || ''

  return (
    <div className="flex h-full flex-col text-xs">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="font-medium text-slate-300">日志源</span>
        <button
          onClick={handleRemoteScan}
          disabled={discovering}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:text-sky-400 disabled:opacity-50"
          title="扫描远程主机"
        >
          {discovering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          扫描
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {/* 按类别显示预设日志 */}
        {LOG_CATEGORIES.map((cat) => {
          const available = cat.paths.filter((p) => isPathAvailable(p.path))
          const unavailable = cat.paths.filter((p) => !isPathAvailable(p.path))
          const isExpanded = expandedCategories[cat.label] ?? false

          return (
            <div key={cat.label} className="mb-1">
              <button
                onClick={() => toggleCategory(cat.label)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-slate-800"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="mr-1">{cat.icon}</span>
                <span className="text-slate-300">{cat.label}</span>
                {available.length > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-900/50 px-1.5 py-0 text-[10px] text-emerald-400">
                    {available.length}
                  </span>
                )}
                {available.length === 0 && unavailable.length > 0 && (
                  <span className="ml-auto text-[10px] text-slate-600">无</span>
                )}
              </button>

              {isExpanded && (
                <div className="ml-4">
                  {/* 可用的日志文件 */}
                  {available.map((p) => (
                    <button
                      key={p.path}
                      onClick={() => handleClick(p.path)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800 ${
                        activePath === p.path ? 'bg-sky-900/30 text-sky-300' : 'text-slate-400'
                      }`}
                    >
                      <FileText size={12} className="shrink-0 text-emerald-500" />
                      <span className="truncate">{p.label}</span>
                      {getPathSize(p.path) && (
                        <span className="ml-auto shrink-0 text-[10px] text-slate-600">
                          {getPathSize(p.path)}
                        </span>
                      )}
                    </button>
                  ))}
                  {/* 不可用的日志文件（灰色） */}
                  {unavailable.map((p) => (
                    <div
                      key={p.path}
                      className="flex w-full items-center gap-2 px-2 py-1 text-left text-slate-600"
                    >
                      <FileText size={12} className="shrink-0 opacity-30" />
                      <span className="truncate text-slate-700">{p.label}</span>
                      <span className="ml-auto text-[10px] text-slate-800">未找到</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* 自定义日志源 */}
        {customSources.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1 px-2 py-1 text-slate-300">
              <Settings size={12} />
              <span>自定义日志</span>
            </div>
            <div className="ml-4">
              {customSources.map((s) => (
                <button
                  key={s.path}
                  onClick={() => handleClick(s.path)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800 ${
                    activePath === s.path ? 'bg-sky-900/30 text-sky-300' : 'text-slate-400'
                  }`}
                >
                  <FolderOpen size={12} className="shrink-0 text-amber-500" />
                  <span className="truncate">{s.label}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      saveCustom(customSources.filter((cs) => cs.path !== s.path))
                    }}
                    className="ml-auto shrink-0 text-slate-600 hover:text-red-400"
                  >
                    ×
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 添加自定义日志 */}
      <div className="border-t border-slate-700/50 px-3 py-2">
        <div className="flex gap-1">
          <input
            type="text"
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/path/to/log"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          />
          <button
            onClick={handleAddCustom}
            className="flex shrink-0 items-center gap-0.5 rounded bg-slate-700 px-2 py-1 text-slate-400 hover:bg-slate-600 hover:text-slate-200"
          >
            <Plus size={12} />
          </button>
        </div>
        <input
          type="text"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="标签（可选）"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 focus:ring-1 focus:ring-sky-500 focus:outline-none"
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
        />
      </div>

      {/* 搜索 */}
      <div className="border-t border-slate-700/50 px-3 py-2">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="搜索日志路径..."
            className="w-full rounded border border-slate-700 bg-slate-800 py-1 pr-2 pl-6 text-[11px] text-slate-300 placeholder:text-slate-600 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            onChange={(e) => {
              const q = e.target.value.toLowerCase()
              if (q) {
                const match = LOG_CATEGORIES.flatMap((c) => c.paths).find(
                  (p) => p.path.toLowerCase().includes(q) || p.label.toLowerCase().includes(q),
                )
                if (match) handleClick(match.path)
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
