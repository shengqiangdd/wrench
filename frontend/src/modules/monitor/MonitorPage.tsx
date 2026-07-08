import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  RefreshCw,
  Server,
  Loader2,
  Bell,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useAlertStore } from '../../stores/alert-store'
import AlertSettings from './AlertSettings'
import AlertHistory from './AlertHistory'
import HostHealthOverview from './HostHealthOverview'
import type { HealthData, HostStats, HistoryPoint } from './types'
import {
  parseCpuUsage,
  parseMemory,
  parseDisk,
  parseUptime,
  parseLoadAvg,
  parseNetRxTx,
  parseTopProcs,
  parseDiskIo,
  formatBytes,
} from './monitor-utils'

// ─── 工具函数 ───

function formatSpeed(bps: number): string {
  if (bps === 0) return '0 b/s'
  const k = 1000
  const sizes = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s']
  const i = Math.floor(Math.log(bps) / Math.log(k))
  return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ─── 渐变色进度条 ───

const ProgressBar = memo(function ProgressBar({
  value,
  label,
  sub,
  color,
}: {
  value: number
  label: string
  sub?: string
  color: string
}) {
  const getColor = () => {
    if (value > 90) return 'from-red-500 to-red-400'
    if (value > 70) return 'from-amber-500 to-amber-400'
    return color
  }
  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium text-slate-300">
          {value}%{sub && <span className="ml-1 font-normal text-slate-500">{sub}</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/60">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${getColor()} transition-all duration-500`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
    </div>
  )
})

// ─── Sparkline 迷你折线图 ───

const Sparkline = memo(function Sparkline({
  data,
  color,
  height = 32,
}: {
  data: number[]
  color: string
  height?: number
}) {
  if (data.length < 2)
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[10px] text-slate-600"
      >
        等待数据...
      </div>
    )

  const w = 120
  const h = height
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const stepX = w / (data.length - 1)

  const points = data
    .map((v, i) => `${i * stepX},${h - ((v - min) / range) * (h - 4) - 2}`)
    .join(' ')

  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  )
})

// ─── Mock 数据状态（随机漫步，更真实） ───
const mockState = new Map<
  string,
  {
    cpu: number
    memPct: number
    diskPct: number
    netRx: number
    netTx: number
    uptime: number
    load1: number
    load5: number
    load15: number
  }
>()

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function walk(value: number, step: number, min: number, max: number): number {
  return clamp(value + (Math.random() - 0.5) * step * 2, min, max)
}

function initOrGetMock(id: string) {
  if (!mockState.has(id)) {
    mockState.set(id, {
      cpu: Math.round(Math.random() * 25 + 10),
      memPct: Math.round(Math.random() * 25 + 35),
      diskPct: Math.round(Math.random() * 15 + 25),
      netRx: Math.round(Math.random() * 3e6 + 1e6),
      netTx: Math.round(Math.random() * 1.5e6 + 5e5),
      uptime: Date.now() - Math.random() * 20 * 86400000,
      load1: Math.random() * 2 + 0.3,
      load5: Math.random() * 1.5 + 0.2,
      load15: Math.random() * 1 + 0.1,
    })
  }
  return mockState.get(id)!
}

function formatDuration(ms: number): string {
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  return `${days} days, ${hours} hours`
}

