import { useState, useCallback } from 'react'
import { ScrollText, PanelLeftOpen, PanelLeftClose, X, ChevronDown } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import LogViewer from './LogViewer'
import SourceConfig from './SourceConfig'

export default function LogsPage() {
  const sessions = useSshStore((s) => s.sessions)

  // 主机选择状态
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const currentConnId = selectedSessionId || (sessions.length > 0 ? sessions[0]!.id : null)

  // 当 sessions 变化时自动选中第一个
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)

  const handleSelectPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleSessionChange = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
    setCurrentPath(null) // 切换主机时清空路径
  }, [])

  // 未连接
  if (!currentConnId) {
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <ScrollText size={18} className="text-sky-400" />
        <h1 className="text-sm font-semibold text-slate-200">日志聚合</h1>

        {/* 主机选择下拉菜单 - 多连接时显示 */}
        {sessions.length > 1 && (
          <div className="relative">
            <select
              value={currentConnId || ''}
              onChange={(e) => handleSessionChange(e.target.value)}
              className="ml-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id} className="bg-slate-800">
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
          {sessions.length > 1 ? `${sessions.length} 个连接可用` : '1 个连接'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setSourcePanelOpen(!sourcePanelOpen)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title={sourcePanelOpen ? '收起日志源' : '展开日志源'}
          >
            {sourcePanelOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            {sourcePanelOpen ? '' : '日志源'}
          </button>
        </div>
      </div>

      {/* 主体：双栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：日志源列表 */}
        {sourcePanelOpen && (
          <div className="fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-700/30 bg-slate-950 md:static md:z-auto md:bg-slate-900/40">
            <div className="flex items-center justify-between border-b border-slate-700/30 px-3 py-1.5 md:hidden">
              <span className="text-xs font-medium text-slate-400">日志源</span>
              <button
                onClick={() => setSourcePanelOpen(false)}
                className="btn-icon text-slate-500 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
            <SourceConfig
              connectionId={currentConnId}
              currentPath={currentPath}
              onSelectPath={handleSelectPath}
            />
          </div>
        )}

        {/* 右侧：日志查看器 */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {currentPath ? (
            <LogViewer
              key={`${currentConnId}-${currentPath}`}
              connectionId={currentConnId}
              logPath={currentPath}
              onClose={() => setCurrentPath(null)}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500">
              <ScrollText size={36} className="text-slate-600" />
              <div className="text-center">
                <p className="text-sm font-medium text-slate-400">选择日志源开始查看</p>
                <p className="mt-1 text-xs text-slate-600">
                  从左侧选择一个日志路径，或点击「自动发现」扫描服务器
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
