import { useState, useRef, useEffect } from 'react'
import {
  Terminal,
  FileCode2,
  Puzzle,
  Settings,
  Activity,
  Zap,
  Container,
  ScrollText,
  History,
  KeyRound,
  Bell,
  MoreHorizontal,
  X,
  Brain,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useAiStore } from '../../stores/ai-store'
import type { NavId } from '../../stores/types'

/** 固定显示在底部的 5 个核心菜单 */
const coreNavItems = [
  { id: 'ssh', label: 'SSH', icon: Terminal },
  { id: 'commands', label: '命令', icon: Zap },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'monitor', label: '监控', icon: Activity },
  { id: 'files', label: '文件', icon: FileCode2 },
] as const

/** 展开面板中的其余菜单 */
const moreNavItems = [
  { id: 'logs', label: '日志聚合', icon: ScrollText },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'vault', label: '凭据保险箱', icon: KeyRound },
  { id: 'notifications', label: '通知渠道', icon: Bell },
  { id: 'audit', label: '审计日志', icon: History },
  { id: 'settings', label: '系统设置', icon: Settings },
] as const

export default function BottomNav() {
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const sshSessions = useAppStore((s) => s.sshSessions)
  const sshSftpOpen = useAppStore((s) => s.sshSftpOpen)
  const agentOpen = useAppStore((s) => s.agentOpen)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)
  const aiEnabled = useAiStore((s) => s.config.enabled)

  const [moreOpen, setMoreOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const isSshPage = activeNav === 'ssh'
  const hasActiveSession = sshSessions.length > 0
  const isHidden = isSshPage && hasActiveSession && !sshSftpOpen

  // 当前是否在"更多"面板中的某个页面
  const isMoreActive = moreNavItems.some((item) => item.id === activeNav)

  // 点击面板外部关闭（排除底栏和面板内部）
  useEffect(() => {
    if (!moreOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current && panelRef.current.contains(target)) return
      // 底栏按钮点击由各自的 onClick 处理，这里不排除
      // 只在点击完全在 nav 外部时关闭
      const nav = (e.target as HTMLElement).closest?.('nav')
      if (!nav) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [moreOpen])

  // ESC 关闭
  useEffect(() => {
    if (!moreOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [moreOpen])

  const handleNavClick = (id: string) => {
    setActiveNav(id as NavId)
    setMoreOpen(false)
  }

  if (isHidden) return null

  return (
    <nav
      className="relative z-20 border-t border-slate-700/50 bg-slate-900 lg:hidden"
      style={{ minHeight: '48px' }}
    >
      {/* ── 更多面板（向上展开） ── */}
      {moreOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 bottom-full left-0 border-t border-slate-700/50 bg-slate-900 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[11px] font-medium text-slate-400">更多功能</span>
            <button
              onClick={() => setMoreOpen(false)}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 px-3 pb-3">
            {moreNavItems.map((item) => {
              const Icon = item.icon
              const isActive = activeNav === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.id)}
                  className={`flex flex-col items-center gap-1 rounded-xl py-3 transition-colors ${
                    isActive
                      ? 'bg-wrench-500/15 text-wrench-400'
                      : 'text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-[10px]">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 底栏 ── */}
      <div
        className={`grid ${aiEnabled ? 'grid-cols-7' : 'grid-cols-6'}`}
        style={{ minHeight: '48px' }}
      >
        {coreNavItems.map((item) => {
          const Icon = item.icon
          const isActive = activeNav === item.id
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className="flex touch-manipulation flex-col items-center justify-center gap-0.5 transition-colors"
              style={{ minHeight: '48px' }}
            >
              <div className="relative">
                <Icon size={20} className={isActive ? 'text-wrench-400' : 'text-slate-500'} />
                {item.id === 'ssh' && sshSessions.length > 0 && (
                  <span className="bg-wrench-500 absolute -top-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-bold text-white">
                    {sshSessions.length}
                  </span>
                )}
              </div>
              <span
                className={isActive ? 'text-wrench-400 font-medium' : 'text-slate-500'}
                style={{ fontSize: '9px', lineHeight: '1' }}
              >
                {item.label}
              </span>
            </button>
          )
        })}

        {/* ── AI Agent 按钮（移动端） ── */}
        {aiEnabled && (
          <button
            onClick={() => setAgentOpen(!agentOpen)}
            className={`flex touch-manipulation flex-col items-center justify-center gap-0.5 transition-colors ${
              agentOpen ? 'text-wrench-400' : 'text-slate-500'
            }`}
            style={{ minHeight: '48px' }}
          >
            <Brain size={20} />
            <span
              className={agentOpen ? 'text-wrench-400 font-medium' : ''}
              style={{ fontSize: '9px', lineHeight: '1' }}
            >
              AI
            </span>
          </button>
        )}

        {/* ── 更多按钮 ── */}
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className={`flex touch-manipulation flex-col items-center justify-center gap-0.5 transition-colors ${
            isMoreActive ? 'text-wrench-400' : moreOpen ? 'text-slate-300' : 'text-slate-500'
          }`}
          style={{ minHeight: '48px' }}
        >
          <div className="relative">
            <MoreHorizontal size={20} />
            {isMoreActive && (
              <span className="bg-wrench-400 absolute -top-1 -right-1 h-2 w-2 rounded-full" />
            )}
          </div>
          <span
            className={isMoreActive ? 'font-medium' : ''}
            style={{ fontSize: '9px', lineHeight: '1' }}
          >
            更多
          </span>
        </button>
      </div>
    </nav>
  )
}
