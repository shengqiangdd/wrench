/**
 * AgentDrawer.tsx
 *
 * 全局 AI Agent 抽屉容器 — 右侧滑出面板，任何页面可呼出。
 *
 * - 快捷键 ⌘+Shift+A / Ctrl+Shift+A 开关
 * - 平滑滑入/滑出动画
 * - 点击遮罩层关闭
 * - 自动注入当前上下文
 */

import { useEffect, useCallback, type ReactNode, isValidElement, cloneElement } from 'react'
import { PanelRightOpen } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import type { AiSessionContext } from '../../stores/ai-store'

interface Props {
  children: ReactNode
  /** 上下文来源 */
  context?: AiSessionContext
  /** 命令执行回调 */
  onExecuteCommand?: (cmd: string) => void
}

export default function AgentDrawer({ children, context: _context, onExecuteCommand }: Props) {
  const agentOpen = useAppStore((s) => s.agentOpen)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)

  // ─── 快捷键监听 ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘+Shift+A (Mac) / Ctrl+Shift+A (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const current = useAppStore.getState().agentOpen
        setAgentOpen(!current)
      }
      // Escape 关闭
      if (e.key === 'Escape' && useAppStore.getState().agentOpen) {
        e.preventDefault()
        setAgentOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setAgentOpen])

  const handleClose = useCallback(() => {
    setAgentOpen(false)
  }, [setAgentOpen])

  return (
    <>
      {/* ── Agent 触发按钮（仅桌面端可见，移动端通过底部导航栏触发） ── */}
      {!agentOpen && (
        <button
          onClick={() => setAgentOpen(true)}
          className="bg-wrench-600 shadow-wrench-600/20 hover:bg-wrench-500 fixed right-4 bottom-6 z-40 hidden h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-all hover:scale-105 lg:flex"
          title="AI Agent (⌘+Shift+A)"
        >
          <PanelRightOpen size={18} />
        </button>
      )}

      {/* ── 遮罩层 ── */}
      {agentOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 transition-opacity" onClick={handleClose} />
      )}

      {/* ── 抽屉面板 ── */}
      <div
        className={`fixed top-0 right-0 z-50 flex h-full flex-col border-l border-slate-700/50 bg-slate-900 shadow-2xl transition-transform duration-300 ease-in-out ${
          agentOpen ? 'translate-x-0' : 'translate-x-full'
        } w-[85vw] max-w-[380px] sm:w-[420px]`}
        style={{ width: undefined }}
      >
        {/* 内容区 */}
        <div className="min-h-0 flex-1">
          {isValidElement(children)
            ? cloneElement(
                children as React.ReactElement<{ onExecuteCommand?: (cmd: string) => void }>,
                {
                  onExecuteCommand,
                },
              )
            : children}
        </div>
      </div>
    </>
  )
}
