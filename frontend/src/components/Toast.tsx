/**
 * Toast.tsx
 *
 * 全局通知组件，监听 smartbox-notification 自定义事件，
 * 以浮动 Toast 形式展示通知信息。
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle, XCircle, Info, X } from 'lucide-react'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  exiting: boolean
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const idRef = useRef(0)

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 300)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message: string; type: 'success' | 'error' | 'info' }
      if (!detail?.message) return
      const id = ++idRef.current
      setToasts((prev) => [...prev, { id, message: detail.message, type: detail.type || 'info', exiting: false }])
      // 自动消失
      setTimeout(() => removeToast(id), 3500)
    }

    window.addEventListener('smartbox-notification', handler)
    return () => window.removeEventListener('smartbox-notification', handler)
  }, [removeToast])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle size={16} className="text-emerald-400" />,
          error: <XCircle size={16} className="text-red-400" />,
          info: <Info size={16} className="text-sky-400" />,
        }
        const borders = {
          success: 'border-emerald-500/30',
          error: 'border-red-500/30',
          info: 'border-sky-500/30',
        }

        return (
          <div
            key={toast.id}
            className={`flex items-start gap-2.5 rounded-lg border ${borders[toast.type]} bg-slate-800/95 px-3.5 py-2.5 shadow-lg backdrop-blur-sm transition-all duration-300 ${
              toast.exiting ? 'translate-x-4 opacity-0' : 'translate-x-0 opacity-100'
            }`}
            style={{ minWidth: 200, maxWidth: 360 }}
          >
            <span className="mt-0.5 shrink-0">{icons[toast.type]}</span>
            <p className="text-xs text-slate-300 leading-relaxed">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-1 shrink-0 text-slate-600 hover:text-slate-400"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
