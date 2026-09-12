/**
 * AccountSection.tsx — 账户与登录状态
 *
 * 展示当前会话的有效期，并提供「退出登录」。退出会清除本地令牌、
 * 断开 WebSocket；服务端令牌由口令轮换（WRENCH_AUTH_PASSWORD）或
 * JWT_SECRET 变更使其失效。
 */

import { useState } from 'react'
import { LogOut, ShieldCheck, ShieldAlert } from 'lucide-react'

import { getSession, logout } from '../../services/auth'

export default function AccountSection() {
  const session = getSession()
  const [confirming, setConfirming] = useState(false)

  const expiryText = session?.exp
    ? new Date(session.exp).toLocaleString('zh-CN', { hour12: false })
    : '未知'

  const handleLogout = async () => {
    setConfirming(false)
    const { getWsClientSync } = await import('../../services/websocket')
    try {
      getWsClientSync().disconnect()
    } catch (err) {
      console.warn('[Account] failed to disconnect WS before logout:', err)
    }
    logout()
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <ShieldCheck size={14} />
        登录与安全
      </h3>

      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
          <ShieldAlert size={14} className="text-emerald-500" />
          <span>已登录（服务端校验）</span>
        </div>
        <p className="mb-4 text-[11px] text-slate-500">
          当前会话有效期至 <span className="text-slate-300">{expiryText}</span>。
          令牌由服务端口令签发；修改服务端{' '}
          <code className="text-slate-400">WRENCH_AUTH_PASSWORD</code>
          后所有已签发令牌立即失效。
        </p>

        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleLogout()}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              确认退出
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
            >
              取消
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
          >
            <LogOut size={14} />
            退出登录
          </button>
        )}
      </div>
    </section>
  )
}
