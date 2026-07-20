/**
 * MoveModal — dialog to move a file/directory to a target path
 * Includes a mini directory browser for picking target on mobile
 */
import { memo, useState, useCallback, useEffect } from 'react'
import { Folder, ChevronRight, Loader2 } from 'lucide-react'
import type { SftpEntry } from '../../../types/ssh'

export interface MoveModalProps {
  entry: SftpEntry | null
  target: string
  busy: boolean
  onTargetChange: (value: string) => void
  onConfirm: () => void
  onClose: () => void
  sessionId?: string | null
}

const MoveModal = memo(function MoveModal({
  entry,
  target,
  busy,
  onTargetChange,
  onConfirm,
  onClose,
  sessionId,
}: MoveModalProps) {
  const [browsePath, setBrowsePath] = useState('/')
  const [dirEntries, setDirEntries] = useState<SftpEntry[]>([])
  const [loadingDirs, setLoadingDirs] = useState(false)

  const loadDir = useCallback(
    async (path: string) => {
      if (!sessionId) return
      setLoadingDirs(true)
      try {
        const res = await fetch('/api/sftp/list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: sessionId, path }),
        })
        if (res.ok) {
          const data = await res.json()
          // 只显示目录
          setDirEntries((data as SftpEntry[]).filter((e) => e.type === 'directory'))
        }
      } catch {
        // ignore
      } finally {
        setLoadingDirs(false)
      }
    },
    [sessionId],
  )

  useEffect(() => {
    loadDir(browsePath)
  }, [browsePath, loadDir])

  const navigateUp = () => {
    const parent = browsePath === '/' ? '/' : browsePath.split('/').slice(0, -1).join('/') || '/'
    setBrowsePath(parent)
    onTargetChange(parent.endsWith('/') ? parent : `${parent}/`)
  }

  if (!entry) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-sm font-medium text-slate-200">移动到</h3>
        <p className="mb-2 text-xs text-slate-400">移动: {entry.name}</p>

        {/* 手动输入 */}
        <input
          autoFocus
          value={target}
          onChange={(e) => onTargetChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) onConfirm()
            if (e.key === 'Escape') onClose()
          }}
          className="mb-2 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500"
          placeholder="目标路径，例如: /tmp/"
        />

        {/* 目录浏览器 */}
        {sessionId && (
          <div className="mb-3 max-h-[200px] overflow-y-auto rounded border border-slate-700 bg-slate-950">
            {/* 当前路径 + 上级 */}
            <div
              className="flex cursor-pointer items-center gap-1 border-b border-slate-800 px-2 py-1 text-[10px] text-slate-500 hover:bg-slate-800"
              onClick={navigateUp}
            >
              <Folder size={10} className="shrink-0 text-sky-500" />
              <span className="truncate">{browsePath || '/'}</span>
              <ChevronRight size={8} className="shrink-0" />
              <span className="text-slate-400">上级目录</span>
            </div>
            {loadingDirs ? (
              <div className="flex items-center justify-center py-3">
                <Loader2 size={12} className="animate-spin text-sky-400" />
              </div>
            ) : dirEntries.length === 0 ? (
              <div className="py-2 text-center text-[10px] text-slate-600">无子目录</div>
            ) : (
              dirEntries.map((de) => (
                <div
                  key={de.path}
                  className="flex cursor-pointer items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                  onClick={() => {
                    setBrowsePath(de.path)
                    onTargetChange(de.path.endsWith('/') ? de.path : `${de.path}/`)
                  }}
                >
                  <Folder size={10} className="shrink-0 text-sky-500" />
                  <span className="truncate">{de.name}</span>
                </div>
              ))
            )}
          </div>
        )}

        <p className="mb-3 text-[10px] text-slate-600">以 / 结尾表示移到目录内。</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={busy || !target.trim()}
            className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {busy ? '移动中…' : '移动'}
          </button>
        </div>
      </div>
    </div>
  )
})

export default MoveModal
