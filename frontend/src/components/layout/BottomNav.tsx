import { Terminal, FileCode2, Puzzle, Settings, Activity, Zap, Container, ScrollText } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useSshStore } from '../../stores/ssh-store'

const navItems = [
  { id: 'ssh', label: 'SSH', icon: Terminal },
  { id: 'commands', label: '命令', icon: Zap },
  { id: 'docker', label: 'Docker', icon: Container },
  { id: 'monitor', label: '监控', icon: Activity },
  { id: 'files', label: '文件', icon: FileCode2 },
  { id: 'logs', label: '日志', icon: ScrollText },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'settings', label: '设置', icon: Settings },
] as const

export default function BottomNav() {
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const sshSessions = useAppStore((s) => s.sshSessions)

  // 仅在 SSH 页面有已连接 session 且正在查看终端时才隐藏导航
  const isSshPage = activeNav === 'ssh'
  const hasActiveSession = sshSessions.length > 0
  const sshSftpOpen = useAppStore((s) => s.sshSftpOpen)
  const hideNav = isSshPage && hasActiveSession && !sshSftpOpen

  return (
    <nav
      className={`flex items-center justify-evenly border-t border-slate-700/50 bg-slate-900 px-1 md:hidden no-scrollbar transition-all duration-200 ${
        hideNav ? 'h-0 overflow-hidden border-t-0 py-0' : 'h-auto pb-safe pt-0.5 sm:h-12'
      }`}
    >
      {!hideNav && navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className={`flex shrink-0 flex-col items-center gap-0.5 px-2 py-1.5 text-[10px] transition-colors sm:flex-row sm:gap-1 sm:px-3 sm:py-1 ${
              activeNav === item.id
                ? 'text-smartbox-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={18} />
            <span className="sm:text-xs">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
