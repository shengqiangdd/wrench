import { Terminal, FileCode2, Puzzle, Settings } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

const navItems = [
  { id: 'ssh', label: 'SSH', icon: Terminal },
  { id: 'files', label: '文件', icon: FileCode2 },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'settings', label: '设置', icon: Settings },
] as const

export default function BottomNav() {
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)

  return (
    <nav className="flex items-center justify-around border-t border-slate-700/50 bg-slate-900 px-2 py-1 md:hidden">
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-2 text-xs transition-colors ${
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
