/**
 * ChmodModal — permission editor with octal input and checkboxes
 */
import { memo } from 'react'
import type { SftpEntry } from '../../../types/ssh'
import { formatPerms } from '../sftp-utils'

export interface ChmodModalProps {
  entry: SftpEntry | null
  chmodValue: string
  onChmodValueChange: (value: string) => void
  onConfirm: () => void
  onClose: () => void
}

const PRESETS = [
  { label: '755', desc: 'rwxr-xr-x' },
  { label: '777', desc: 'rwxrwxrwx' },
  { label: '644', desc: 'rw-r--r--' },
  { label: '600', desc: 'rw-------' },
  { label: '700', desc: 'rwx------' },
  { label: '666', desc: 'rw-rw-rw-' },
] as const

const WHO_LABELS = ['所有者', '用户组', '其他'] as const
const PERMS = ['r', 'w', 'x'] as const
const BITS = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001] as const

const ChmodModal = memo(function ChmodModal({
  entry,
  chmodValue,
  onChmodValueChange,
  onConfirm,
  onClose,
}: ChmodModalProps) {
  if (!entry) return null

  const handleOctalInput = (raw: string) => {
    const v = raw.replace(/[^0-7]/g, '').slice(0, 4)
    onChmodValueChange(v)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onConfirm()
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-medium text-slate-200">修改权限</h3>
        <p className="mb-1 text-xs text-slate-400">{entry.name}</p>
        <p className="mb-3 text-xs text-slate-500">
          当前: {formatPerms(parseInt(entry.permissions, 16) || 0)}
        </p>

        {/* Octal input */}
        <div className="mb-3">
          <label className="mb-1 block text-xs text-slate-500">八进制权限</label>
          <input
            autoFocus
            value={chmodValue}
            onChange={(e) => handleOctalInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500"
            placeholder="例如: 755"
            maxLength={4}
          />
        </div>

        {/* Preset buttons */}
        <div className="mb-3 grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => onChmodValueChange(p.label)}
              className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                chmodValue === p.label
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              <div className="font-medium">{p.label}</div>
              <div className="text-[8px] opacity-60">{p.desc}</div>
            </button>
          ))}
        </div>

        {/* rwx checkboxes */}
        <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500">
          {(['owner', 'group', 'others'] as const).map((who, wi) => (
            <div key={who}>
              <div className="mb-1 font-medium text-slate-400">{WHO_LABELS[wi]}</div>
              {PERMS.map((perm, pi) => {
                const bitVal = BITS[wi * 3 + pi] ?? 0
                const current = parseInt(chmodValue, 8) || 0
                const checked = (current & bitVal) === bitVal
                return (
                  <label
                    key={perm}
                    className="flex cursor-pointer items-center justify-center gap-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const newVal = checked ? current & ~bitVal : current | bitVal
                        onChmodValueChange((newVal & 0o7777).toString(8).padStart(4, '0'))
                      }}
                      className="accent-sky-500"
                    />
                    <span>{perm}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
})

export default ChmodModal
