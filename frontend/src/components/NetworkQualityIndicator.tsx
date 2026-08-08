/**
 * NetworkQualityIndicator.tsx
 *
 * 实时显示 WebSocket 连接质量：
 * - 状态指示灯（绿/黄/红）
 * - 延迟（ms）
 * - 连接池大小
 * - 连接成功率
 *
 * 使用方式：<NetworkQualityIndicator />
 */

import { useEffect, useState, memo } from 'react'
import { Activity, Wifi, WifiOff } from 'lucide-react'
import { getWsClientSync, type WsStatus } from '../services/websocket'
import { sshSessionManager } from '../services/ssh-session-manager'

interface NetworkStats {
  status: WsStatus
  rtt: number
  poolSize: number
  successRate: number
  lastError: string | null
}

function getStatusColor(status: WsStatus, rtt: number): string {
  if (status === 'disconnected' || status === 'reconnecting') return 'text-red-400'
  if (status === 'connecting') return 'text-amber-400'
  if (rtt > 500) return 'text-amber-400'
  if (rtt > 1000) return 'text-red-400'
  return 'text-emerald-400'
}

function getStatusLabel(status: WsStatus): string {
  switch (status) {
    case 'connected': return '已连接'
    case 'connecting': return '连接中...'
    case 'reconnecting': return '重连中...'
    case 'disconnected': return '已断开'
  }
}

function NetworkQualityIndicatorInner() {
  const [stats, setStats] = useState<NetworkStats>({
    status: 'disconnected',
    rtt: 0,
    poolSize: 0,
    successRate: 1,
    lastError: null,
  })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const client = getWsClientSync()

    // 监听状态变化
    const unsubStatus = client.onStatus((status) => {
      setStats((prev) => ({ ...prev, status }))
    })

    // 定时刷新 RTT 和池状态
    const interval = setInterval(() => {
      setStats((prev) => ({
        ...prev,
        rtt: client.averageRtt,
        poolSize: sshSessionManager.getPoolSize(),
        successRate: sshSessionManager.getConnectSuccessRate(),
        lastError: sshSessionManager.getLastConnectError(),
      }))
    }, 2000)

    return () => {
      unsubStatus()
      clearInterval(interval)
    }
  }, [])

  const color = getStatusColor(stats.status, stats.rtt)
  const label = getStatusLabel(stats.status)

  return (
    <div className="relative">
      {/* 简洁模式：只显示状态灯 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-slate-800/50"
        title={`连接状态：${label}`}
      >
        {stats.status === 'connected' || stats.status === 'connecting' ? (
          <Wifi size={12} className={color} />
        ) : (
          <WifiOff size={12} className={color} />
        )}
        <span className={color}>
          {stats.status === 'connected' && stats.rtt > 0 ? `${stats.rtt}ms` : label}
        </span>
      </button>

      {/* 展开面板 */}
      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-slate-700/50 bg-slate-900 p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-300">
            <Activity size={12} />
            连接质量
          </div>

          <div className="space-y-2 text-[11px]">
            {/* 状态 */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">状态</span>
              <span className={color}>{label}</span>
            </div>

            {/* 延迟 */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">延迟</span>
              <span className="text-slate-300">
                {stats.rtt > 0 ? `${stats.rtt}ms` : '-'}
              </span>
            </div>

            {/* 连接池 */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">活跃连接</span>
              <span className="text-slate-300">{stats.poolSize}</span>
            </div>

            {/* 成功率 */}
            <div className="flex items-center justify-between">
              <span className="text-slate-500">成功率</span>
              <span className={stats.successRate > 0.5 ? 'text-emerald-400' : 'text-amber-400'}>
                {Math.round(stats.successRate * 100)}%
              </span>
            </div>

            {/* 最近错误 */}
            {stats.lastError && (
              <div className="mt-1 rounded bg-red-500/10 px-2 py-1 text-[10px] text-red-400">
                {stats.lastError.length > 40
                  ? stats.lastError.slice(0, 40) + '...'
                  : stats.lastError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export const NetworkQualityIndicator = memo(NetworkQualityIndicatorInner)
