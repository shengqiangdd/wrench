import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react'
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  RefreshCw,
  Server,
  Bell,
  ExternalLink,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useAlertStore } from '../../stores/alert-store'
import AlertSettings from './AlertSettings'
import AlertHistory from './AlertHistory'
import HostHealthOverview from './HostHealthOverview'
import type { HealthData, HostStats, HistoryPoint } from './types'

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

// ─── 迷你折线图 ───

const MiniChart = memo(function MiniChart({
  points,
  height = 40,
  color = '#60a5fa',
}: {
  points: number[]
  height?: number
  color?: string
}) {
  if (points.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-[10px] text-slate-600"
      >
        等待数据...
      </div>
    )
  }
  const max = Math.max(...points, 1)
  const w = 100
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * w
      const y = height - (v / max) * (height - 4)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={`g-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#g-${color.replace('#', '')})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
})

// ─── 进程列表 ───

const ProcessList = memo(function ProcessList({ procs }: { procs: HostStats['topProcs'] }) {
  if (!procs || procs.length === 0) {
    return <div className="text-[11px] text-slate-500">无数据</div>
  }

  // 提取进程名：从完整路径/命令中提取可读名称
  function extractProcName(cmd: string, pid: number): string {
    if (!cmd) return `PID ${pid}`
    // 去掉方括号（内核线程如 [kworker]）
    let name = cmd.replace(/^\[|\]$/g, '')
    // 取第一个参数之前的部分
    const firstPart = name.split(/\s+/)[0]
    if (firstPart) name = firstPart
    // 取 basename
    const parts = name.split('/')
    const lastPart = parts[parts.length - 1]
    if (lastPart) name = lastPart
    // 截断过长的名字
    if (name.length > 20) name = name.slice(0, 18) + '..'
    return name || `PID ${pid}`
  }

  return (
    <div className="space-y-0.5">
      {/* 表头 */}
      <div className="flex items-center gap-2 text-[10px] text-slate-500">
        <span className="w-10 text-right">CPU</span>
        <span className="w-10 text-right">MEM</span>
        <span className="min-w-0 flex-1 truncate">进程</span>
      </div>
      {procs.map((p, i) => {
        const displayName = extractProcName(p.command, p.pid)
        return (
          <div key={`${p.pid}-${i}`} className="flex items-center gap-2 text-[11px]">
            <span className="w-10 text-right text-cyan-400 tabular-nums">{p.cpu.toFixed(1)}</span>
            <span className="w-10 text-right text-purple-400 tabular-nums">{p.mem.toFixed(1)}</span>
            <span
              className="min-w-0 flex-1 truncate text-slate-300"
              title={`${p.command} (${p.user}:${p.pid})`}
            >
              {displayName}
            </span>
          </div>
        )
      })}
    </div>
  )
})

// ─── 后端健康数据类型 ───

interface BackendHealthHost {
  id: string
  host: string
  port: number
  username: string
  connected: boolean
  error?: string
  cpu_load?: number
  cpu_load_5?: number
  cpu_load_15?: number
  cpu_cores?: number
  mem_total_mb?: number
  mem_used_mb?: number
  mem_percent?: number
  disks?: Array<{ mount: string; total: string; used: string; percent: string }>
  uptime?: string
  processes?: number
  net_rx_bytes?: number
  net_tx_bytes?: number
  io_read_sectors?: number
  io_write_sectors?: number
  top_procs?: Array<{ pid: number; user: string; cpu: number; mem: number; command: string }>
}

// ─── 工具函数 ───

function parseDiskSize(s?: string): number {
  if (!s) return 0
  const m = s.match(/([\d.]+)\s*([KMGTP]?)/i)
  if (!m || !m[1]) return parseInt(s) || 0
  const val = parseFloat(m[1])
  const unit = (m[2] || '').toUpperCase()
  const units: Record<string, number> = {
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  }
  return Math.round(val * (units[unit] || 1))
}

function parsePctStr(s?: string): number {
  if (!s) return 0
  return parseFloat(s.replace('%', '')) || 0
}

/** 格式化 uptime 字符串：去掉 "up " 前缀，规范化显示 */
function formatUptime(raw?: string): string {
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
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length > 2) {
    return parts.slice(0, 2).join(', ')
  }
  return s
}

// ─── 模拟数据（测试用） ───

function _mockStats(id: string, name: string, host: string): HostStats {
  return {
    host,
    name,
    cpu: Math.round(Math.random() * 80 + 5),
    memory: {
      total: 16384,
      used: Math.round(Math.random() * 12000 + 2000),
      pct: Math.round(Math.random() * 80 + 10),
    },
    disk: {
      total: 512000,
      used: Math.round(Math.random() * 300000 + 50000),
      pct: Math.round(Math.random() * 60 + 20),
    },
    uptime: `${Math.floor(Math.random() * 30)}天 ${Math.floor(Math.random() * 24)}时`,
    loadAvg: `${(Math.random() * 4).toFixed(2)}, ${(Math.random() * 3).toFixed(2)}, ${(Math.random() * 2).toFixed(2)}`,
    netRx: Math.round(Math.random() * 5000000),
    netTx: Math.round(Math.random() * 2000000),
    topProcs: [
      { pid: 1, user: 'root', cpu: 12.5, mem: 3.2, command: '/usr/sbin/sshd' },
      { pid: 1234, user: 'www', cpu: 8.3, mem: 5.1, command: 'node server.js' },
    ],
    io: {
      readBps: Math.round(Math.random() * 10000000),
      writeBps: Math.round(Math.random() * 5000000),
    },
    timestamp: Date.now(),
  }
}

export default function MonitorPage() {
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const setSshSidebarOpen = useAppStore((s) => s.setSshSidebarOpen)
  const [hosts, setHosts] = useState<{ id: string; name: string; connected: boolean }[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [stats, setStats] = useState<Record<string, HostStats>>({})
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [interval, setIntervalDuration] = useState(5)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevNetRef = useRef<Record<string, { rx: number; tx: number; time: number }>>({})
  const prevIoRef = useRef<
    Record<string, { readSectors: number; writeSectors: number; time: number }>
  >({})
  const [health, setHealth] = useState<HealthData | null>(null)
  const [healthError, setHealthError] = useState(false)
  const alertHistory = useAlertStore((s) => s.history)

  // 从后端 /api/hosts/health 获取所有主机列表（包括离线的）
  const scanHosts = useCallback(async () => {
    try {
      const res = await fetch('/api/hosts/health')
      const body = await res.json()
      const allHosts: BackendHealthHost[] = body.data || []
      // 显示所有主机，不只 connected 的
      const list = allHosts.map((h) => ({
        id: h.id,
        name: h.host.length > 20 ? h.host.slice(0, 18) + '…' : h.host,
        connected: h.connected,
      }))
      const seen = new Set<string>()
      const deduped = list.filter((h) => {
        if (seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })

      const newIds = new Set(deduped.map((h) => h.id))
      setStats((prev) => {
        const cleaned: Record<string, HostStats> = {}
        for (const [k, v] of Object.entries(prev)) {
          if (newIds.has(k)) cleaned[k] = v
        }
        return cleaned
      })
      setHistory((prev) => {
        const cleaned: Record<string, HistoryPoint[]> = {}
        for (const [k, v] of Object.entries(prev)) {
          if (newIds.has(k)) cleaned[k] = v
        }
        return cleaned
      })
      for (const k of Object.keys(prevNetRef.current)) {
        if (!newIds.has(k)) delete prevNetRef.current[k]
      }
      for (const k of Object.keys(prevIoRef.current)) {
        if (!newIds.has(k)) delete prevIoRef.current[k]
      }

      setHosts(deduped)
      if (deduped.length > 0) {
        setSelected((prev) => {
          const valid = prev.filter((id) => newIds.has(id))
          // 自动选中所有已连接的主机（不只是第一台）
          if (valid.length === 0) {
            const connectedIds = deduped.filter((h) => h.connected).map((h) => h.id)
            return connectedIds.length > 0 ? connectedIds : [deduped[0]!.id]
          }
          return valid
        })
      }
    } catch {
      setHosts([])
      setSelected([])
    }
  }, [])

  // 采集所有选中主机 — 全部数据来自后端 /api/hosts/health（单条 SSH 命令）
  const collectAll = useCallback(async () => {
    if (selected.length === 0) return
    setLoading(true)
    setError('')

    try {
      const healthResp = await fetch('/api/hosts/health')
      const healthBody = await healthResp.json()
      const allHealth: BackendHealthHost[] = healthBody.data || []
      const healthMap = new Map(allHealth.map((h) => [h.id, h]))

      const newStats: Record<string, HostStats> = {}
      const now = Date.now()

      for (const hostId of selected) {
        const hostInfo = hosts.find((h) => h.id === hostId)
        const hostName = hostInfo?.name || hostId.slice(0, 8)
        const h = healthMap.get(hostId)

        if (!h || !h.connected) {
          newStats[hostId] = {
            host: hostName,
            name: hostName,
            cpu: 0,
            memory: { total: 0, used: 0, pct: 0 },
            disk: { total: 0, used: 0, pct: 0 },
            uptime: '离线',
            loadAvg: '—',
            netRx: 0,
            netTx: 0,
            topProcs: [],
            io: { readBps: 0, writeBps: 0 },
            timestamp: now,
          }
          continue
        }

        // CPU：load / cores → 百分比
        const cpuCores = h.cpu_cores || 1
        const cpuLoad = h.cpu_load ?? 0
        const cpu = Math.min(100, Math.round((cpuLoad / cpuCores) * 1000) / 10)

        // 内存
        const memTotalMb = h.mem_total_mb ?? 0
        const memUsedMb = h.mem_used_mb ?? 0
        const memPct = h.mem_percent ?? 0

        // 磁盘：优先取 /，其次取使用率最高的
        let diskTotalBytes = 0
        let diskUsedBytes = 0
        let diskPctVal = 0
        if (h.disks && h.disks.length > 0) {
          const rootDisk =
            h.disks.find((d) => d.mount === '/') ||
            h.disks.reduce((a, b) => (parsePctStr(a.percent) >= parsePctStr(b.percent) ? a : b))
          diskTotalBytes = parseDiskSize(rootDisk.total)
          diskUsedBytes = parseDiskSize(rootDisk.used)
          diskPctVal = parsePctStr(rootDisk.percent)
        }

        // 运行时间
        const uptime = formatUptime(h.uptime)
        const loadAvg = [h.cpu_load ?? 0, h.cpu_load_5 ?? 0, h.cpu_load_15 ?? 0]
          .map((v) => v.toFixed(2))
          .join(', ')

        // 网络速率：累计字节差 / 时间差
        const prevNet = prevNetRef.current[hostId]
        const backendNetRx = h.net_rx_bytes ?? 0
        const backendNetTx = h.net_tx_bytes ?? 0
        let netRxSpeed = 0
        let netTxSpeed = 0
        if (prevNet && prevNet.rx > 0) {
          const dt = (now - prevNet.time) / 1000
          if (dt > 0) {
            netRxSpeed = Math.max(0, (backendNetRx - prevNet.rx) / dt)
            netTxSpeed = Math.max(0, (backendNetTx - prevNet.tx) / dt)
          }
        }
        prevNetRef.current[hostId] = { rx: backendNetRx, tx: backendNetTx, time: now }

        // 磁盘 IO 速率：累计扇区差 × 512 / 时间差
        const prevIo = prevIoRef.current[hostId]
        const backendIoRead = h.io_read_sectors ?? 0
        const backendIoWrite = h.io_write_sectors ?? 0
        let readBps = 0
        let writeBps = 0
        if (prevIo && (prevIo.readSectors > 0 || prevIo.writeSectors > 0)) {
          const dt = (now - prevIo.time) / 1000
          if (dt > 0) {
            readBps = Math.max(0, ((backendIoRead - prevIo.readSectors) * 512) / dt)
            writeBps = Math.max(0, ((backendIoWrite - prevIo.writeSectors) * 512) / dt)
          }
        }
        prevIoRef.current[hostId] = {
          readSectors: backendIoRead,
          writeSectors: backendIoWrite,
          time: now,
        }

        // Top 进程
        const topProcs = h.top_procs || []

        const s: HostStats = {
          host: hostName,
          name: hostName,
          cpu,
          memory: { total: memTotalMb, used: memUsedMb, pct: memPct },
          disk: { total: diskTotalBytes, used: diskUsedBytes, pct: diskPctVal },
          uptime,
          loadAvg,
          netRx: netRxSpeed,
          netTx: netTxSpeed,
          topProcs,
          io: { readBps, writeBps },
          timestamp: now,
        }

        newStats[hostId] = s
        setHistory((prev) => {
          const hist = prev[hostId] || []
          hist.push({ time: now, cpu: s.cpu, mem: s.memory.pct, disk: s.disk.pct })
          return { ...prev, [hostId]: hist.slice(-60) }
        })
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
  }, [selected, hosts])

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
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        scanHosts()
        fetchHealth()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [scanHosts, fetchHealth])

  useEffect(() => {
    return () => stopAutoRefresh()
  }, [stopAutoRefresh])

  const toggleHost = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]))
  }, [])

  const handleRefresh = useCallback(() => {
    collectAll()
    scanHosts()
  }, [collectAll, scanHosts])

  const handleIntervalChange = useCallback(
    (v: number) => {
      setIntervalDuration(v)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = setInterval(collectAll, v * 1000)
      }
    },
    [collectAll],
  )

  const selectedStats = useMemo(
    () =>
      selected
        .map((id) => ({ id, stats: stats[id] }))
        .filter((s): s is { id: string; stats: HostStats } => !!s.stats),
    [selected, stats],
  )

  const [alertPanel, setAlertPanel] = useState<'none' | 'settings' | 'history'>('none')
  const hasAlerts = alertHistory.length > 0

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-900">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/50 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-200">系统监控</h1>
          {health && (
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-slate-500">Bridge</span>
              <span className={health.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'}>
                {health.status === 'ok' ? '正常' : health.status}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">连接 {health.connections.active}</span>
            </div>
          )}
          {healthError && <span className="text-[11px] text-amber-500/80">Bridge 离线</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {/* 告警按钮 */}
          <button
            onClick={() => setAlertPanel(alertPanel === 'none' ? 'settings' : 'none')}
            className={`relative rounded-md px-2 py-1 text-[11px] transition-colors ${
              alertPanel !== 'none'
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            {hasAlerts && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-500" />
            )}
          </button>
          <select
            value={interval}
            onChange={(e) => handleIntervalChange(Number(e.target.value))}
            className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
          >
            <option value={3}>3秒</option>
            <option value={5}>5秒</option>
            <option value={10}>10秒</option>
            <option value={30}>30秒</option>
          </select>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* 告警面板 */}
      {alertPanel !== 'none' && (
        <div className="flex shrink-0 gap-1 border-b border-slate-700/50 px-4 py-2">
          <button
            onClick={() => setAlertPanel('settings')}
            className={`rounded px-2 py-0.5 text-[11px] ${
              alertPanel === 'settings' ? 'bg-slate-700 text-slate-200' : 'text-slate-400'
            }`}
          >
            告警设置
          </button>
          <button
            onClick={() => setAlertPanel('history')}
            className={`rounded px-2 py-0.5 text-[11px] ${
              alertPanel === 'history' ? 'bg-slate-700 text-slate-200' : 'text-slate-400'
            }`}
          >
            告警历史 {hasAlerts && `(${alertHistory.length})`}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setAlertPanel('none')}
            className="text-[11px] text-slate-500 hover:text-slate-300"
          >
            ×
          </button>
        </div>
      )}
      {alertPanel === 'settings' && <AlertSettings />}
      {alertPanel === 'history' && <AlertHistory />}

      {/* 主机列表 */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-700/50 px-4 py-2">
        {hosts.length === 0 ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Server className="h-3 w-3" />
            <span>无已连接主机</span>
            <button
              onClick={() => {
                setActiveNav('ssh')
                setSshSidebarOpen(true)
              }}
              className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
            >
              去连接 <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ) : (
          hosts.map((h) => {
            const isActive = selected.includes(h.id)
            const s = stats[h.id]
            return (
              <button
                key={h.id}
                onClick={() => toggleHost(h.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    h.connected ? 'bg-emerald-400' : 'bg-red-500'
                  }`}
                />
                {h.name}
                {isActive && s && h.connected && (
                  <span className="text-[10px] text-slate-500">{s.cpu}%</span>
                )}
              </button>
            )
          })
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {selectedStats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-500">
            <Server className="mb-2 h-8 w-8 opacity-30" />
            <span className="text-[11px]">选择主机查看监控数据</span>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedStats.map(({ id, stats: s }) => {
              const hist = history[id] || []
              return (
                <div key={id} className="rounded-lg bg-slate-800/50 p-3">
                  {/* 主机标题 */}
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Server className="h-3.5 w-3.5 text-cyan-400" />
                      <span className="text-[12px] font-medium text-slate-200">{s.name}</span>
                      <span className="text-[10px] text-slate-500">{s.host}</span>
                    </div>
                    <span className="text-[10px] text-slate-500">{s.uptime}</span>
                  </div>

                  {/* 核心指标 + 图表 */}
                  <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {/* CPU */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <Cpu className="h-3 w-3" /> CPU
                      </div>
                      <ProgressBar
                        value={s.cpu}
                        label=""
                        sub={`负载 ${s.loadAvg.split(',')[0]?.trim() || '—'}`}
                        color="from-cyan-500 to-cyan-400"
                      />
                      <MiniChart points={hist.map((h) => h.cpu)} color="#22d3ee" />
                    </div>

                    {/* 内存 */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <MemoryStick className="h-3 w-3" /> 内存
                      </div>
                      <ProgressBar
                        value={s.memory.pct}
                        label=""
                        sub={`${(s.memory.used / 1024).toFixed(1)}/${(s.memory.total / 1024).toFixed(1)} GB`}
                        color="from-purple-500 to-purple-400"
                      />
                      <MiniChart points={hist.map((h) => h.mem)} color="#a855f7" />
                    </div>

                    {/* 磁盘 */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <HardDrive className="h-3 w-3" /> 磁盘
                      </div>
                      <ProgressBar
                        value={s.disk.pct}
                        label=""
                        sub={`${(s.disk.used / 1073741824).toFixed(1)}/${(s.disk.total / 1073741824).toFixed(1)} GB`}
                        color="from-emerald-500 to-emerald-400"
                      />
                      <MiniChart points={hist.map((h) => h.disk)} color="#10b981" />
                    </div>

                    {/* 网络 */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <Network className="h-3 w-3" /> 网络
                      </div>
                      <div className="text-[11px] text-slate-300">
                        <div className="flex justify-between">
                          <span className="text-slate-500">↓</span>
                          <span className="text-emerald-400">{formatSpeed(s.netRx)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">↑</span>
                          <span className="text-cyan-400">{formatSpeed(s.netTx)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 磁盘 IO + 进程 */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* 磁盘 IO */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <Activity className="h-3 w-3" /> 磁盘 IO
                      </div>
                      <div className="text-[11px] text-slate-300">
                        <div className="flex justify-between">
                          <span className="text-slate-500">读取</span>
                          <span className="text-emerald-400">{formatSpeed(s.io.readBps)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">写入</span>
                          <span className="text-cyan-400">{formatSpeed(s.io.writeBps)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Top 进程 */}
                    <div className="rounded-md bg-slate-900/50 p-2">
                      <div className="mb-1 flex items-center gap-1 text-[10px] text-slate-400">
                        <Activity className="h-3 w-3" /> Top 进程
                      </div>
                      <ProcessList procs={s.topProcs} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 底部健康概览 */}
      <HostHealthOverview />
    </div>
  )
}
