/**
 * FileInfoModal — displays file metadata for SFTP entries
 */
import { memo } from 'react'
import { X } from 'lucide-react'
import type { SftpEntry } from '../../../types/ssh'
import { getFileIcon, formatSize, formatPerms } from '../sftp-utils'

export interface FileInfoModalProps {
  entry: SftpEntry | null
  onClose: () => void
}

const FileInfoModal = memo(function FileInfoModal({ entry, onClose }: FileInfoModalProps) {
  if (!entry) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[90vw] max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            {getFileIcon(entry.name, entry.type, entry.targetType)}
            <span className="truncate">{entry.name}</span>
          </div>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
        <div className="space-y-1.5 text-xs text-slate-400">
          <div className="flex justify-between">
            <span className="text-slate-600">类型</span>
            <span>
              {entry.type === 'symlink'
                ? `符号链接 → ${entry.targetType || 'unknown'}`
                : entry.type}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">大小</span>
            <span>{formatSize(entry.size)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">权限</span>
            <span className="font-mono">
              {formatPerms(parseInt(entry.permissions, 16) || 0)} ({entry.permissions})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">修改时间</span>
            <span>
              {entry.modifyTime ? new Date(entry.modifyTime * 1000).toLocaleString() : '-'}
            </span>
          </div>
          <div className="flex justify-between break-all">
            <span className="shrink-0 text-slate-600">路径</span>
            <span className="text-right font-mono text-[10px] text-slate-500">{entry.path}</span>
          </div>
          {entry.type === 'symlink' && entry.linkTarget && (
            <div className="flex justify-between break-all">
              <span className="shrink-0 text-slate-600">链接目标</span>
              <span className="text-right font-mono text-[10px] text-cyan-500">
                {entry.linkTarget}
              </span>
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
})

export default FileInfoModal
