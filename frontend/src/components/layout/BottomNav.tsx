import { Terminal, FileCode2, Puzzle, Settings, Activity, Zap, Container, ScrollText } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

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

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-700/50 bg-slate-900 px-2 pb-safe pt-1 md:hidden no-scrollbar">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className={`flex shrink-0 flex-col items-center gap-0.5 px-3 py-2 text-xs transition-colors ${
              activeNav === item.id
                ? 'text-smartbox-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
