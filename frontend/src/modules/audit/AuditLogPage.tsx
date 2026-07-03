import { useState, useEffect, useCallback } from 'react'
import {
  History,
  RefreshCw,
  Search,
  Terminal,
  FileCode2,
  Container,
  Server,
  PlugZap,
  Download,
  Upload,
  Trash2,
  FolderPlus,
  Pencil,
  Settings,
  KeyRound,
  Bell,
  Activity,
} from 'lucide-react'

interface AuditEntry {
  timestamp: string
  action: string
  detail: string
  ip: string
}

const ACTION_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  ssh_exec: Terminal,
  ssh_connect: Terminal,
  ssh_disconnect: Terminal,
  sftp_upload: Upload,
  sftp_download: Download,
  sftp_delete: Trash2,
  sftp_mkdir: FolderPlus,
  sftp_rename: Pencil,
  sftp_list: FileCode2,
  docker_start: Container,
  docker_stop: Container,
  docker_restart: Container,
  docker_rmi: Trash2,
  docker_pull: Download,
  docker_push: Upload,
  docker_tag: Pencil,
  docker_prune: Trash2,
  docker_compose: Container,
  plugin_install: PlugZap,
  plugin_uninstall: PlugZap,
  ws_token_issued: KeyRound,
}

const ACTION_COLORS: Record<string, string> = {
  ssh_exec: 'text-emerald-400',
  ssh_connect: 'text-emerald-400',
  ssh_disconnect: 'text-slate-400',
  sftp_upload: 'text-blue-400',
  sftp_download: 'text-blue-400',
  sftp_delete: 'text-red-400',
  sftp_mkdir: 'text-yellow-400',
  sftp_rename: 'text-yellow-400',
  docker_start: 'text-cyan-400',
  docker_stop: 'text-orange-400',
  docker_restart: 'text-cyan-400',
  docker_rmi: 'text-red-400',
  docker_pull: 'text-blue-400',
  docker_push: 'text-purple-400',
  docker_prune: 'text-red-400',
  plugin_install: 'text-violet-400',
  plugin_uninstall: 'text-violet-400',
  ws_token_issued: 'text-slate-500',
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function ActionIcon({ action }: { action: string }) {
  const Icon = ACTION_ICONS[action]
  return Icon ? <Icon size={14} /> : <Activity size={14} />
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/audit-logs')
      const json = await res.json()
      if (json.success) {
        setLogs(json.data.logs)
        setTotal(json.data.total)
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
    const timer = setInterval(fetchLogs, 10000)
    return () => clearInterval(timer)
  }, [fetchLogs])

  const actionTypes = [...new Set(logs.map((l) => l.action))].sort()

  const filtered = logs.filter((entry) => {
    if (filter !== 'all' && entry.action !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      const text = `${entry.action} ${entry.detail} ${entry.timestamp}`.toLowerCase()
      if (!text.includes(q)) return false
    }
    return true
  })

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800/50 px-4 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input w-full pl-8 text-xs"
            placeholder="搜索操作记录..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input w-auto text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">全部 ({total})</option>
          {actionTypes.map((a) => (
            <option key={a} value={a}>
              {formatAction(a)} ({logs.filter((l) => l.action === a).length})
            </option>
          ))}
        </select>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="btn btn-ghost p-2"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">
            {loading ? '加载中...' : '暂无操作记录'}
          </div>
        ) : (
          <div className="divide-y divide-slate-800/30">
            {filtered.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-slate-800/20"
              >
                <div className={`mt-0.5 shrink-0 ${ACTION_COLORS[entry.action] || 'text-slate-500'}`}>
                  <ActionIcon action={entry.action} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-300">
                      {formatAction(entry.action)}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {entry.timestamp}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 break-all whitespace-pre-wrap line-clamp-2">
                    {formatDetail(entry.action, entry.detail)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatDetail(action: string, detailStr: string): string {
  try {
    const detail = JSON.parse(detailStr)
    if (action.startsWith('ssh_') && detail.command) {
      return `$ ${detail.command}`
    }
    if (action.startsWith('sftp_')) {
      const d = detail.detail || detail
      if (d.path) return d.path
      if (d.from && d.to) return `${d.from} → ${d.to}`
    }
    if (action.startsWith('docker_')) {
      const args = detail.args
      if (Array.isArray(args)) return `docker ${args.join(' ')}`
    }
    return JSON.stringify(detail)
  } catch {
    return detailStr
  }
}
