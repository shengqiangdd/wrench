import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Cpu, MemoryStick, Activity } from 'lucide-react'
import type { DockerContainer } from './index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

interface Props {
  connectionId: string
  containers: DockerContainer[]
}

interface DataPoint {
  time: number
  cpu: number
  mem: number
  memPct: number
  memTotal: number
  pids: number
}

interface MonitorState {
  id: string
  name: string
  data: DataPoint[]
}

const MAX_POINTS = 120 // 2分钟数据（1秒1个点）
const INTERVAL_MS = 2000 // 2秒轮询

// SVG 图表尺寸
const CHART_H = 100

function MiniChart({
  data,
  color,
  maxValue,
  unit,
  valueAccessor,
}: {
  data: DataPoint[]
  color: string
  maxValue: number
  unit: string
  valueAccessor?: (d: DataPoint) => number
}) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-[10px] text-slate-600">等待数据...</div>
    )
  }

  const getVal = valueAccessor || ((d: DataPoint) => d.cpu)

  const points = data
    .map((d, i) => {
      const x = (i / (MAX_POINTS - 1)) * 100
      const y = CHART_H - (Math.min(getVal(d), maxValue) / maxValue) * (CHART_H - 8) - 4
      return `${x},${y}`
    })
    .join(' ')

  const latest = data[data.length - 1]
  if (!latest) return null
  const val = unit === '%' ? getVal(latest).toFixed(1) : latest.mem.toFixed(0)
  const displayVal = unit === '%' ? `${val}%` : `${val}MB`

  return (
    <div className="relative">
      <svg
        width="100%"
        viewBox={`0 0 100 ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-[100px] overflow-visible"
      >
        {/* 网格线 */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            y1={CHART_H - f * (CHART_H - 8) - 4}
            x2={100}
            y2={CHART_H - f * (CHART_H - 8) - 4}
            stroke="rgba(148,163,184,0.08)"
            strokeWidth={1}
          />
        ))}
        {/* 折线 */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* 面积填充 */}
        <polyline
          points={`0,${CHART_H} ${points} 100,${CHART_H}`}
          fill={`${color}15`}
          stroke="none"
        />
      </svg>
      {/* 最新值标注 */}
      <div
        className="absolute top-1 right-1 rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color }}
      >
        {displayVal}
      </div>
    </div>
  )
}

export default function DockerMonitor({ connectionId, containers: propContainers }: Props) {
  const [monitors, setMonitors] = useState<MonitorState[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dataRef = useRef<MonitorState[]>([])
  const selectedRef = useRef<Set<string>>(new Set())

  // 自己获取容器列表（不依赖父组件传递）
  const [containers, setContainers] = useState<DockerContainer[]>(propContainers)
  const fetchContainers = useCallback(async () => {
    if (!connectionId) return
    try {
      const res = await fetch('/api/docker/ps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, all: true }),
      })
      const json = (await res.json()) as ApiResponse
      if (json.success) {
        const output = (json.data?.data ?? json.data ?? '').toString()
        const lines = output.trim().split('\n').filter(Boolean)
        const list: DockerContainer[] = lines
          .map((line: string) => {
            try { return JSON.parse(line) } catch { return null }
          })
          .filter(Boolean)
        setContainers(list)
      }
    } catch { /* ignore */ }
  }, [connectionId])

  // 挂载时获取容器列表（用 ref 避免 lint 警告）
  const fetchedRef = useRef(false)
  useEffect(() => {
    if (!fetchedRef.current && connectionId) {
      fetchedRef.current = true
      void fetchContainers()
    }
  }, [connectionId, fetchContainers])

  useEffect(() => {
    dataRef.current = monitors
    selectedRef.current = selectedIds
  }, [monitors, selectedIds])

  // 选择/取消选择容器
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 全选
  const selectAll = useCallback(() => {
    setSelectedIds(new Set(containers.map((c) => c.ID)))
  }, [containers])

  // 取消全选
  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // 初始化时自动选中所有运行中的容器
  const initRef = useRef(false)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!initRef.current && containers.length > 0) {
      initRef.current = true
      const running = containers.filter((c) => c.State === 'running')
      if (running.length > 0) {
        setSelectedIds(new Set(running.map((c) => c.ID)))
      }
    }
  }, [containers])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 获取 stats
  function parseSize(s: string): number {
    s = s.trim()
    const match = s.match(/^([\d.]+)\s*([KMGTPE]i?B?|B)?$/i)
    if (!match) return 0
    const num = parseFloat(match[1]!)
    const unit = (match[2] || 'B').toUpperCase()
    const units: Record<string, number> = {
      B: 1,
      KB: 1024,
      KIB: 1024,
      K: 1024,
      MB: 1024 * 1024,
      MIB: 1024 * 1024,
      M: 1024 * 1024,
      GB: 1024 ** 3,
      GIB: 1024 ** 3,
      G: 1024 ** 3,
      TB: 1024 ** 4,
      TIB: 1024 ** 4,
      T: 1024 ** 4,
    }
    return num * (units[unit] || 1)
  }

  const fetchStats = useCallback(async () => {
    if (!connectionId) return
    setLoading(true)
    try {
      // Use batch endpoint to get all container stats at once
      const res = await fetch('/api/docker/stats/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = (await res.json()) as ApiResponse
      if (!json.success) {
        // If batch endpoint fails (e.g. docker stats not supported), silently skip
        return
      }

      const output = (json.data?.data ?? json.data ?? '').toString()
      const lines = output.trim().split('\n').filter(Boolean)
      const now = Date.now()

      setMonitors((prev) => {
        const prevMap = new Map(prev.map((m) => [m.id, m]))
        const newMonitors: MonitorState[] = []

        for (const line of lines) {
          try {
            const s = JSON.parse(line)
            const id = s.ID || s.Container || ''
            const name = s.Name || id

            // 解析 CPU（格式: "2.50%"）
            const cpuPct = parseFloat(s.CPUPerc) || 0

            // 解析内存（格式: "123.4MiB / 1.945GiB"）
            let memPct = 0
            let memUsed = 0
            let memTotal = 0
            if (s.MemUsage) {
              const parts = s.MemUsage.split('/')
              memUsed = parseSize(parts[0].trim())
              memTotal = parseSize(parts[1]?.trim() || '0B')
              memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0
            }

            const pids = parseInt(s.PIDs) || 0
            const point: DataPoint = {
              time: now,
              cpu: cpuPct,
              mem: memUsed / (1024 * 1024),
              memPct,
              memTotal,
              pids,
            }

            const existing = prevMap.get(id)
            if (existing) {
              const data = [...existing.data, point]
              if (data.length > MAX_POINTS) data.splice(0, data.length - MAX_POINTS)
              newMonitors.push({ id, name, data })
            } else {
              newMonitors.push({ id, name, data: [point] })
            }
          } catch {
            /* skip parse errors */
          }
        }

        // 保留未出现在当前轮询但仍有数据的容器（避免闪烁）
        for (const [id, m] of prevMap) {
          if (!newMonitors.find((nm) => nm.id === id)) {
            newMonitors.push(m)
          }
        }

        return newMonitors
      })
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // 解析大小字符串

  // 自动轮询
  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const t = setTimeout(() => fetchStats(), 0)
    timerRef.current = setInterval(fetchStats, INTERVAL_MS)
    return () => {
      clearTimeout(t)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [autoRefresh, fetchStats])

  // 选中容器对应的监控数据
  const selectedMonitors = monitors.filter((m) => selectedIds.has(m.id))

  // 全部容器的列表
  const runningContainers = containers.filter((c) => c.State === 'running')

  return (
    <div className="flex h-full flex-col">
      {/* 控制栏 */}
      <div className="flex shrink-0 items-center border-b border-slate-700/30 px-4 py-2">
        <Activity size={14} className="text-wrench-400 mr-1.5" />
        <span className="text-xs font-medium text-slate-400">实时监控</span>
        <div className="ml-auto flex items-center gap-2">
          {/* 自动刷新开关 */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="text-wrench-500 h-3 w-3 rounded border-slate-600 bg-slate-700"
            />
            实时
          </label>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* 容器列表（多选） */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/30 px-4 py-1.5">
        <span className="text-[10px] text-slate-500">选择容器:</span>
        <button
          onClick={selectAll}
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          全选
        </button>
        <button
          onClick={deselectAll}
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          取消
        </button>
        <div className="ml-2 flex flex-wrap gap-1">
          {runningContainers.map((c) => {
            const isSelected = selectedIds.has(c.ID)
            const displayName = c.Names.length > 20 ? c.Names.slice(0, 18) + '…' : c.Names
            return (
              <button
                key={c.ID}
                onClick={() => toggleSelect(c.ID)}
                className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                  isSelected
                    ? 'bg-wrench-500/20 text-wrench-300 ring-wrench-500/40 ring-1'
                    : 'bg-slate-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {displayName}
              </button>
            )
          })}
          {runningContainers.length === 0 && (
            <span className="text-[10px] text-slate-600">无运行中的容器</span>
          )}
        </div>
      </div>

      {/* 监控图表区域 */}
      <div className="flex-1 overflow-auto p-3">
        {selectedMonitors.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {runningContainers.length === 0
              ? '暂无运行中的容器，启动容器后监控数据将自动显示'
              : '在上方选择一个或多个容器开始监控'}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))' }}
          >
            {selectedMonitors
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((m) => {
                const latest = m.data[m.data.length - 1]
                const memPct = latest ? latest.memPct : 0
                const pids = latest ? latest.pids : 0

                return (
                  <div
                    key={m.id}
                    className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3"
                  >
                    {/* 标题行 */}
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          memPct > 80
                            ? 'bg-red-500'
                            : memPct > 50
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                      />
                      <span className="truncate text-sm font-medium text-slate-200">{m.name}</span>
                      <span className="text-[10px] text-slate-500">{m.id.slice(0, 12)}</span>
                      {latest && (
                        <span className="ml-auto text-[10px] text-slate-500">{pids} PID</span>
                      )}
                    </div>

                    {/* CPU 图表 */}
                    <div className="mb-1">
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                        <Cpu size={10} />
                        CPU
                      </div>
                      <div className="flex items-center gap-3">
                        <MiniChart data={m.data} color="#60a5fa" maxValue={100} unit="%" />
                        {latest && (
                          <div className="shrink-0 space-y-0.5 text-[10px] text-slate-500">
                            <div>
                              当前:{' '}
                              <span className="font-mono text-blue-400">
                                {latest.cpu.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              峰值:{' '}
                              <span className="font-mono text-blue-400">
                                {Math.max(...m.data.map((d) => d.cpu)).toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              均值:{' '}
                              <span className="font-mono text-blue-400">
                                {(m.data.reduce((a, d) => a + d.cpu, 0) / m.data.length).toFixed(1)}
                                %
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 内存图表 */}
                    <div>
                      <div className="mb-0.5 flex items-center gap-1 text-[10px] text-slate-500">
                        <MemoryStick size={10} />
                        内存
                      </div>
                      <div className="flex items-center gap-3">
                        <MiniChart
                          data={m.data}
                          color="#a78bfa"
                          maxValue={100}
                          unit="%"
                          valueAccessor={(d) => d.memPct}
                        />
                        {latest && (
                          <div className="shrink-0 space-y-0.5 text-[10px] text-slate-500">
                            <div>
                              使用:{' '}
                              <span className="font-mono text-purple-400">
                                {latest.mem.toFixed(0)} MB
                              </span>
                            </div>
                            <div>
                              占比:{' '}
                              <span className="font-mono text-purple-400">
                                {latest.memPct.toFixed(1)}%
                              </span>
                            </div>
                            <div>
                              总量:{' '}
                              <span className="font-mono text-purple-400">
                                {(latest.memTotal / (1024 * 1024 * 1024)).toFixed(1)} GB
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 提示条 */}
                    {/* Only show if container has data */}
                    {m.data.length < 5 && (
                      <div className="mt-1 text-[9px] text-slate-600 italic">
                        数据采集中 ({m.data.length}/{MAX_POINTS})
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}
