import { useCallback, useState } from 'react'
import type { Terminal } from '@xterm/xterm'
import { readClipboardText } from '../utils/clipboard'
import {
  decidePaste,
  decidePasteText,
  pasteSentHint,
  type ClipboardFailureReason,
  type PasteDecision,
} from '../utils/terminal-paste'

export interface PasteDialogState {
  mode: 'reader' | 'confirm'
  /** confirm 模式下要确认的文本 */
  text?: string
  /** reader 模式下读剪贴板失败的原因 */
  reason?: ClipboardFailureReason
}

interface Options {
  getTerm: () => Terminal | null
  showHint: (message: string) => void
  /** 终端实例尚未就绪时的兜底发送（各终端自己的 WS 通道） */
  fallbackSend: (text: string) => void
  /** 无内容可粘贴时的提示语（各终端语气不同） */
  emptyHint?: string
}

/**
 * 粘贴这条链的**唯一入口** —— SSH 终端与容器终端共用（batch 2b ①）。
 *
 * 三条路各归其位：
 * 1. 能读剪贴板（HTTPS / localhost）→ 直接判定：单行直接发，多行且远端没开
 *    bracketed paste 时先确认；
 * 2. 读不到（HTTP 部署、权限被拒）→ **不提示"请用 Ctrl+V"了事**，直接开粘贴框；
 * 3. 粘贴框/确认框里的内容 → 由用户自己看过统计，发送不再二次追问。
 *
 * 发送统一走 `term.paste()`：它会把 `\n` 转成 `\r`，并在远端开了 bracketed paste 时
 * 自动包上 `ESC[200~ … ESC[201~`，之后照各终端原有的 `onData → WS` 通道出去（与手打同一条路）。
 */
export function useTerminalPaste({ getTerm, showHint, fallbackSend, emptyHint }: Options) {
  const [dialog, setDialog] = useState<PasteDialogState | null>(null)

  const bracketedPaste = useCallback(() => !!getTerm()?.modes.bracketedPasteMode, [getTerm])

  const send = useCallback(
    (text: string) => {
      const term = getTerm()
      if (term) {
        term.paste(text)
        return
      }
      fallbackSend(text)
    },
    [fallbackSend, getTerm],
  )

  const empty = useCallback(() => {
    showHint(emptyHint ?? '剪贴板里没有可粘贴的文本')
  }, [emptyHint, showHint])

  /** 判定结果的统一落地（决定是发、是问、还是开粘贴框） */
  const route = useCallback(
    (decision: PasteDecision, opts?: { alreadyConfirmed?: boolean }) => {
      switch (decision.kind) {
        case 'empty':
          empty()
          return
        case 'reader':
          setDialog({ mode: 'reader', reason: decision.reason })
          return
        case 'confirm':
          if (opts?.alreadyConfirmed) {
            send(decision.text)
            showHint(pasteSentHint(decision.text, false))
            return
          }
          setDialog({ mode: 'confirm', text: decision.text })
          return
        case 'send':
          send(decision.text)
          showHint(decision.hint)
      }
    },
    [empty, send, showHint],
  )

  /** 入口一：读剪贴板（右键菜单「粘贴」/ 快捷键 / 移动端长按菜单） */
  const pasteFromClipboard = useCallback(async () => {
    const read = await readClipboardText()
    route(decidePaste(read, { bracketed: bracketedPaste() }))
  }, [bracketedPaste, route])

  /** 入口二：已经拿到文本（粘贴框 / 确认框）—— 用户看过统计，不再二次确认 */
  const submitText = useCallback(
    (text: string, opts?: { alreadyConfirmed?: boolean }) => {
      route(decidePasteText(text, { bracketed: bracketedPaste() }), opts)
    },
    [bracketedPaste, route],
  )

  const closeDialog = useCallback(() => setDialog(null), [])

  /** 粘贴框 / 确认框点「发送到终端」 */
  const submitDialog = useCallback(
    (text: string) => {
      setDialog(null)
      submitText(text, { alreadyConfirmed: true })
    },
    [submitText],
  )

  return { pasteFromClipboard, dialog, submitDialog, closeDialog }
}
