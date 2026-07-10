/**
 * MonitorPage - 系统监控仪表盘
 *
 * 数据全部由后端一次性 SSH 采集，前端只做展示和速度计算（两次采样差值）。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Clock,
  RefreshCw,
  Server,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react'

import { useSshStore } from '../../stores/ssh-store'

// ─── Types ───

interface MonitorData {
  connectionId: string
  name: string
  connected: boolean
  hostname?: string
  username?: string
  host?: string
  port?: number
  error?: string
  cpu?: number
  cpuCores?: number
  memoryTotal?: number
  memoryUsed?: number
  memoryPercent?: number
  uptime?: string
  processes?: number
  networkRx?: number
  networkTx?: number
  diskRead?: number
  diskWrite?: number
  topProcs?: Array<{
    pid: number
    user: string
    cpu: number
    mem: number
    command: string
  }>
  disks?: Array<{
    mount: string
    total: string
    used: string
    percent: string
  }>
}

interface Alert {
  id: string
  timestamp: string
  level: string
  host: string
  metric: string
  message: string
  value: number
  threshold: number
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// ─── Helpers ───

function formatBps(bps: number): string {
  if (bps <= 0) return '0 B/s'
  if (bps < 1024) return `${bps.toFixed(0)} B/s`
  if (bps < 1048576) return `${(bps / 1024).toFixed(1)} KB/s`
  return `${(bps / 1048576).toFixed(1)} MB/s`
}

function formatUptime(uptime: string): string {
  if (!uptime) return 'N/A'
  const m = uptime.match(/up\s+(.+)/)
  return m && m[1] ? m[1].trim() : uptime
}

function parseDiskPercent(s: string): number {
  return parseFloat(s.replace('%', '')) || 0
}

// ─── Metric Card ───

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  sub,
  percent,
  percentColor,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  sub?: string
  percent?: number
  percentColor?: string
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <div className={`rounded-lg p-1.5 ${iconColor}`}>{icon}</div>
        <span className="truncate text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-lg font-bold text-gray-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-400">{sub}</div>}
      {percent !== undefined && (
        <div className="mt-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${percentColor || 'bg-blue-500'}`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main ───

interface MonitorPageProps {
  onNavigateToSsh?: () => void
}

export default function MonitorPage({ onNavigateToSsh }: MonitorPageProps = {}) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [monitorData, setMonitorData] = useState<MonitorData[]>([])
  const [selectedHost, setSelectedHost] = useState<string>('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [showAlerts, setShowAlerts] = useState(false)
  const [alerts, setAlerts] = useState<Alert[]>([])

  const { connections } = useSshStore()
  const connectionList = connections

  // 记录上次采样的累计值，用于计算速率
  const prevSampleRef = useRef<
    Record<
      string,
      {
        netRx: number
        netTx: number
        ioRead: number
        ioWrite: number
        ts: number
      }
    >
  >({})

  // 刷新监控数据
  const refreshDataFn = useCallback(async () => {
    try {
      const resp = await fetch('/api/hosts/health')
      const result: ApiResponse<MonitorData[]> = await resp.json()

      if (result.success && result.data) {
        const data = result.data
        const now = Date.now()

        // 计算网络和磁盘IO速率（两次采样差值 / 时间差）
        const prev = prevSampleRef.current
        const enriched = data.map((h: MonitorData) => {
          const p = prev[h.connectionId]
          const timeDelta = p ? (now - p.ts) / 1000 : 0
          const netRxBps = p && timeDelta > 0 ? ((h.networkRx || 0) - p.netRx) / timeDelta : 0
          const netTxBps = p && timeDelta > 0 ? ((h.networkTx || 0) - p.netTx) / timeDelta : 0
          const ioReadBps =
            p && timeDelta > 0 ? (((h.diskRead || 0) - p.ioRead) * 512) / timeDelta : 0
          const ioWriteBps =
            p && timeDelta > 0 ? (((h.diskWrite || 0) - p.ioWrite) * 512) / timeDelta : 0
          return {
            ...h,
            networkRx: netRxBps > 0 ? netRxBps : 0,
            networkTx: netTxBps > 0 ? netTxBps : 0,
            diskRead: ioReadBps > 0 ? ioReadBps : 0,
            diskWrite: ioWriteBps > 0 ? ioWriteBps : 0,
          }
        })

        // 保存当前采样值
        const newSample: Record<
          string,
          {
            netRx: number
            netTx: number
            ioRead: number
            ioWrite: number
            ts: number
          }
        > = { ...prev }
        data.forEach((h: MonitorData) => {
          newSample[h.connectionId] = {
            netRx: h.networkRx || 0,
            netTx: h.networkTx || 0,
            ioRead: h.diskRead || 0,
            ioWrite: h.diskWrite || 0,
            ts: now,
          }
        })
        prevSampleRef.current = newSample

        setMonitorData(enriched)
        setLoading(false)

        if (!selectedHost && enriched.length > 0 && enriched[0]) {
          setSelectedHost(enriched[0].connectionId)
        }
      }
    } catch (err) {
      console.error('[Monitor] refresh failed:', err)
      setLoading(false)
    } finally {
      setRefreshing(false)
    }
  }, [selectedHost])

  // 刷新告警数据
  const refreshAlertsFn = useCallback(async () => {
    try {
      const resp = await fetch('/api/alerts')
      const result: ApiResponse<Alert[]> = await resp.json()
      if (result.success && result.data) {
        setAlerts(Array.isArray(result.data) ? result.data : [])
      }
    } catch {
      // ignore
    }
  }, [])

  // 手动刷新（按钮调用）
  const handleRefresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    void refreshDataFn()
  }, [refreshing, refreshDataFn])

  // 初始加载 + 定时刷新
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    void refreshDataFn()
    void refreshAlertsFn()
    const t = setInterval(() => {
      void refreshDataFn()
      void refreshAlertsFn()
    }, 30000)
    return () => clearInterval(t)
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleConnectHost = useCallback(
    async (connId: string) => {
      try {
        const conn = connectionList.find((c) => c.id === connId)
        if (!conn) return

        const resp = await fetch('/api/ssh/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            privateKey: conn.privateKey,
          }),
        })
        const result: ApiResponse<{ connectionId: string }> = await resp.json()

        if (result.success && result.data) {
          useSshStore.getState().updateConnection(connId, {
            lastConnectedAt: Date.now(),
          })
          setSelectedHost(result.data.connectionId)
          setTimeout(() => handleRefresh(), 1000)
        } else {
          alert(`连接失败: ${result.error || '未知错误'}`)
        }
      } catch (err) {
        console.error('[Monitor] connect failed:', err)
      }
    },
    [connectionList, handleRefresh],
  )

  const handleSelectHost = useCallback(
    (connectionId: string) => {
      const host = monitorData.find((h) => h.connectionId === connectionId)
      if (host && host.connected) {
        setSelectedHost(connectionId)
        return
      }
      // 尝试通过 SSH store 找到对应连接
      const conn = connectionList.find(
        (c) => c.host === host?.host && c.port === (host?.port || 22),
      )
      if (conn) {
        handleConnectHost(conn.id)
      } else if (onNavigateToSsh) {
        onNavigateToSsh()
      }
    },
    [monitorData, connectionList, handleConnectHost, onNavigateToSsh],
  )

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const selectedData = monitorData.find((h) => h.connectionId === selectedHost)

  // ─── Loading ───
  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-500" />
        <span className="text-sm text-gray-500">正在检查主机状态...</span>
      </div>
    )
  }

  // ─── Render ───
  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Mobile Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white p-3 md:hidden">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">监控</h1>
            <p className="text-xs text-gray-400">
              {monitorData.filter((h) => h.connected).length}/{monitorData.length} 台主机在线
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className={`rounded-lg p-2 transition-colors ${showAlerts ? 'bg-yellow-50 text-yellow-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <AlertTriangle className="h-5 w-5" />
            </button>
            <button
              onClick={() => handleRefresh()}
              disabled={refreshing}
              className="rounded-lg p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Alert Panel */}
      {showAlerts && (
        <div className="mobile-scroll max-h-48 shrink-0 overflow-y-auto border-b border-gray-200 bg-white">
          <div className="p-3">
            <h3 className="mb-2 text-sm font-medium text-gray-700">告警记录</h3>
            {alerts.length === 0 ? (
              <p className="text-xs text-gray-400">暂无告警</p>
            ) : (
              <div className="space-y-1.5">
                {alerts.slice(0, 20).map((a) => (
                  <div
                    key={a.id}
                    className={`rounded p-2 text-xs ${
                      a.level === 'critical'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-yellow-50 text-yellow-700'
                    }`}
                  >
                    <div className="flex justify-between">
                      <span className="font-medium">{a.host}</span>
                      <span className="text-[10px] opacity-75">
                        {new Date(a.timestamp).toLocaleTimeString('zh-CN', {
                          hour12: false,
                        })}
                      </span>
                    </div>
                    <div className="mt-0.5">{a.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="mobile-scroll flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-3 p-3 md:space-y-4 md:p-6">
          {/* Desktop Header */}
          <div className="hidden items-center justify-between md:flex">
            <div>
              <h1 className="text-xl font-bold text-gray-900">系统监控</h1>
              <p className="text-sm text-gray-500">
                {monitorData.filter((h) => h.connected).length}/{monitorData.length} 台主机在线 ·
                30秒自动刷新
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAlerts(!showAlerts)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  showAlerts
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <AlertTriangle className="h-4 w-4" />
                告警 {alerts.length > 0 ? `(${alerts.length})` : ''}
              </button>
              <button
                onClick={() => handleRefresh()}
                disabled={refreshing}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                刷新
              </button>
            </div>
          </div>

          {/* Host Chips */}
          <div className="mobile-scroll flex gap-2 overflow-x-auto pb-2">
            {monitorData.map((h) => (
              <button
                key={h.connectionId}
                onClick={() => handleSelectHost(h.connectionId)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap transition-all ${
                  selectedHost === h.connectionId
                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <div
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: h.connected ? '#22c55e' : h.error ? '#ef4444' : '#9ca3af',
                  }}
                />
                {h.name || h.hostname || h.connectionId}
                {h.error && <span className="ml-0.5 text-[10px] text-red-400">⚠</span>}
              </button>
            ))}
          </div>

          {/* No Host */}
          {monitorData.length === 0 && (
            <div className="rounded-xl bg-white p-6 text-center">
              <Server className="mx-auto mb-3 h-12 w-12 text-gray-300" />
              <p className="mb-1 text-sm text-gray-500">暂无监控数据</p>
              <p className="text-xs text-gray-400">请先连接SSH主机，连接后自动显示</p>
              {connectionList.length === 0 && onNavigateToSsh && (
                <button
                  onClick={onNavigateToSsh}
                  className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
                >
                  去连接
                </button>
              )}
            </div>
          )}

          {/* Selected Host Metrics */}
          {selectedData && (
            <div className="space-y-3">
              {/* Host Info Bar */}
              <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="rounded-lg bg-blue-50 p-2">
                  <Server className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {selectedData.name || selectedData.connectionId}
                  </div>
                  <div className="truncate text-xs text-gray-400">
                    {selectedData.username && selectedData.host
                      ? `${selectedData.username}@${selectedData.host}`
                      : selectedData.connectionId}
                    {selectedData.host && selectedData.port ? `:${selectedData.port}` : ''}
                  </div>
                </div>
                <div
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    selectedData.connected
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {selectedData.connected ? '在线' : '离线'}
                </div>
                {selectedData.error && (
                  <div className="max-w-[100px] truncate text-[10px] text-red-400">
                    {selectedData.error}
                  </div>
                )}
              </div>

              {!selectedData.connected ? (
                <div className="rounded-xl bg-white p-6 text-center">
                  <Wifi className="mx-auto mb-2 h-10 w-10 text-gray-300" />
                  <p className="text-sm text-gray-500">主机离线</p>
                  <p className="mt-1 text-xs text-gray-400">请前往SSH页面连接主机后自动更新</p>
                  {onNavigateToSsh && (
                    <button
                      onClick={onNavigateToSsh}
                      className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
                    >
                      连接主机
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* Core Metrics */}
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                    <MetricCard
                      icon={<Cpu className="h-4 w-4 text-blue-600" />}
                      iconColor="bg-blue-50"
                      label="CPU"
                      value={
                        selectedData.cpu !== undefined
                          ? `${(selectedData.cpu * 100).toFixed(1)}%`
                          : 'N/A'
                      }
                      sub={selectedData.cpuCores ? `${selectedData.cpuCores} 核` : undefined}
                      percent={selectedData.cpu !== undefined ? selectedData.cpu * 100 : undefined}
                      percentColor={
                        (selectedData.cpu || 0) > 0.8
                          ? 'bg-red-500'
                          : (selectedData.cpu || 0) > 0.5
                            ? 'bg-yellow-500'
                            : 'bg-blue-500'
                      }
                    />

                    <MetricCard
                      icon={<MemoryStick className="h-4 w-4 text-purple-600" />}
                      iconColor="bg-purple-50"
                      label="内存"
                      value={
                        selectedData.memoryPercent !== undefined
                          ? `${selectedData.memoryPercent.toFixed(1)}%`
                          : 'N/A'
                      }
                      sub={
                        selectedData.memoryTotal
                          ? `${selectedData.memoryUsed || 0}/${selectedData.memoryTotal} MB`
                          : undefined
                      }
                      percent={selectedData.memoryPercent}
                      percentColor={
                        (selectedData.memoryPercent || 0) > 90
                          ? 'bg-red-500'
                          : (selectedData.memoryPercent || 0) > 70
                            ? 'bg-yellow-500'
                            : 'bg-purple-500'
                      }
                    />

                    {/* Disk: show primary disk (highest usage) */}
                    {(() => {
                      const disks = selectedData.disks
                      if (!disks || disks.length === 0) {
                        return (
                          <MetricCard
                            icon={<HardDrive className="h-4 w-4 text-green-600" />}
                            iconColor="bg-green-50"
                            label="磁盘"
                            value="N/A"
                          />
                        )
                      }
                      const primary = disks.reduce((a, b) =>
                        parseDiskPercent(a.percent) >= parseDiskPercent(b.percent) ? a : b,
                      )
                      return (
                        <MetricCard
                          icon={<HardDrive className="h-4 w-4 text-green-600" />}
                          iconColor="bg-green-50"
                          label={`磁盘 ${primary.mount}`}
                          value={primary.percent}
                          sub={`${primary.used}/${primary.total}`}
                          percent={parseDiskPercent(primary.percent)}
                          percentColor={
                            parseDiskPercent(primary.percent) > 90
                              ? 'bg-red-500'
                              : parseDiskPercent(primary.percent) > 70
                                ? 'bg-yellow-500'
                                : 'bg-green-500'
                          }
                        />
                      )
                    })()}

                    <MetricCard
                      icon={<Clock className="h-4 w-4 text-orange-600" />}
                      iconColor="bg-orange-50"
                      label="运行时间"
                      value={selectedData.uptime ? formatUptime(selectedData.uptime) : 'N/A'}
                      sub={selectedData.processes ? `${selectedData.processes} 进程` : undefined}
                    />
                  </div>

                  {/* Extra Disks (if > 1) */}
                  {selectedData.disks && selectedData.disks.length > 1 && (
                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium text-gray-700">全部分区</span>
                      </div>
                      <div className="space-y-2">
                        {selectedData.disks.map((d) => (
                          <div key={d.mount} className="flex items-center gap-3">
                            <span className="w-16 truncate text-xs text-gray-500">{d.mount}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-green-500 transition-all"
                                style={{ width: d.percent }}
                              />
                            </div>
                            <span className="w-16 text-right text-xs text-gray-500">
                              {d.used}/{d.total}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Network & IO Speed */}
                  <div className="grid grid-cols-2 gap-2 md:gap-3">
                    <button
                      onClick={() => toggleSection('network')}
                      className="rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-cyan-500" />
                          <span className="text-sm font-medium text-gray-700">网络</span>
                        </div>
                        {expandedSections.network ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>↓ 接收</span>
                          <span className="font-mono text-green-600">
                            {formatBps(selectedData.networkRx || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>↑ 发送</span>
                          <span className="font-mono text-blue-600">
                            {formatBps(selectedData.networkTx || 0)}
                          </span>
                        </div>
                      </div>
                    </button>

                    <button
                      onClick={() => toggleSection('diskio')}
                      className="rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4 text-indigo-500" />
                          <span className="text-sm font-medium text-gray-700">磁盘 IO</span>
                        </div>
                        {expandedSections.diskio ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                      <div className="mt-2 space-y-1 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>读取</span>
                          <span className="font-mono text-green-600">
                            {formatBps(selectedData.diskRead || 0)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>写入</span>
                          <span className="font-mono text-blue-600">
                            {formatBps(selectedData.diskWrite || 0)}
                          </span>
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Top Processes */}
                  {selectedData.topProcs && selectedData.topProcs.length > 0 && (
                    <button
                      onClick={() => toggleSection('procs')}
                      className="w-full rounded-xl border border-gray-100 bg-white p-3 text-left shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="h-4 w-4 text-purple-500" />
                          <span className="text-sm font-medium text-gray-700">Top 进程</span>
                        </div>
                        {expandedSections.procs ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </div>
                      {expandedSections.procs && (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="py-1 text-left font-normal">PID</th>
                                <th className="py-1 text-left font-normal">USER</th>
                                <th className="py-1 text-right font-normal">CPU%</th>
                                <th className="py-1 text-right font-normal">MEM%</th>
                                <th className="max-w-[120px] truncate py-1 text-left font-normal">
                                  CMD
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedData.topProcs.map((p) => (
                                <tr key={p.pid} className="text-gray-600">
                                  <td className="py-0.5 font-mono">{p.pid}</td>
                                  <td className="py-0.5">{p.user}</td>
                                  <td className="py-0.5 text-right font-mono">
                                    {p.cpu.toFixed(1)}
                                  </td>
                                  <td className="py-0.5 text-right font-mono">
                                    {p.mem.toFixed(1)}
                                  </td>
                                  <td className="max-w-[120px] truncate py-0.5 text-gray-400">
                                    {p.command}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
