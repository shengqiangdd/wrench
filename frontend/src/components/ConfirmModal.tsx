import { useEffect, useReducer, useRef } from 'react'

type OverlayState = 'hidden' | 'visible' | 'closing'

function overlayReducer(_state: OverlayState, action: OverlayState): OverlayState {
  return action
}

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [overlayState, dispatch] = useReducer(overlayReducer, 'hidden' as OverlayState)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (open) {
      wasOpenRef.current = true
      dispatch('visible')
      return
    }
    if (!wasOpenRef.current) return
    dispatch('closing')
    timerRef.current = setTimeout(() => dispatch('hidden'), 200)
    return () => clearTimeout(timerRef.current)
  }, [open])

  if (overlayState === 'hidden' && !open) return null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      {/* 弹窗 */}
      <div
        className={`relative z-10 w-full max-w-sm rounded-lg border border-slate-700/50 bg-slate-900 p-5 shadow-2xl transition-transform duration-200 ${
          open ? 'scale-100' : 'scale-95'
        }`}
      >
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md border border-slate-600/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-300"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-smartbox-600 hover:bg-smartbox-500'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 简易提示弹窗（无确认/取消，纯展示） */
interface AlertModalProps {
  open: boolean
  title: string
  message: string
  onClose: () => void
}

export function AlertModal({ open, title, message, onClose }: AlertModalProps) {
  const [overlayState, dispatch] = useReducer(overlayReducer, 'hidden' as OverlayState)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (open) {
      wasOpenRef.current = true
      dispatch('visible')
      return
    }
    if (!wasOpenRef.current) return
    dispatch('closing')
    timerRef.current = setTimeout(() => dispatch('hidden'), 200)
    return () => clearTimeout(timerRef.current)
  }, [open])

  if (overlayState === 'hidden' && !open) return null

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-200 ${
        open ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className={`relative z-10 w-full max-w-sm rounded-lg border border-slate-700/50 bg-slate-900 p-5 shadow-2xl transition-transform duration-200 ${
          open ? 'scale-100' : 'scale-95'
        }`}
      >
        <h3 className="text-sm font-medium text-slate-200">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{message}</p>
        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="bg-smartbox-600 hover:bg-smartbox-500 rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
