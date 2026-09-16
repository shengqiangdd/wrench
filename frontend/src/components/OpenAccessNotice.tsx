import { useState } from 'react'
import { KeyRound, X } from 'lucide-react'

import { isAuthDisabled } from '../services/auth'

/** 提示条被手动关闭的标记（localStorage） */
const DISMISS_KEY = 'wrench_open_access_notice_dismissed'

/**
 * 开放访问提示条 —— 服务端关掉了入口口令（`WRENCH_REQUIRE_AUTH=off`）时显示。
 *
 * 这是**诚实的风险提示**，不是装饰：没有口令门时，任何能访问本地址的人都能把这里
 * 当作 SSH 客户端使用（能连到哪些机器由服务端出口白名单决定；别人的空间数据看不到，
 * 隔离是 SQL 层强制带 `space_id`）。
 *
 * 提示条可关闭（状态记在 localStorage），不占地方、不挡操作。
 */
export function OpenAccessNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  if (hidden || !isAuthDisabled()) return null

  return (
    <div
      data-testid="open-access-notice"
      className="flex shrink-0 items-center justify-center gap-2 bg-amber-600/15 px-3 py-1 text-xs text-amber-400"
    >
      <KeyRound size={12} />
      <span>
        本实例未设入口口令 — 任何能访问此地址的人都能使用它（能连的机器由服务端出口白名单决定）
      </span>
      <button
        data-testid="open-access-notice-close"
        aria-label="关闭提示"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem(DISMISS_KEY, '1')
          } catch {
            /* 隐私模式下写不进去：本次会话内隐藏即可 */
          }
        }}
        className="rounded p-0.5 hover:bg-amber-500/20"
      >
        <X size={12} />
      </button>
    </div>
  )
}

export default OpenAccessNotice
