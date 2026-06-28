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
  const sshSftpOpen = useAppStore((s) => s.sshSftpOpen)

  const isSshPage = activeNav === 'ssh'
  const hasActiveSession = sshSessions.length > 0
  // SSH 终端全屏时隐藏底部导航
  if (isSshPage && hasActiveSession && !sshSftpOpen) return null

  return (
    <nav className="relative z-10 flex items-center justify-evenly border-t border-slate-700/50 bg-slate-900 lg:hidden" style={{ minHeight: '48px' }}>
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[10px] transition-colors touch-manipulation"
            style={{ minWidth: '44px', minHeight: '44px' }}
          >
            <Icon size={20} className={activeNav === item.id ? 'text-smartbox-400' : 'text-slate-500'} />
            <span className={activeNav === item.id ? 'text-smartbox-400' : 'text-slate-500'} style={{ fontSize: '9px', lineHeight: '1' }}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
