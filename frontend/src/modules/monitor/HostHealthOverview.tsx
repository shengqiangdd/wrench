/**
 * HostHealthOverview.tsx — Multi-host health overview dashboard
 *
 * Shows the health status of all connected SSH hosts with color-coded
 * indicators and optional AI-powered diagnosis.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
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

function healthColor(percent: number | null): string {
  if (percent == null) return 'text-slate-500'
  if (percent > 90) return 'text-red-400'
  if (percent > 70) return 'text-amber-400'
  return 'text-emerald-400'
}

function healthBg(percent: number | null): string {
  if (percent == null) return 'bg-slate-600'
  if (percent > 90) return 'bg-red-500'
  if (percent > 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function statusIcon(connected: boolean, memPct: number | null) {
  if (!connected) return <XCircle size={16} className="text-red-400" />
  if (memPct != null && memPct > 90) return <AlertTriangle size={16} className="text-red-400" />
  return <CheckCircle size={16} className="text-emerald-400" />
}

export default function HostHealthOverview({
  onSelectHost,
}: {
  onSelectHost?: (hostId: string) => void
}) {
  const [hosts, setHosts] = useState<HostHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [diagnosing, setDiagnosing] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<Record<string, string>>({})

  const loadHealth = useCallback(async () => {
    try {
      const res = await authedFetch('/api/hosts/health')
      const data = await res.json()
      setHosts(data.data || [])
      setError(null)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHealth()
    const timer = setInterval(loadHealth, 30000) // auto-refresh every 30s
    return () => clearInterval(timer)
  }, [loadHealth])

  const runDiagnosis = async (hostId: string) => {
    setDiagnosing(hostId)
    try {
      const res = await authedFetch('/api/hosts/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      })
      const data = await res.json()
      const diag = data.data?.aiDiagnosis || data.data?.rawReport || '诊断不可用'
      setDiagnosis((prev) => ({ ...prev, [hostId]: diag }))
    } catch (e: any) {
      setDiagnosis((prev) => ({ ...prev, [hostId]: '诊断失败: ' + (e.message || '未知错误') }))
    } finally {
      setDiagnosing(null)
    }
  }

  const critical = hosts.filter((h) => h.connected && (h.mem_percent ?? 0) > 90)
  const warning = hosts.filter(
    (h) => h.connected && (h.mem_percent ?? 0) > 70 && (h.mem_percent ?? 0) <= 90,
  )

  return (
    <div className="border-b border-slate-700/30">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:bg-slate-800/30 hover:text-slate-300"
      >
        <Server size={14} />
        <span className="font-medium">主机健康概览</span>
        {loading ? (
          <Loader2 size={12} className="ml-1 animate-spin" />
        ) : (
          <>
            <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px]">
              {hosts.length} 台
            </span>
            {critical.length > 0 && (
              <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-[10px] text-red-400">
                {critical.length} 危急
              </span>
            )}
            {warning.length > 0 && (
              <span className="rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                {warning.length} 警告
              </span>
            )}
          </>
        )}
        <div className="ml-auto">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </div>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="space-y-2 px-4 pb-3">
          {error && (
            <div className="rounded-lg bg-red-900/20 px-3 py-2 text-xs text-red-400">
              加载失败: {error}
              <button onClick={loadHealth} className="ml-2 underline">
                重试
              </button>
            </div>
          )}

          {!loading && hosts.length === 0 && (
            <div className="rounded-lg bg-slate-800/30 px-3 py-4 text-center text-xs text-slate-500">
              暂无已连接的主机
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hosts.map((h) => {
              const memColor = healthColor(h.mem_percent)
              const cpuColor = healthColor(
                h.cpu_load != null && h.cpu_cores != null ? (h.cpu_load / h.cpu_cores) * 100 : null,
              )
              return (
                <div
                  key={h.id}
                  className={`group rounded-lg border p-3 transition-colors ${
                    h.connected
                      ? 'border-slate-700/50 bg-slate-800/20 hover:border-slate-600/50'
                      : 'border-red-900/30 bg-red-900/10'
                  }`}
                >
                  {/* Host header */}
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      {statusIcon(h.connected, h.mem_percent)}
                      <span className="truncate text-xs font-medium text-slate-200">{h.host}</span>
                    </div>
                    {h.connected && onSelectHost && (
                      <button
                        onClick={() => onSelectHost(h.id)}
                        className="text-smartbox-400 hover:bg-smartbox-600/20 rounded px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100"
                      >
                        详情
                      </button>
                    )}
                  </div>

                  {!h.connected ? (
                    <p className="text-[10px] text-red-400">未连接</p>
                  ) : h.error ? (
                    <p className="text-[10px] text-amber-400">{h.error}</p>
                  ) : (
                    <>
                      {/* CPU */}
                      <div className="mb-1.5 flex items-center gap-2">
                        <Cpu size={12} className="shrink-0 text-slate-500" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">负载</span>
                            <span className={`font-mono ${cpuColor}`}>
                              {h.cpu_load?.toFixed(1)} / {h.cpu_cores}核
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
                            <div
                              className={`h-full rounded-full transition-all ${
                                (h.cpu_load ?? 0) > (h.cpu_cores ?? 1) * 0.7
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`}
                              style={{
                                width: `${Math.min(100, ((h.cpu_load ?? 0) / (h.cpu_cores ?? 1)) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      {/* Memory */}
                      <div className="mb-1.5 flex items-center gap-2">
                        <MemoryStick size={12} className="shrink-0 text-slate-500" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">内存</span>
                            <span className={`font-mono ${memColor}`}>
                              {h.mem_percent?.toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
                            <div
                              className={`h-full rounded-full transition-all ${healthBg(h.mem_percent)}`}
                              style={{ width: `${Math.min(100, h.mem_percent ?? 0)}%` }}
                            />
                          </div>
                          <div className="text-[9px] text-slate-600">
                            {h.mem_used_mb != null ? Math.round(h.mem_used_mb / 1024) : '?'}G /{' '}
                            {h.mem_total_mb != null ? Math.round(h.mem_total_mb / 1024) : '?'}G
                          </div>
                        </div>
                      </div>

                      {/* Disk */}
                      <div className="mb-1.5 flex items-center gap-2">
                        <HardDrive size={12} className="shrink-0 text-slate-500" />
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">磁盘</span>
                            <span className="font-mono text-slate-400">
                              {h.disk_percent || '?'}
                            </span>
                          </div>
                          <div className="text-[9px] text-slate-600">
                            / {h.disk_used || '?'} / {h.disk_total || '?'}
                          </div>
                        </div>
                      </div>

                      {/* Uptime & processes */}
                      <div className="flex items-center justify-between text-[9px] text-slate-600">
                        <span>{h.uptime || '?'}</span>
                        <span>{h.processes ?? '?'} proc</span>
                      </div>

                      {/* AI Diagnosis button */}
                      <button
                        onClick={() => runDiagnosis(h.id)}
                        disabled={diagnosing === h.id}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded bg-slate-800/50 py-1 text-[10px] text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300 disabled:opacity-50"
                      >
                        {diagnosing === h.id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <Brain size={10} />
                        )}
                        AI 诊断
                      </button>

                      {diagnosis[h.id] && (
                        <div className="mt-2 max-h-24 overflow-y-auto rounded bg-slate-900/50 p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-slate-400">
                          {diagnosis[h.id]}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
