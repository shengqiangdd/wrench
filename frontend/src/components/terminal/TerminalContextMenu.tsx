import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface TerminalMenuItem {
  id: string
  label: string
  icon?: LucideIcon
  /** 右侧快捷键提示（纯展示） */
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  /** 该项上方画一条分隔线 */
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  items: TerminalMenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 208
const MENU_ITEM_HEIGHT = 34

/**
 * 终端上下文菜单 —— **桌面右键与移动端长按共用**。
 *
 * 之前只有移动端长按有菜单（而且只有"全选复制 / 选择并复制"两项），
 * 桌面端右键被 `preventDefault` 掉之后**什么都没发生** —— 这是网页终端里最容易被
 * 用户判定为"半成品"的空洞。这里统一成一个菜单，条目由各终端按自己的能力提供。
 *
 * 定位：先渲染再测量，贴边时向内收（菜单不会被视口切掉）。
 */
export function TerminalContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, ready: false })

  useLayoutEffect(() => {
    const el = menuRef.current
    const width = el?.offsetWidth || MENU_WIDTH
    const height = el?.offsetHeight || items.length * MENU_ITEM_HEIGHT
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    setPos({ left, top, ready: true })
  }, [x, y, items.length])

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

  return (
    <>
      {/* 透明遮罩：任意位置按下即关闭 */}
      <div
        className="fixed inset-0 z-40"
        onPointerDown={(e) => {
          e.preventDefault()
          onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        data-testid="terminal-context-menu"
        className="fixed z-50 overflow-hidden rounded-xl border border-slate-600/50 bg-slate-800/95 shadow-2xl backdrop-blur-md"
        style={{
          left: pos.left,
          top: pos.top,
          minWidth: MENU_WIDTH - 48,
          visibility: pos.ready ? 'visible' : 'hidden',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.id}>
              {item.separatorBefore && <div className="border-t border-slate-700/50" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (item.disabled) return
                  onClose()
                  item.onSelect()
                }}
                className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors ${
                  item.disabled
                    ? 'cursor-not-allowed text-slate-600'
                    : 'text-slate-200 hover:bg-slate-700 active:bg-slate-700'
                }`}
              >
                {Icon && <Icon size={14} className="shrink-0 text-slate-400" />}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut && (
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">
                    {item.shortcut}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default TerminalContextMenu
