import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ClipboardPaste, X } from 'lucide-react'
import {
  analyzePaste,
  describeClipboardFailure,
  formatPasteStats,
  previewPaste,
  type ClipboardFailureReason,
  type PasteStats,
} from '../../utils/terminal-paste'

interface Props {
  /** reader：读不到剪贴板，请用户把内容贴进来；confirm：内容已拿到，问要不要真的发 */
  mode: 'reader' | 'confirm'
  /** confirm 模式下要确认的文本 */
  text?: string
  /** reader 模式下读剪贴板失败的原因 */
  reason?: ClipboardFailureReason
  /** reader 模式下实时统计用的初始值 */
  onSubmit: (text: string) => void
  onClose: () => void
}

const PREVIEW_LINES = 12

/**
 * 粘贴框 / 粘贴确认框（batch 2b ①）。
 *
 * 一个组件两种模式，因为两者的**用户动作是一样的**（看清内容 → 发送到终端）：
 * - `reader`：HTTP 部署下浏览器不给读剪贴板，这里给一个真实 textarea —— 在它里面
 *   Ctrl/⌘+V / 长按粘贴是浏览器原生行为，不受安全上下文限制；同时也解决了移动端
 *   没有 Ctrl+V 的问题。边贴边显示「几行 / 几条会立即执行」。
 * - `confirm`：剪贴板拿到了但是多行、且远端没开 bracketed paste（每个换行都是一次执行），
 *   先把内容摆出来让人过一眼，比默默逐行执行安全。
 */
export function TerminalPasteDialog({ mode, text, reason, onSubmit, onClose }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // reader 模式：一打开就聚焦，用户可以直接 Ctrl+V
  useEffect(() => {
    if (mode === 'reader') textareaRef.current?.focus()
  }, [mode])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stats: PasteStats = useMemo(
    () => (mode === 'reader' ? analyzePaste(value) : analyzePaste(text ?? '')),
    [mode, text, value],
  )
  const preview = useMemo(
    () => (mode === 'confirm' ? previewPaste(text ?? '', PREVIEW_LINES) : null),
    [mode, text],
  )
  const canSubmit = mode === 'confirm' || value.trim() !== ''

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-lg rounded-lg border border-slate-700/50 bg-slate-900 p-4 shadow-2xl"
        data-testid="terminal-paste-dialog"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <ClipboardPaste className="h-4 w-4 text-slate-400" />
            {mode === 'reader' ? '粘贴到终端' : '确认粘贴'}
          </h3>
          <button
            onClick={onClose}
            aria-label="关闭"
            data-testid="paste-dialog-close"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-400" data-testid="paste-dialog-note">
          {mode === 'reader'
            ? describeClipboardFailure(reason ?? 'unsupported')
            : '这段内容是多行，发送后每个换行都会被执行。确认内容没问题再发送。'}
        </p>

        {mode === 'reader' ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-testid="paste-dialog-textarea"
            placeholder="在这里粘贴…"
            spellCheck={false}
            rows={6}
            className="focus:border-wrench-500 mt-3 w-full resize-y rounded-md border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-200 outline-none"
          />
        ) : (
          <pre
            data-testid="paste-dialog-preview"
            className="mt-3 max-h-48 overflow-auto rounded-md border border-slate-700 bg-slate-950 p-2 font-mono text-xs whitespace-pre-wrap text-slate-300"
          >
            {preview?.text}
            {preview?.truncated ? `\n… （共 ${stats.lines} 行）` : ''}
          </pre>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span data-testid="paste-dialog-stats">{formatPasteStats(stats)}</span>
          {stats.dangers.length > 0 && (
            <span
              data-testid="paste-dialog-danger"
              className="flex items-center gap-1 text-amber-400"
            >
              <AlertTriangle className="h-3 w-3" />含 {stats.dangers.join(' / ')} —— 请确认
            </span>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="paste-dialog-cancel"
            className="rounded-md border border-slate-600/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-300"
          >
            取消
          </button>
          <button
            onClick={() => onSubmit(mode === 'reader' ? value : (text ?? ''))}
            disabled={!canSubmit}
            data-testid="paste-dialog-send"
            className="bg-wrench-600 hover:bg-wrench-500 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            发送到终端
          </button>
        </div>

        {mode === 'reader' && (
          <p className="mt-2 text-[11px] text-slate-600">
            发送进终端后仍可编辑；多行内容会按你看到的换行逐行执行。
          </p>
        )}
      </div>
    </div>
  )
}
