/**
 * DiskUsageModal — shows disk usage statistics for a directory/file
 */
import { memo } from 'react'
import { HardDrive, X, Loader2 } from 'lucide-react'
import type { SftpEntry } from '../../../types/ssh'
import { formatSize } from '../sftp-utils'

export interface DiskUsageData {
  totalSize: number
  fileCount: number
  dirCount: number
  largestFile?: string
  largestSize: number
}

export interface DiskUsageModalProps {
  entry: SftpEntry | null
  data: DiskUsageData | null
  onClose: () => void
}

const DiskUsageModal = memo(function DiskUsageModal({ entry, data, onClose }: DiskUsageModalProps) {
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
            <HardDrive size={14} />
            <span className="truncate">磁盘使用 — {entry.name}</span>
          </div>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
        {data ? (
          <div className="space-y-1.5 text-xs text-slate-400">
            <div className="flex justify-between">
              <span className="text-slate-600">总大小</span>
              <span className="text-sky-400">{formatSize(data.totalSize)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">文件数</span>
              <span>{data.fileCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">目录数</span>
              <span>{data.dirCount}</span>
            </div>
            {data.largestFile && (
              <div className="flex justify-between break-all">
                <span className="shrink-0 text-slate-600">最大文件</span>
                <span className="text-right text-[10px] text-slate-500">
                  {data.largestFile.split('/').pop()} ({formatSize(data.largestSize)})
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-sky-400" />
            <span className="ml-2 text-xs text-slate-400">计算中…</span>
          </div>
        )}
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

export default DiskUsageModal
