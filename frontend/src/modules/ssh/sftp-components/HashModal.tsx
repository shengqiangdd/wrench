/**
 * HashModal — shows file hash (MD5/SHA1/SHA256) for an SFTP entry
 */
import { memo } from 'react'
import { Binary, X, Loader2 } from 'lucide-react'
import type { SftpEntry } from '../../../types/ssh'
import { fallbackCopy } from '../sftp-utils'

export interface HashData {
  md5: string
  sha1: string
  sha256: string
}

export interface HashModalProps {
  entry: SftpEntry | null
  data: HashData | null
  onClose: () => void
  onCopied: (label: string) => void
}

const HashModal = memo(function HashModal({ entry, data, onClose, onCopied }: HashModalProps) {
  if (!entry) return null

  const handleCopy = (label: string, value: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(value).catch(() => fallbackCopy(value))
    } else {
      fallbackCopy(value)
    }
    onCopied(label)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[90vw] max-w-md overflow-hidden rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Binary size={14} />
            <span className="truncate">文件哈希 — {entry.name}</span>
          </div>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
        {data ? (
          <div className="space-y-2 text-xs text-slate-400">
            {(
              [
                { label: 'MD5', value: data.md5 },
                { label: 'SHA1', value: data.sha1 },
                { label: 'SHA256', value: data.sha256 },
              ] as const
            ).map(({ label, value }) => (
              <div key={label}>
                <div className="mb-0.5 text-[10px] font-medium text-slate-600">{label}</div>
                <div
                  className="cursor-pointer rounded bg-slate-800 px-2 py-1 font-mono text-[10px] break-all text-slate-300 hover:bg-slate-700"
                  onClick={() => handleCopy(label, value)}
                  title="点击复制"
                >
                  {value || '计算失败'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={16} className="animate-spin text-sky-400" />
            <span className="ml-2 text-xs text-slate-400">计算哈希中…</span>
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

export default HashModal
