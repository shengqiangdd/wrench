import { X } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

export default function RightPanel() {
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const rightPanelContent = useAppStore((s) => s.rightPanelContent)
  const toggleRightPanel = useAppStore((s) => s.toggleRightPanel)
  const setRightPanelContent = useAppStore((s) => s.setRightPanelContent)

  if (!rightPanelOpen) return null

  return (
    <aside className="flex min-h-0 w-80 flex-col border-l border-slate-700/50 bg-slate-900/80 md:w-96">
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="text-xs font-medium tracking-wider text-slate-400 uppercase">
          {rightPanelContent?.title || '面板'}
        </span>
        <button
          onClick={() => {
            toggleRightPanel()
            setRightPanelContent(null)
          }}
          className="btn-icon text-slate-500 hover:text-slate-300"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 text-sm text-slate-400">
        {rightPanelContent?.component || (
          <p className="text-center text-slate-500">选择内容以在此处显示</p>
        )}
      </div>
    </aside>
  )
}
