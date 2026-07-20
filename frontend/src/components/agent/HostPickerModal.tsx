/**
 * HostPickerModal.tsx
 *
 * AI 命令执行主机选择弹窗 — 展示所有 SSH 连接，标记已连接状态，用户选择后执行命令。
 */

import { useState, useCallback, useMemo } from 'react'
import { Monitor, Wifi, WifiOff, Loader2, X } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import type { SshConnection } from '../../types/ssh'

interface Props {
  /** 要执行的命令 */
  command: string
  /** 关闭回调 */
  onClose: () => void
  /** 执行回调（传入 connectionId 和连接详情） */
  onExecute: (connectionId: string, conn?: SshConnection) => void
}

export default function HostPickerModal({ command, onClose, onExecute }: Props) {
  const connections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)
  const [executing, setExecuting] = useState<string | null>(null)

  /** 连接状态映射 */
  const statusMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of sessions) {
      map[s.connectionId] = s.status
    }
    return map
  }, [sessions])

  const handleSelect = useCallback(
    (connId: string) => {
      setExecuting(connId)
      const conn = connections.find((c) => c.id === connId)
      onExecute(connId, conn)
    },
    [onExecute, connections],
  )

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-md rounded-xl border border-slate-700/50 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">选择执行主机</h3>
            <p className="mt-0.5 max-w-[300px] truncate text-xs text-slate-500" title={command}>
              $ {command}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* 连接列表 */}
        <div className="max-h-80 overflow-y-auto p-2">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-slate-500">
              <Monitor size={32} className="mb-2 opacity-40" />
              <p className="text-sm">暂无 SSH 连接</p>
              <p className="text-xs">请先在 SSH 页面添加并连接主机</p>
            </div>
          ) : (
            <div className="space-y-1">
              {connections.map((conn) => {
                const status = statusMap[conn.id]
                const isConnected = status === 'connected'
                const isConnecting = status === 'connecting'
                const isLoading = executing === conn.id

                return (
                  <button
                    key={conn.id}
                    onClick={() => !isConnecting && handleSelect(conn.id)}
                    disabled={isConnecting}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      isConnected
                        ? 'hover:bg-slate-800/80'
                        : isConnecting
                          ? 'opacity-60'
                          : 'hover:bg-slate-800/50'
                    }`}
                  >
                    {/* 状态图标 */}
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                      {isLoading ? (
                        <Loader2 size={14} className="text-wrench-400 animate-spin" />
                      ) : isConnected ? (
                        <Wifi size={14} className="text-emerald-400" />
                      ) : (
                        <WifiOff size={14} className="text-slate-500" />
                      )}
                    </div>

                    {/* 连接信息 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-200">
                          {conn.name || conn.host}
                        </span>
                        {isConnected && (
                          <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            已连接
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {conn.username}@{conn.host}:{conn.port}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
