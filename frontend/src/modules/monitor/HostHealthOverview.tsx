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
  disk_total: string | null
  disk_used: string | null
  disk_percent: string | null
  uptime: string | null
  processes: number | null
}

// ─── Helper fns ───

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

// ─── HostCard sub‑component (memoised) ───

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
          <span className="text-xs text-slate-500">port {host.port}</span>
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
            <span className={`text-lg font-semibold tabular-nums ${pctColor(host.cpu_load)}`}>
              {host.cpu_load != null ? `${host.cpu_load.toFixed(1)}%` : '--'}
            </span>
            {host.cpu_cores != null && (
              <span className="text-xs text-slate-500">{host.cpu_cores} cores</span>
            )}
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${pctBg(host.cpu_load)}`}
              style={{ width: `${host.cpu_load ?? 0}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <MemoryStick size={12} /> Memory
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-lg font-semibold tabular-nums ${pctColor(host.mem_percent)}`}>
              {host.mem_percent != null ? `${host.mem_percent.toFixed(1)}%` : '--'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${pctBg(host.mem_percent)}`}
              style={{ width: `${host.mem_percent ?? 0}%` }}
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
            <HardDrive size={12} /> Disk
          </div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-lg font-semibold tabular-nums ${pctColor(host.disk_percent != null ? parseFloat(host.disk_percent) : null)}`}
            >
              {host.disk_percent != null ? `${host.disk_percent}` : '--'}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
            <div
              className={`h-full rounded-full ${pctBg(host.disk_percent != null ? parseFloat(host.disk_percent) : null)}`}
              style={{ width: `${host.disk_percent != null ? parseFloat(host.disk_percent) : 0}%` }}
            />
          </div>
          {host.disk_used != null && host.disk_total != null && (
            <div className="mt-1 text-[10px] text-slate-500">
              {host.disk_used} / {host.disk_total}
            </div>
          )}
        </div>

        {/* Uptime + Processes */}
        <div className="rounded-lg bg-slate-800/80 p-2.5">
          {host.uptime && (
            <div className="mb-2 text-xs text-slate-400">
              <span className="text-slate-500">Uptime:</span> {host.uptime}
            </div>
          )}
          {host.processes != null && (
            <div className="text-xs text-slate-400">
              <span className="text-slate-500">Processes:</span> {host.processes}
            </div>
          )}
          {!host.connected && <div className="text-xs text-red-400">Disconnected</div>}
        </div>
      </div>

      {/* AI Diagnosis */}
      {diagnosis[host.id] && (
        <div className="mt-3 rounded-lg bg-slate-800/80 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Brain size={12} /> AI Diagnosis
          </div>
          <p className="text-xs leading-relaxed text-slate-300">{diagnosis[host.id]}</p>
        </div>
      )}
    </div>
  )
})

// ─── Main component ───

function HostHealthOverviewInner({ onSelectHost }: { onSelectHost?: (hostId: string) => void }) {
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
  const { hosts, status, errorMsg } = healthState

  const loadHealth = useCallback(async () => {
    try {
      const res = await authedFetch('/api/hosts/health')
      const data = await res.json()
      dispatch({ hosts: data.data || [], status: 'idle', errorMsg: null })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load'
      dispatch({ status: 'error', errorMsg: msg })
    }
  }, [])

  useEffect(() => {
    loadHealth()
    const timer = setInterval(loadHealth, 30000)
    return () => clearInterval(timer)
  }, [loadHealth])

  const runDiagnosis = useCallback(async (hostId: string) => {
    setDiagnosing(hostId)
    try {
      const res = await authedFetch('/api/hosts/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      })
      const data = await res.json()
      setDiagnosis((prev) => ({ ...prev, [hostId]: data.data ?? 'No diagnosis available' }))
    } catch {
      setDiagnosis((prev) => ({ ...prev, [hostId]: 'Diagnosis failed' }))
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
      <div className="flex items-center justify-center py-12 text-slate-400">
        <Loader2 size={20} className="mr-2 animate-spin" />
        Loading host health...
      </div>
    )
  }

  if (status === 'error') {
    return <div className="rounded-lg bg-red-900/20 p-4 text-sm text-red-400">{errorMsg}</div>
  }

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server size={16} className="text-blue-400" />
          <span className="text-sm font-medium text-slate-300">Host Health</span>
          {critical.length > 0 && (
            <span className="rounded bg-red-900/30 px-2 py-0.5 text-[10px] font-medium text-red-400">
              {critical.length} critical
            </span>
          )}
          {warning.length > 0 && (
            <span className="rounded bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              {warning.length} warning
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-700 hover:text-slate-300"
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {/* Host cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {hosts.length === 0 && (
          <div className="col-span-full py-8 text-center text-sm text-slate-500">
            No hosts connected. Add a host in the SSH connection panel.
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
            onSelect={() => onSelectHost?.(host.id)}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(HostHealthOverviewInner)
