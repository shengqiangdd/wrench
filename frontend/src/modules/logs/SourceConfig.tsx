import { useState, useCallback, useEffect, useRef } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Plus,
  FileText,
  FolderOpen,
  Loader2,
} from 'lucide-react'
import type { LogSource } from './index'

// 过滤掉压缩/加密日志，保留编号轮转（如 boot.log.3）
function isReadableLogFile(path: string): boolean {
  return !/\.(gz|bz2|xz|zst|Z|zip)$/.test(path)
}

// 按关键词分类
function matchCategory(path: string): string {
  const lower = path.toLowerCase()
  if (/syslog|messages|kern|dmesg|boot|maillog/.test(lower)) return '系统日志'
  if (/auth|secure|btmp|wtmp|lastlog|faillog/.test(lower)) return '认证日志'
  if (/nginx|apache|httpd|caddy|lighttpd/.test(lower)) return 'Web 服务'
  if (/mysql|mariadb|postgres|mongo|redis/.test(lower)) return '数据库'
  if (/docker|pm2|supervisor|cron|node|java|tomcat/.test(lower)) return '应用日志'
  if (/apt|dpkg|yum|dnf|rpm/.test(lower)) return '包管理'
  if (/audit|fail2ban|ufw|firewall|selinux|apparmor/.test(lower)) return '安全审计'
  return '其他日志'
}

// 生成友好标签
function makeLabel(path: string): string {
  const parts = path.split('/')
  const name = parts[parts.length - 1] || path
  const base = name.replace(/\.log$/, '').replace(/\.log\.\d+$/, '')
  const parent = parts.length > 3 ? parts[parts.length - 2] : ''
  if (parent && parent !== 'log') return `${parent}/${base}`
  return base
}

const CATEGORY_ICONS: Record<string, string> = {
  系统日志: '🖥',
  认证日志: '🔐',
  'Web 服务': '🌐',
  数据库: '🗄',
  应用日志: '📦',
  包管理: '📥',
  安全审计: '🛡',
  其他日志: '📄',
}

interface Props {
  connectionId: string | null
  onSelectPath: (path: string) => void
  /** 变化时触发重新扫描 */
  scanKey?: number
}

export default function SourceConfig({ connectionId, onSelectPath, scanKey }: Props) {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [allFiles, setAllFiles] = useState<LogSource[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({})
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

  const saveCustom = useCallback((list: LogSource[]) => {
    setCustomSources(list)
    try {
      localStorage.setItem('wrench_log_custom', JSON.stringify(list))
    } catch {
      /* */
    }
  }, [])

  // 远程扫描
  const doScan = useCallback(async (connId: string | null) => {
    if (!connId) return
    setDiscovering(true)
    try {
      const { authedFetch } = await import('../../services/auth')
      const res = await authedFetch('/api/logs/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId, paths: [] }),
      })
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        const files: LogSource[] = json.data
          .filter(
            (item: { exists: boolean; path: string }) =>
              item.exists && isReadableLogFile(item.path),
          )
          .map((item: { path: string; size: string }) => ({
            path: item.path,
            label: makeLabel(item.path),
            size: item.size || '',
          }))
        const seen = new Set<string>()
        const unique = files.filter((f) => {
          if (seen.has(f.path)) return false
          seen.add(f.path)
          return true
        })
        setAllFiles(unique)
        const expanded: Record<string, boolean> = {}
        unique.forEach((f) => {
          expanded[matchCategory(f.path)] = true
        })
        setExpandedCategories(expanded)
      }
    } catch {
      /* */
    } finally {
      setDiscovering(false)
    }
  }, [])

  // 首次挂载扫描 + connectionId/scanKey 变化时重新扫描
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!connectionId) return
    if (!mountedRef.current) {
      mountedRef.current = true
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- doScan 是 async，setState 在微任务中执行
    void doScan(connectionId)
  }, [connectionId, scanKey, doScan])

  const handleClick = (path: string) => {
    setActivePath(path)
    onSelectPath(path)
  }

  const toggleCategory = (label: string) => {
    setExpandedCategories((prev) => ({ ...prev, [label]: !prev[label] }))
  }

  const handleAddCustom = () => {
    if (!customPath.trim()) return
    const label = customLabel.trim() || makeLabel(customPath.trim())
    const newSource = { path: customPath.trim(), label, size: '' }
    const updated = [...customSources.filter((s) => s.path !== newSource.path), newSource]
    saveCustom(updated)
    setCustomPath('')
    setCustomLabel('')
    handleClick(newSource.path)
  }

  // 按分类分组
  const grouped: Record<string, LogSource[]> = {}
  for (const file of allFiles) {
    const cat = matchCategory(file.path)
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat]!.push(file)
  }
  const categoryOrder = [
    '系统日志',
    '认证日志',
    'Web 服务',
    '数据库',
    '应用日志',
    '包管理',
    '安全审计',
    '其他日志',
  ]
  const sortedCategories = categoryOrder.filter((c) => grouped[c] && grouped[c]!.length > 0)

  return (
    <div className="flex h-full w-56 flex-col text-xs">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="font-medium text-slate-300">日志源</span>
        <button
          onClick={() => doScan(connectionId)}
          disabled={discovering}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:text-sky-400 disabled:opacity-50"
          title="扫描远程主机"
        >
          {discovering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          扫描
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-1">
        {sortedCategories.map((cat) => {
          const files = grouped[cat]!
          const isExpanded = expandedCategories[cat] ?? false
          const icon = CATEGORY_ICONS[cat] || '📄'

          return (
            <div key={cat} className="mb-1">
              <button
                onClick={() => toggleCategory(cat)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-left hover:bg-slate-800"
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="mr-1">{icon}</span>
                <span className="text-slate-300">{cat}</span>
                <span className="ml-auto rounded-full bg-emerald-900/50 px-1.5 py-0 text-[10px] text-emerald-400">
                  {files.length}
                </span>
              </button>

              {isExpanded && (
                <div className="ml-4">
                  {files.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => handleClick(f.path)}
                      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-slate-800 ${
                        activePath === f.path ? 'bg-sky-900/30 text-sky-300' : 'text-slate-400'
                      }`}
                      title={f.path}
                    >
                      <FileText size={12} className="shrink-0 text-emerald-500" />
                      <span className="truncate">{f.label}</span>
                      {f.size && (
                        <span className="ml-auto shrink-0 text-[10px] text-slate-600">
                          {f.size}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {discovering && allFiles.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">扫描中...</span>
          </div>
        )}

        {!discovering && allFiles.length === 0 && (
          <div className="py-8 text-center text-slate-500">
            <p className="text-xs">未发现日志文件</p>
            <button
              onClick={() => doScan(connectionId)}
              className="mt-2 text-sky-400 hover:text-sky-300"
            >
              重新扫描
            </button>
          </div>
        )}

        {/* 自定义日志源 */}
        {customSources.length > 0 && (
          <div className="mt-2 mb-1 border-t border-slate-700/30 pt-2">
            <div className="flex items-center gap-1 px-2 py-1 text-slate-300">
              <FolderOpen size={12} />
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
                const match = allFiles.find(
                  (f) => f.path.toLowerCase().includes(q) || f.label.toLowerCase().includes(q),
                )
                // 仅高亮匹配项，不自动选中（避免移动端面板自动关闭）
                if (match) setActivePath(match.path)
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}
