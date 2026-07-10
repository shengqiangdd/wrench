import { useState, useCallback } from 'react'
import { ScrollText, ChevronDown } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import LogViewer from './LogViewer'
import SourceConfig from './SourceConfig'

export default function LogsPage() {
  const sessions = useSshStore((s) => s.sessions)

  // 主机选择 — 用 connectionId（后端 SSH 连接 ID），不是前端 session.id
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null)
  const currentConnId = selectedConnId || (sessions.length > 0 ? sessions[0]!.connectionId : null)

  // 计算有效连接：如果选中的不在列表中，fallback 到第一个
  const effectiveConnId = sessions.find((s) => s.connectionId === currentConnId)
    ? currentConnId
    : sessions.length > 0
      ? sessions[0]!.connectionId
      : null

  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)

  const handleSelectPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleSessionChange = useCallback((connId: string) => {
    setSelectedConnId(connId)
    setCurrentPath(null)
  }, [])

  // 未连接
  if (!effectiveConnId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
        <ScrollText size={48} className="text-slate-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">未连接到任何 SSH</p>
          <p className="mt-1 text-xs">请先在 SSH 页面建立连接，再使用日志聚合</p>
        </div>
      </div>
    )
  }

  // 当前选中的主机名
  const currentSession = sessions.find((s) => s.connectionId === effectiveConnId)
  const currentHostLabel = currentSession?.connectionName || currentSession?.host || effectiveConnId

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <ScrollText size={18} className="text-sky-400" />
        <h1 className="text-sm font-semibold text-slate-200">日志聚合</h1>

        {/* 主机选择下拉菜单 */}
        {sessions.length > 1 && (
          <div className="relative">
            <select
              value={effectiveConnId}
              onChange={(e) => handleSessionChange(e.target.value)}
              className="ml-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {sessions.map((s) => (
                <option key={s.connectionId} value={s.connectionId} className="bg-slate-800">
                  {s.connectionName || s.host}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-slate-500"
            />
          </div>
        )}

        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
          {currentHostLabel}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setSourcePanelOpen(!sourcePanelOpen)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            {sourcePanelOpen ? '收起' : '展开'} 日志源
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧日志源面板 */}
        {sourcePanelOpen && (
          <div className="w-56 shrink-0 overflow-y-auto border-r border-slate-700/50 bg-slate-900/50">
            <SourceConfig
              key={effectiveConnId}
              connectionId={effectiveConnId}
              onSelectPath={handleSelectPath}
            />
          </div>
        )}

        {/* 右侧日志查看器 */}
        <div className="min-w-0 flex-1 overflow-hidden">
          <LogViewer connectionId={effectiveConnId} logPath={currentPath || ''} />
        </div>
      </div>
    </div>
  )
}
