import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, ClipboardPaste } from 'lucide-react'

interface Props {
  collapsed: boolean
  onToggle: () => void
  onSend: (sequence: string) => void
  onPaste: () => void
}

const PRIMARY_KEYS = [
  ['Tab', '\t'],
  ['Esc', '\x1b'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['Enter', String.fromCharCode(13)],
] as const

const MORE_KEYS = [
  ['C', 'c'],
  ['D', 'd'],
  ['L', 'l'],
  ['Home', '\x1b[H'],
  ['End', '\x1b[F'],
  ['PgUp', '\x1b[5~'],
  ['PgDn', '\x1b[6~'],
  ['Ctrl+L', '\x0c'],
] as const

type TerminalKeyModifier = 'ctrl' | 'alt'

/** Apply one-shot modifiers only to literal quick keys; escape sequences stay intact. */
// eslint-disable-next-line react-refresh/only-export-components
export function applyTerminalKeyModifiers(
  sequence: string,
  modifiers: Set<TerminalKeyModifier>,
): string {
  let result = sequence
  if (modifiers.has('ctrl') && /^[a-z]$/i.test(result)) {
    result = String.fromCharCode(result.toUpperCase().charCodeAt(0) & 0x1f)
  }
  if (modifiers.has('alt')) result = String.fromCharCode(27) + result
  return result
}

export function TerminalKeyBar({ collapsed, onToggle, onSend, onPaste }: Props) {
  const [modifiers, setModifiers] = useState<Set<TerminalKeyModifier>>(() => new Set())
  const repeatDelayRef = useRef<number | null>(null)
  const repeatIntervalRef = useRef<number | null>(null)

  const stopRepeat = () => {
    if (repeatDelayRef.current !== null) window.clearTimeout(repeatDelayRef.current)
    if (repeatIntervalRef.current !== null) window.clearInterval(repeatIntervalRef.current)
    repeatDelayRef.current = null
    repeatIntervalRef.current = null
  }

  useEffect(() => stopRepeat, [])

  const sendKey = (sequence: string) => {
    onSend(applyTerminalKeyModifiers(sequence, modifiers))
    if (modifiers.size) setModifiers(new Set())
  }

  const startRepeat = (label: string, sequence: string) => {
    if (!/^[↑↓←→]$/.test(label)) return
    repeatDelayRef.current = window.setTimeout(() => {
      repeatIntervalRef.current = window.setInterval(() => sendKey(sequence), 70)
    }, 350)
  }

  const toggleModifier = (modifier: TerminalKeyModifier) => {
    setModifiers((current) => {
      const next = new Set(current)
      if (next.has(modifier)) next.delete(modifier)
      else next.add(modifier)
      return next
    })
  }

  const button = (label: string, sequence: string) => (
    <button
      key={label}
      type="button"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        sendKey(sequence)
        startRepeat(label, sequence)
      }}
      className="h-8 shrink-0 rounded-md bg-slate-800 px-3 font-mono text-[11px] text-slate-200 active:bg-sky-700"
      onPointerUp={stopRepeat}
      onPointerLeave={stopRepeat}
      onPointerCancel={stopRepeat}
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
        {(['ctrl', 'alt'] as const).map((modifier) => (
          <button
            key={modifier}
            type="button"
            aria-pressed={modifiers.has(modifier)}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              toggleModifier(modifier)
            }}
            className={
              modifiers.has(modifier)
                ? 'h-8 shrink-0 rounded-md bg-sky-700 px-2.5 font-mono text-[11px] text-white active:bg-sky-700'
                : 'h-8 shrink-0 rounded-md bg-slate-800 px-2.5 font-mono text-[11px] text-slate-200 active:bg-sky-700'
            }
          >
            {modifier === 'ctrl' ? 'Ctrl' : 'Alt'}
          </button>
        ))}
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
