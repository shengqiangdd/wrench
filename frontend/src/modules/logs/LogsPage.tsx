import { useState, useCallback, useRef } from 'react'
import { ScrollText, ChevronDown } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import LogViewer from './LogViewer'
import SourceConfig from './SourceConfig'

export default function LogsPage() {
  const sessions = useSshStore((s) => s.sessions)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const currentId = selectedId || (sessions.length > 0 ? sessions[0]!.id : null)

  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)

  // 追踪 connectionId 变化，通知 SourceConfig 重新扫描
  const prevConnIdRef = useRef(currentId)
  const [scanKey, setScanKey] = useState(0)
  if (currentId !== prevConnIdRef.current) {
    prevConnIdRef.current = currentId
    setCurrentPath(null)
    setScanKey((k) => k + 1)
  }

  const handleSelectPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleSessionChange = useCallback((id: string) => {
    setSelectedId(id)
    setCurrentPath(null)
  }, [])

  if (!currentId) {
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

  const currentSession = sessions.find((s) => s.id === currentId)
  const currentHostLabel = currentSession?.connectionName || currentSession?.host || currentId

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <ScrollText size={18} className="text-sky-400" />
        <h1 className="text-sm font-semibold text-slate-200">日志聚合</h1>

        {sessions.length > 1 && (
          <div className="relative">
            <select
              value={currentId}
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
        {/* 始终渲染 SourceConfig，用 CSS 隐藏，避免重建丢失状态 */}
        <div
          className="shrink-0 overflow-y-auto border-r border-slate-700/50 bg-slate-900/50 transition-all"
          style={{ width: sourcePanelOpen ? 224 : 0, overflow: 'hidden' }}
        >
          <SourceConfig
            scanKey={scanKey}
            connectionId={currentId}
            onSelectPath={handleSelectPath}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {currentPath ? (
            <LogViewer connectionId={currentId} logPath={currentPath} onClose={() => setCurrentPath(null)} />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p className="text-xs">← 选择一个日志文件开始查看</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
