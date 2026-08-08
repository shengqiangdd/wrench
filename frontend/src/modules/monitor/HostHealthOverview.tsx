/**
 * HostHealthOverview.tsx — Multi-host health overview dashboard
 *
 * Shows the health status of all connected SSH hosts with color-coded
 * indicators and optional AI-powered diagnosis.
 *
 * Optimized with React.memo + extracted HostCard to avoid full re-render
 * on each 30s polling cycle.
 */

import { memo, useState, useEffect, useCallback, useReducer, useMemo } from 'react'
import {
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Brain,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { authedFetch } from '../../services/auth'

interface HostHealth {
  id: string
  host: string
  port: number
  username: string
  connected: boolean
  error: string | null
  cpu_load: number | null
  cpu_load_5: number | null
  cpu_load_15: number | null
  cpu_cores: number | null
  mem_total_mb: number | null
  mem_used_mb: number | null
  mem_percent: number | null
  disks: Array<{ mount: string; total: string; used: string; percent: string }>
  uptime: string | null
  processes: number | null
  net_rx_bytes: number
  net_tx_bytes: number
  io_read_sectors: number
  io_write_sectors: number
  top_procs: Array<{ pid: number; user: string; cpu: number; mem: number; command: string }>
}

// ─── Helper fns ───

/** 格式化 uptime 字符串：去掉 "up " 前缀，规范化显示 */
function formatUptime(raw?: string | null): string {
  if (!raw) return '—'
  // 去掉 "up " 前缀（uptime -p 输出如 "up 5 days, 2 hours"）
  const s = raw.replace(/^up\s+/i, '').trim()
  if (!s) return '—'
  // 如果是纯数字（秒），转换为可读格式
  const asNum = parseInt(s, 10)
  if (!isNaN(asNum) && s === String(asNum)) {
    const days = Math.floor(asNum / 86400)
    const hours = Math.floor((asNum % 86400) / 3600)
    const mins = Math.floor((asNum % 3600) / 60)
    if (days > 0) return `${days}天 ${hours}时`
    if (hours > 0) return `${hours}时 ${mins}分`
    return `${mins}分`
  }
  // 截断过长的字符串（如 "5 years, 3 months, 1 day, 2 hours, 30 minutes, 12 seconds"）
  // 保留前两段
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 2) {
    return parts.slice(0, 2).join(', ')
  }
  return s
}

function pctColor(pct: number | null): string {
  if (pct == null) return 'text-slate-500'
  if (pct > 90) return 'text-red-400'
  if (pct > 70) return 'text-amber-400'
  return 'text-emerald-400'
}