/** 生成模拟统计数据（随机漫步） — 内部函数 */
function _mockStats(id: string, name: string, host: string): HostStats {
  const s = initOrGetMock(id)
  s.cpu = walk(s.cpu, 5, 2, 85)
  s.memPct = walk(s.memPct, 3, 20, 75)
  s.diskPct = walk(s.diskPct, 0.5, 15, 65)
  s.netRx = walk(s.netRx, 500000, 100000, 8000000)
  s.netTx = walk(s.netTx, 300000, 50000, 4000000)
  s.load1 = walk(s.load1, 0.4, 0.1, 4)
  s.load5 = walk(s.load5, 0.2, 0.1, 3)
  s.load15 = walk(s.load15, 0.1, 0.05, 2)

  const totalMem = 16777216
  const usedMem = Math.round(totalMem * (s.memPct / 100))
  const totalDisk = 524288000
  const usedDisk = Math.round(totalDisk * (s.diskPct / 100))

  return {
    host,
    name,
    cpu: Math.round(s.cpu * 10) / 10,
    memory: { total: totalMem, used: usedMem, pct: s.memPct },
    disk: { total: totalDisk, used: usedDisk, pct: s.diskPct },
    uptime: formatDuration(Date.now() - s.uptime),
    loadAvg: `${s.load1.toFixed(2)}, ${s.load5.toFixed(2)}, ${s.load15.toFixed(2)}`,
    netRx: Math.round(s.netRx),
    netTx: Math.round(s.netTx),
    topProcs: [
      {
        pid: 1024,
        user: 'root',
        cpu: Math.round(s.cpu * 0.3 * 10) / 10,
        mem: 2.1,
        command: 'node server.js',
      },
      {
        pid: 2048,
        user: 'www',
        cpu: Math.round(s.cpu * 0.2 * 10) / 10,
        mem: 3.5,
        command: 'nginx: worker',
      },
      {
        pid: 3072,
        user: 'root',
        cpu: Math.round(s.cpu * 0.1 * 10) / 10,
        mem: 1.2,
        command: 'sshd: root@pts/0',
      },
      {
        pid: 4096,
        user: 'mysql',
        cpu: Math.round(s.cpu * 0.08 * 10) / 10,
        mem: 8.4,
        command: 'mysqld',
      },
      {
        pid: 5120,
        user: 'root',
        cpu: Math.round(s.cpu * 0.05 * 10) / 10,
        mem: 0.5,
        command: 'bash',
      },
    ],
    io: {
      readBps: Math.round(Math.random() * 5e6 + 1e6),
      writeBps: Math.round(Math.random() * 3e6 + 5e5),
    },
    timestamp: Date.now(),
  }
}

/** 生成模拟历史数据（最近 60 个采样点） */
function _mockHistory(): HistoryPoint[] {
  const now = Date.now()
  return Array.from({ length: 60 }, (_, i) => ({
    time: now - (60 - i) * 5000,
    cpu: Math.round((Math.random() * 40 + 10) * 10) / 10,
    mem: Math.round(Math.random() * 35 + 25),
    disk: Math.round(Math.random() * 25 + 15),
  }))
}

