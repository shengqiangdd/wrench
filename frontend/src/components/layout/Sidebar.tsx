import { Terminal, FileCode2, Puzzle, Settings, Server, Container } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

const navItems = [
  { id: 'ssh', label: 'SSH 连接', icon: Terminal },
  { id: 'docker', label: 'Docker 管理', icon: Container },
  { id: 'files', label: '文件管理', icon: FileCode2 },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'settings', label: '设置', icon: Settings },
] as const

export default function Sidebar() {
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const sshSessions = useAppStore((s) => s.sshSessions)

  if (sidebarCollapsed) {
    return (
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-slate-700/50 bg-slate-900/50 py-3">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                activeNav === item.id
                  ? 'bg-slate-800 text-smartbox-400'
                  : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
              }`}
              title={item.label}
            >
              <Icon size={20} />
            </button>
          )
        })}
      </nav>
    )
  }

  return (
    <nav className="flex w-56 flex-col gap-0.5 border-r border-slate-700/50 bg-slate-900/50 p-3">
      <div className="mb-4 flex items-center gap-2 px-2">
        <Server size={20} className="text-smartbox-400" />
        <span className="text-sm font-semibold text-slate-200">智盒 SmartBox</span>
      </div>

      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            onClick={() => setActiveNav(item.id)}
            className={`sidebar-item ${activeNav === item.id ? 'active' : ''}`}
          >
            <Icon size={16} />
            <span>{item.label}</span>
            {item.id === 'ssh' && sshSessions.length > 0 && (
              <span className="ml-auto rounded-full bg-smartbox-600/20 px-1.5 py-0.5 text-xs text-smartbox-400">
                {sshSessions.length}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto border-t border-slate-700/50 pt-3">
        <div className="flex items-center gap-2 px-2 text-xs text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          v0.1.0
        </div>
      </div>
    </nav>
  )
}