function pctBg(pct: number | null): string {
  if (pct == null) return 'bg-slate-600'
  if (pct > 90) return 'bg-red-500'
  if (pct > 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function StatusIcon({ connected, memPct }: { connected: boolean; memPct: number | null }) {
  if (!connected) return <XCircle size={16} className="text-red-400" />
  if (memPct != null && memPct > 90) return <AlertTriangle size={16} className="text-red-400" />
  return <CheckCircle size={16} className="text-emerald-400" />
}
const StatusIconMemo = memo(StatusIcon)

// ─── HostCard sub-component (memoised) ───

interface HostCardProps {
  host: HostHealth
  collapsed: boolean
  diagnosing: string | null
  diagnosis: Record<string, string>
  onDiagnose: () => void
  onSelect: () => void
}

const HostCard = memo(function HostCard({
  host,
  collapsed,
  diagnosing,
  diagnosis,
  onDiagnose,
  onSelect,
}: HostCardProps) {
  // CPU 利用率：raw load / cores × 100（后端 cpu_load 是 load average，不是百分比）
  const cpuPct = useMemo(() => {
    const cores = host.cpu_cores ?? 1
    const load = host.cpu_load ?? 0
    return Math.min(100, Math.round((load / cores) * 1000) / 10)
  }, [host.cpu_load, host.cpu_cores])

  // 取 / 分区或使用率最高的分区
  const rootDisk = useMemo(() => {
    if (!host.disks || host.disks.length === 0) return null
    return (
      host.disks.find((d) => d.mount === '/') ||
      host.disks.reduce((a, b) => (parseFloat(a.percent) >= parseFloat(b.percent) ? a : b))
    )
  }, [host.disks])

  const diskPctNum = rootDisk ? parseFloat(rootDisk.percent) : null

  return (
    <div
      className={`rounded-xl border border-slate-700/50 bg-slate-800/60 p-4 backdrop-blur-sm transition-all hover:border-slate-600/50 ${collapsed ? 'hidden' : ''}`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={onSelect}
          className="flex items-center gap-2 text-left transition-colors hover:text-blue-400"
        >
          <StatusIconMemo connected={host.connected} memPct={host.mem_percent} />
          <span className="font-medium text-slate-200">{host.host}</span>
          <span className="text-xs text-slate-500">:{host.port}</span>
        </button>
        <button
          onClick={onDiagnose}
          disabled={diagnosing === host.id}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-50"
          title="AI Diagnosis"
        >
          {diagnosing === host.id ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Brain size={14} />
          )}
        </button>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        {/* CPU */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu size={12} /> CPU
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold tabular-nums ${pctColor(cpuPct)}`}>
              {host.cpu_load != null ? `${cpuPct.toFixed(1)}%` : '--'}
            </span>
            {host.cpu_cores != null && (
              <span className="text-xs text-slate-500">{host.cpu_cores}核</span>
            )}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${pctBg(cpuPct)}`}
              style={{ width: `${cpuPct}%` }}
            />
          </div>
          {host.cpu_load != null && (
            <div className="mt-1 text-[10px] text-slate-500">负载 {host.cpu_load.toFixed(2)}</div>
          )}
        </div>

        {/* Memory */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <MemoryStick size={12} /> 内存
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold tabular-nums ${pctColor(host.mem_percent)}`}>
              {host.mem_percent != null ? `${host.mem_percent.toFixed(1)}%` : '--'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${pctBg(host.mem_percent)}`}
              style={{ width: `${Math.min(100, host.mem_percent ?? 0)}%` }}
            />
          </div>
          {host.mem_used_mb != null && host.mem_total_mb != null && (
            <div className="mt-1 text-[10px] text-slate-500">
              {(host.mem_used_mb / 1024).toFixed(1)}G / {(host.mem_total_mb / 1024).toFixed(1)}G
            </div>
          )}
        </div>

        {/* Disk */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <HardDrive size={12} /> 磁盘
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold tabular-nums ${pctColor(diskPctNum)}`}>
              {diskPctNum != null ? `${diskPctNum.toFixed(0)}%` : '--'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${pctBg(diskPctNum)}`}
              style={{ width: `${diskPctNum ?? 0}%` }}
            />
          </div>
          {rootDisk && (
            <div className="mt-1 text-[10px] text-slate-500">
              {rootDisk.used} / {rootDisk.total}
            </div>
          )}
        </div>

        {/* Uptime + Processes */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          {host.uptime && (
            <div className="mb-1 text-xs text-slate-400">
              <span className="text-slate-500">运行:</span> {formatUptime(host.uptime)}
            </div>
          )}
          {host.processes != null && (
            <div className="mb-1 text-xs text-slate-400">
              <span className="text-slate-500">进程:</span> {host.processes}
            </div>
          )}
          {!host.connected && <div className="text-xs font-medium text-red-400">离线</div>}
        </div>
      </div>

      {/* Top Processes */}
      {host.top_procs && host.top_procs.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-800/80 p-2.5">
          <div className="mb-1.5 text-xs text-slate-400">Top 进程</div>
          <div className="space-y-1">
            {host.top_procs.slice(0, 5).map((proc) => {
              const cmd = proc.command || ''
              let name = cmd.replace(/^\[|\]$/g, '').split(/\s+/)[0] || ''
              const parts = name.split('/')
              name = parts[parts.length - 1] || name
              if (name.length > 20) name = name.slice(0, 18) + '..'
              const displayName = name || `PID ${proc.pid}`
              return (
                <div key={proc.pid} className="flex items-center justify-between text-[11px]">
                  <div
                    className="min-w-0 flex-1 truncate text-slate-300"
                    title={`${cmd} (${proc.user}:${proc.pid})`}
                  >
                    {displayName}
                  </div>
                  <div className="ml-2 flex shrink-0 gap-2">
                    <span className="text-cyan-400 tabular-nums">{proc.cpu.toFixed(1)}%</span>
                    <span className="text-purple-400 tabular-nums">{proc.mem.toFixed(1)}%</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* AI Diagnosis */}
      {diagnosis[host.id] && (
        <div className="mt-3 rounded-lg bg-slate-800/80 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Brain size={12} /> AI 诊断
          </div>
          <p className="text-xs leading-relaxed text-slate-300">{diagnosis[host.id]}</p>
        </div>
      )}
    </div>
  )
})

// ─── Main component ───

function HostHealthOverviewInner() {
  type HealthState = {
    hosts: HostHealth[]
    status: 'loading' | 'idle' | 'error'
    errorMsg: string | null
  }
  const [healthState, dispatch] = useReducer(
    (s: HealthState, a: Partial<HealthState>) => ({ ...s, ...a }),
    { hosts: [], status: 'loading', errorMsg: null } as HealthState,
  )
  const [collapsed, setCollapsed] = useState(false)
  const [diagnosing, setDiagnosing] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<Record<string, string>>({})
  const { hosts: rawHosts, status, errorMsg } = healthState

  // Deduplicate by id
  const hosts = useMemo(() => {
    const seen = new Set<string>()
    return rawHosts.filter((h) => {
      if (seen.has(h.id)) return false
      seen.add(h.id)
      return true
    })
  }, [rawHosts])

  const loadHealth = useCallback(async () => {
    try {
      const res = await authedFetch('/api/hosts/health')
      const data = await res.json()
      dispatch({ hosts: data.data || [], status: 'idle', errorMsg: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载失败'
      dispatch({ status: 'error', errorMsg: msg })
    }
  }, [])

  useEffect(() => {
    loadHealth()
    let timer: ReturnType<typeof setInterval> | null = null
    if (document.visibilityState === 'visible') {
      timer = setInterval(loadHealth, 30000)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        loadHealth()
        if (!timer) timer = setInterval(loadHealth, 30000)
      } else {
        if (timer) {
          clearInterval(timer)
          timer = null
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadHealth])

  const runDiagnosis = useCallback(async (hostId: string) => {
    setDiagnosing(hostId)
    try {
      const res = await authedFetch('/api/hosts/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      })
      const json = await res.json()
      const diagObj = json.data
      let text: string
      if (diagObj && typeof diagObj === 'object' && 'ai_diagnosis' in diagObj) {
        text = diagObj.ai_diagnosis || diagObj.raw_report || '无诊断结果'
      } else if (typeof diagObj === 'string') {
        text = diagObj
      } else {
        text = '无诊断结果'
      }
      setDiagnosis((prev) => ({ ...prev, [hostId]: text }))
    } catch {
      setDiagnosis((prev) => ({ ...prev, [hostId]: '诊断失败' }))
    } finally {
      setDiagnosing(null)
    }
  }, [])

  // Memoised derived lists
  const critical = useMemo(
    () => hosts.filter((h) => h.connected && (h.mem_percent ?? 0) > 90),
    [hosts],
  )
  const warning = useMemo(
    () =>
      hosts.filter((h) => h.connected && (h.mem_percent ?? 0) > 70 && (h.mem_percent ?? 0) <= 90),
    [hosts],
  )

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-6 text-slate-400">
        <Loader2 size={16} className="mr-2 animate-spin" />
        <span className="text-xs">加载主机健康数据...</span>
      </div>
    )
  }

  if (status === 'error') {
    return <div className="rounded-lg bg-red-900/20 p-3 text-xs text-red-400">{errorMsg}</div>
  }

  return (
    <div className="space-y-2">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-blue-400" />
          <span className="text-xs font-medium text-slate-300">主机健康</span>
          {critical.length > 0 && (
            <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
              {critical.length} 危急
            </span>
          )}
          {warning.length > 0 && (
            <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              {warning.length} 警告
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-700 hover:text-slate-300"
        >
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {collapsed ? '展开' : '收起'}
        </button>
      </div>

      {/* Host cards — scrollable */}
      <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
        {hosts.length === 0 && (
          <div className="py-6 text-center text-xs text-slate-500">
            暂无主机连接。请在 SSH 页面添加并连接主机。
          </div>
        )}
        {hosts.map((host) => (
          <HostCard
            key={host.id}
            host={host}
            collapsed={collapsed}
            diagnosing={diagnosing}
            diagnosis={diagnosis}
            onDiagnose={() => runDiagnosis(host.id)}
            onSelect={() => {}}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(HostHealthOverviewInner)