export default function MonitorPage() {
  const sessions = useSshStore((s) => s.sessions)
  const connections = useSshStore((s) => s.connections)
  const hasLiveSessions = sessions.some((s) => s.status === 'connected')
  const isMock = !hasLiveSessions
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [stats, setStats] = useState<Record<string, HostStats>>({})
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [interval, setIntervalDuration] = useState(5)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevNetRef = useRef<Record<string, { rx: number; tx: number; time: number }>>({})
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthError, setHealthError] = useState(false)
  const alertHistory = useAlertStore((s) => s.history)

  // 扫描主机（已保存的连接 + 活跃 session）— 去重
  const scanHosts = useCallback(() => {
    const seen = new Set<string>()
    const list: { id: string; name: string }[] = []
    for (const sess of sessions) {
      if (sess.status !== 'connected') continue
      const hostKey = sess.host || sess.connectionId
      if (seen.has(hostKey)) continue
      const name = sess.connectionName || sess.host || sess.id.slice(0, 8)
      list.push({ id: sess.id, name })
      seen.add(hostKey)
    }
    for (const conn of connections) {
      const hostKey = conn.host || conn.name
      if (seen.has(hostKey)) continue
      list.push({ id: conn.id, name: conn.name })
      seen.add(hostKey)
    }
    const ipSeen = new Set<string>()
    const dedupedList: { id: string; name: string }[] = []
    for (const h of list) {
      const ipKey = h.name.split(':')[0]!.split('@').pop() || h.name
      if (!ipSeen.has(ipKey)) {
        ipSeen.add(ipKey)
        dedupedList.push(h)
      }
    }
    setHosts(dedupedList)
    if (dedupedList.length > 0) {
      setSelected((prev) => (prev.length === 0 ? [dedupedList[0]!.id] : prev))
    }
  }, [connections, sessions])

  // 采集单台主机数据
  const collectHostStats = useCallback(
    async (hostId: string): Promise<HostStats | null> => {
      const sess = sessions.find((s) => s.id === hostId && s.status === 'connected')
      const conn = connections.find((c) => c.id === hostId)
      if (!sess && !conn) return null

      try {
        // 合并所有命令为一次 SSH exec，减少 7x 网络/SSH 开销
        const combinedCmd = [
          "echo '===CPU_START==='",
          "(top -bn1 | head -5 | grep '%Cpu' || mpstat 2>/dev/null | tail -1 || sar -u 1 1 2>/dev/null | tail -1)",
          "echo '===MEM_START==='",
          "cat /proc/meminfo | grep -E 'MemTotal|MemAvailable'",
          "echo '===DISK_START==='",
          'df -k /',
          "echo '===UPTIME_START==='",
          'uptime',
          "echo '===NET_START==='",
          'cat /proc/net/dev',
          "echo '===PROC_START==='",
          'ps aux --sort=-%cpu | head -6',
          "echo '===IO_START==='",
          'cat /proc/diskstats',
        ].join(' && ')

        const resp = await fetch('/api/ssh/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: hostId, command: combinedCmd }),
        })
        const data = await resp.json()

        if (data.exitCode !== 0) {
          return null
        }

        const output = data.stdout || ''
        const sections: Record<string, string> = {}
        const sectionNames = ['CPU', 'MEM', 'DISK', 'UPTIME', 'NET', 'PROC', 'IO']
        for (const name of sectionNames) {
          const marker = `===${name}_START===`
          const idx = output.indexOf(marker)
          if (idx !== -1) {
            const start = idx + marker.length
            let end = output.length
            for (const n of sectionNames) {
              const nextMarker = `===${n}_START===`
              const ni = output.indexOf(nextMarker, start)
              if (ni !== -1 && ni < end) end = ni
            }
            sections[name] = output.slice(start, end).trim()
          }
        }

        const cpu = parseCpuUsage(sections.CPU || '') || 0
        const memory = parseMemory(sections.MEM || '')
        const disk = parseDisk(sections.DISK || '')
        const uptime = parseUptime(sections.UPTIME || '')
        const loadAvg = parseLoadAvg(sections.UPTIME || '')

        const net = parseNetRxTx(sections.NET || '')
        const now = Date.now()

        const prev = prevNetRef.current[hostId]
        let netRxSpeed = 0
        let netTxSpeed = 0
        if (prev && prev.rx > 0) {
          const dt = (now - prev.time) / 1000
          if (dt > 0) {
            netRxSpeed = Math.max(0, (net.rx - prev.rx) / dt)
            netTxSpeed = Math.max(0, (net.tx - prev.tx) / dt)
          }
        }
        prevNetRef.current[hostId] = { rx: net.rx, tx: net.tx, time: now }

        const topProcs = parseTopProcs(sections.PROC || '')
        const ioRaw = parseDiskIo(sections.IO || '')
        if (ioRaw.readBps > 10e9) ioRaw.readBps = 0
        if (ioRaw.writeBps > 10e9) ioRaw.writeBps = 0

        return {
          host: sess?.host || conn?.host || hostId,
          name: sess?.connectionName || conn?.name || hostId.slice(0, 8),
          cpu,
          memory,
          disk,
          uptime,
          loadAvg,
          netRx: netRxSpeed,
          netTx: netTxSpeed,
          topProcs,
          io: ioRaw,
          timestamp: Date.now(),
        }
      } catch {
        return null
      }
    },
    [connections, sessions],
  )

  // 采集所有选中的主机
  const collectAll = useCallback(async () => {
    if (selected.length === 0) return
    setLoading(true)
    setError('')

    try {
      if (isMock) {
        setError('请先连接 SSH 服务器以采集监控数据')
        setLoading(false)
        return
      }

      const results = await Promise.all(selected.map((id) => collectHostStats(id)))

      const newStats: Record<string, HostStats> = {}
      const now = Date.now()

      for (let i = 0; i < selected.length; i++) {
        const s = results[i]
        if (s) {
          const hostId = selected[i]!
          newStats[hostId] = s

          setHistory((prev) => {
            const h = prev[hostId] || []
            h.push({ time: now, cpu: s.cpu, mem: s.memory.pct, disk: s.disk.pct })
            const trimmed = h.slice(-60)
            return { ...prev, [hostId]: trimmed }
          })
        }
      }

      setStats((prev) => ({ ...prev, ...newStats }))
      const evaluate = useAlertStore.getState().evaluate
      for (const id of selected) {
        const s = newStats[id]
        if (s) evaluate(id, s.name, { cpu: s.cpu, memory: s.memory.pct, disk: s.disk.pct })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message || '未知错误' : '未知错误'
      setError('采集失败: ' + msg)
    } finally {
      setLoading(false)
    }
  }, [selected, collectHostStats, isMock])

  // 自动刷新
  const startAutoRefresh = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(collectAll, interval * 1000)
  }, [collectAll, interval])

  const stopAutoRefresh = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 初始化
  useEffect(() => {
    const t = setTimeout(() => scanHosts(), 0)
    return () => clearTimeout(t)
  }, [scanHosts])

  // 扫描到主机后自动开始采集
  useEffect(() => {
    if (hosts.length > 0) {
      const t = setTimeout(() => {
        collectAll()
        startAutoRefresh()
      }, 0)
      return () => clearTimeout(t)
    }
    return () => stopAutoRefresh()
  }, [hosts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 拉取 Bridge 健康数据
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const body = await res.json()
        setHealth(body.data ?? body)
        setHealthError(false)
      } else {
        setHealthError(true)
      }
    } catch {
      setHealthError(true)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchHealth(), 0)
    const timer = window.setInterval(fetchHealth, 30_000)
    return () => {
      clearTimeout(t)
      clearInterval(timer)
    }
  }, [fetchHealth])

  useEffect(() => {
    return () => stopAutoRefresh()
  }, [stopAutoRefresh])

  const toggleHost = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]))
  }, [])

  // 手动刷新
  const handleRefresh = useCallback(async () => {
    stopAutoRefresh()
    await collectAll()
    startAutoRefresh()
  }, [stopAutoRefresh, collectAll, startAutoRefresh])

  // 主机列表映射为 id → name 的缓存
  const hostNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const h of hosts) {
      map.set(h.id, h.name)
    }
    return map
  }, [hosts])

  // Bridge 健康信息格式化
  const healthDisplay = useMemo(() => {
    if (!health) return null
    const d = Math.floor(health.uptime / 86400)
    const h = Math.floor((health.uptime % 86400) / 3600)
    const m = Math.floor((health.uptime % 3600) / 60)
    return {
      uptime: d > 0 ? `${d}d${h}h${m}m` : `${h}h${m}m`,
      version: health.version,
      connections: health.connections?.active ?? 'N/A',
    }
  }, [health])

  // 选中的主机数据渲染列表
  const selectedHostsData = useMemo(() => {
    return selected.map((id) => ({
      id,
      name: hostNameMap.get(id) || id.slice(0, 8),
      stats: stats[id],
      history: history[id] || [],
    }))
  }, [selected, hostNameMap, stats, history])

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-700/50 px-4 py-3">
        <Activity size={18} className="text-wrench-400" />
        <h2 className="text-sm font-semibold text-slate-200">主机性能看板</h2>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-slate-500">刷新</span>
            <select
              value={interval}
              onChange={(e) => setIntervalDuration(Number(e.target.value))}
              className="rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
            >
              <option value={2}>2s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          </div>

          <button
            onClick={handleRefresh}
            disabled={loading || selected.length === 0}
            className="flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>

          <button
            onClick={scanHosts}
            className="flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <Server size={13} />
            扫描
          </button>
        </div>
      </div>

      {/* ─── 多主机健康概览 ─── */}
      <HostHealthOverview
        onSelectHost={(id) => {
          if (!selected.includes(id)) {
            setSelected([id])
          }
        }}
      />

      {/* ─── 健康概览卡片 ─── */}
      {healthDisplay && !healthError && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/30 px-3 py-2 md:gap-4 md:overflow-x-auto md:px-4">
          <div className="flex shrink-0 items-center gap-1.5">
            <Activity size={12} className="text-green-400" />
            <span className="text-[10px] text-slate-500">运行</span>
            <span className="font-mono text-[11px] text-slate-300">{healthDisplay.uptime}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Server size={12} className="text-cyan-400" />
            <span className="text-[10px] text-slate-500">Node</span>
            <span className="font-mono text-[11px] text-slate-300">{healthDisplay.version}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Network size={12} className="text-amber-400" />
            <span className="text-[10px] text-slate-500">连接</span>
            <span className="font-mono text-[11px] text-slate-300">{healthDisplay.connections}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Bell
              size={12}
              className={alertHistory.length > 0 ? 'text-red-400' : 'text-slate-600'}
            />
            <span className="text-[10px] text-slate-500">告警</span>
            <span
              className={`font-mono text-[11px] ${alertHistory.length > 0 ? 'text-red-300' : 'text-slate-500'}`}
            >
              {alertHistory.length}
            </span>
          </div>
        </div>
      )}

      {/* Bridge 连接异常提示 */}
      {healthError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-800/30 bg-red-900/10 px-4 py-1.5">
          <Activity size={12} className="text-red-400" />
          <span className="text-[11px] text-red-400">Bridge 服务不可达，请检查后端是否运行</span>
        </div>
      )}

      {/* 主机选择 */}
      <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-700/30 px-4 py-2">
        <span className="shrink-0 text-[11px] text-slate-500">选择主机:</span>
        {hosts.length === 0 ? (
          <span className="text-[11px] text-slate-600">暂无已连接的 SSH 主机</span>
        ) : (
          hosts.map((h) => (
            <button
              key={h.id}
              onClick={() => toggleHost(h.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-[11px] transition-colors ${
                selected.includes(h.id)
                  ? 'bg-wrench-600/30 text-wrench-300 border-wrench-500/40 border'
                  : 'border border-slate-700/30 bg-slate-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              {h.name}
            </button>
          ))
        )}
      </div>

      {error && (
        <div className="shrink-0 border-b border-red-800/30 bg-red-900/20 px-4 py-2 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {/* 主机看板 */}
      <div className="flex-1 overflow-auto p-3 sm:p-4">
        {selected.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Activity size={48} className="mx-auto mb-3 text-slate-700" />
              <p className="text-sm text-slate-500">请选择要监控的主机</p>
              <p className="mt-1 text-[11px] text-slate-600">先点击「扫描」加载已连接的 SSH 主机</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {selectedHostsData.map(({ id, name, stats: s, history: h }) => (
              <div key={id} className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
                {/* 主机头部 */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server size={14} className="text-slate-400" />
                    <span className="text-sm font-medium text-slate-200">{name}</span>
                    <span className="text-[11px] text-slate-500">{s?.host || ''}</span>
                    {s && (
                      <span className="text-[10px] text-slate-600">
                        {new Date(s.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {s && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-500">
                      <span>运行 {s.uptime}</span>
                      {s.loadAvg && <span className="ml-1">| 负载 {s.loadAvg}</span>}
                    </div>
                  )}
                </div>

                {!s ? (
                  <div className="flex items-center justify-center py-8 text-[12px] text-slate-600">
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    正在采集数据...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* CPU */}
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <Cpu size={12} className="text-cyan-500" />
                        <ProgressBar
                          value={s.cpu}
                          label="CPU"
                          color="from-cyan-500 to-cyan-400"
                        />
                      </div>
                      <Sparkline data={h.map((p) => p.cpu)} color="#06b6d4" />
                    </div>

                    {/* 内存 */}
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <MemoryStick size={12} className="text-violet-500" />
                        <ProgressBar
                          value={s.memory.pct}
                          label="内存"
                          sub={`${formatBytes(s.memory.used * 1024)} / ${formatBytes(s.memory.total * 1024)}`}
                          color="from-violet-500 to-violet-400"
                        />
                      </div>
                      <Sparkline data={h.map((p) => p.mem)} color="#8b5cf6" />
                    </div>

                    {/* 磁盘 */}
                    <div>
                      <div className="mb-1 flex items-center gap-2">
                        <HardDrive size={12} className="text-emerald-500" />
                        <ProgressBar
                          value={s.disk.pct}
                          label="磁盘 /"
                          sub={`${formatBytes(s.disk.used * 1024)} / ${formatBytes(s.disk.total * 1024)}`}
                          color="from-emerald-500 to-emerald-400"
                        />
                      </div>
                      <Sparkline data={h.map((p) => p.disk)} color="#10b981" />
                    </div>

                    {/* 网络 */}
                    <div className="flex items-center gap-4 border-t border-slate-700/30 pt-1">
                      <Network size={12} className="text-amber-500" />
                      <div className="flex gap-4 text-[11px]">
                        <span className="text-slate-400">
                          ↓{' '}
                          <span className="font-mono text-slate-300">{formatSpeed(s.netRx)}</span>
                        </span>
                        <span className="text-slate-400">
                          ↑{' '}
                          <span className="font-mono text-slate-300">{formatSpeed(s.netTx)}</span>
                        </span>
                      </div>
                      <HardDrive size={12} className="text-teal-500" />
                      <div className="flex gap-4 text-[11px]">
                        <span className="text-slate-400">
                          R{' '}
                          <span className="font-mono text-slate-300">
                            {formatSpeed(s.io.readBps)}
                          </span>
                        </span>
                        <span className="text-slate-400">
                          W{' '}
                          <span className="font-mono text-slate-300">
                            {formatSpeed(s.io.writeBps)}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Top 5 进程 */}
                    {s.topProcs.length > 0 && (
                      <div className="border-t border-slate-700/30 pt-2">
                        <div className="mb-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                          <Cpu size={10} className="text-cyan-500" />
                          Top 5 进程
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="text-slate-600">
                                <th className="pr-2 text-left font-normal">PID</th>
                                <th className="pr-2 text-left font-normal">USER</th>
                                <th className="pr-2 text-right font-normal">CPU%</th>
                                <th className="pr-2 text-right font-normal">MEM%</th>
                                <th className="text-left font-normal">COMMAND</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.topProcs.map((p, i) => (
                                <tr key={`${i}-${p.pid}`} className="text-slate-400">
                                  <td className="pr-2 font-mono text-slate-500">{p.pid}</td>
                                  <td className="pr-2 text-slate-500">{p.user}</td>
                                  <td className="pr-2 text-right font-mono">
                                    <span
                                      className={
                                        p.cpu > 50
                                          ? 'text-red-400'
                                          : p.cpu > 20
                                            ? 'text-amber-400'
                                            : 'text-emerald-400'
                                      }
                                    >
                                      {p.cpu.toFixed(1)}
                                    </span>
                                  </td>
                                  <td className="pr-2 text-right font-mono">{p.mem.toFixed(1)}</td>
                                  <td className="max-w-[160px] truncate text-slate-500">
                                    {p.command}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 告警历史 */}
        {selected.length > 0 && alertHistory.length > 0 && (
          <div className="mt-4 rounded-lg border border-slate-700/50 bg-slate-800/60 p-4">
            <AlertHistory />
          </div>
        )}
      </div>

      {/* 告警设置侧边栏 */}
      <AlertSettings />
    </div>
  )
}