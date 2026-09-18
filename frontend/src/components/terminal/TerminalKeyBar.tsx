import { ChevronUp, ChevronDown, ClipboardPaste } from 'lucide-react'

interface Props {
  collapsed: boolean
  onToggle: () => void
  onSend: (sequence: string) => void
  onPaste: () => void
}

const PRIMARY_KEYS = [
  ['Ctrl+C', '\x03'],
  ['Ctrl+D', '\x04'],
  ['Tab', '\t'],
  ['Esc', '\x1b'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
] as const

const MORE_KEYS = [
  ['Home', '\x1b[H'],
  ['End', '\x1b[F'],
  ['PgUp', '\x1b[5~'],
  ['PgDn', '\x1b[6~'],
  ['Ctrl+L', '\x0c'],
] as const

export function TerminalKeyBar({ collapsed, onToggle, onSend, onPaste }: Props) {
  const button = (label: string, sequence: string) => (
    <button
      key={label}
      type="button"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSend(sequence)
      }}
      className="h-8 shrink-0 rounded-md bg-slate-800 px-3 font-mono text-[11px] text-slate-200 active:bg-sky-700"
      style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
    >
      {label}
    </button>
  )

  return (
    <div
      className="shrink-0 border-t border-slate-700/40 bg-slate-900/95 px-1.5 py-1 md:hidden"
      style={{ touchAction: 'manipulation', userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      <div className="flex items-center gap-1 overflow-x-auto">
        <button
          type="button"
          aria-label={collapsed ? '展开更多终端按键' : '收起更多终端按键'}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onToggle()
          }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-700 text-slate-300 active:bg-sky-700"
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {PRIMARY_KEYS.map(([label, sequence]) => button(label, sequence))}
        <button
          type="button"
          aria-label="粘贴到终端"
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onPaste()
          }}
          className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-slate-800 px-3 text-[11px] text-slate-200 active:bg-sky-700"
        >
          <ClipboardPaste size={13} />
          粘贴
        </button>
        {!collapsed && MORE_KEYS.map(([label, sequence]) => button(label, sequence))}
      </div>
    </div>
  )
}

export default TerminalKeyBar
