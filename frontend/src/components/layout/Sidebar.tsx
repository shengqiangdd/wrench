import {
  Terminal,
  FileCode2,
  Puzzle,
  Settings,
  Server,
  Container,
  ScrollText,
  Zap,
  Activity,
  PanelRight,
  PanelLeftClose,
  KeyRound,
  Bell,
  History,
  Brain,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useAiStore } from '../../stores/ai-store'
import { NetworkQualityIndicator } from '../NetworkQualityIndicator'

const navItems = [
  { id: 'ssh', label: 'SSH 连接', icon: Terminal },
  { id: 'commands', label: '常用命令', icon: Zap },
  { id: 'docker', label: 'Docker 管理', icon: Container },
  { id: 'monitor', label: '性能看板', icon: Activity },
  { id: 'files', label: '文件管理', icon: FileCode2 },
  { id: 'logs', label: '日志聚合', icon: ScrollText },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'vault', label: '凭据保险箱', icon: KeyRound },
  { id: 'notifications', label: '通知渠道', icon: Bell },
  { id: 'audit', label: '审计日志', icon: History },
  { id: 'settings', label: '设置', icon: Settings },
] as const

export default function Sidebar() {
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const sshSessions = useAppStore((s) => s.sshSessions)
  const agentOpen = useAppStore((s) => s.agentOpen)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)
  const aiEnabled = useAiStore((s) => s.config.enabled)

  if (sidebarCollapsed) {
    return (
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-slate-700/50 bg-slate-900/50 py-3">
        <button
          onClick={toggleSidebar}
          className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          title="展开侧边栏"
        >
          <PanelRight size={16} />
        </button>
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                activeNav === item.id
                  ? 'text-wrench-400 bg-slate-800'
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
        <Server size={20} className="text-wrench-400" />
        <span className="flex-1 text-sm font-semibold text-slate-200">棘轮工具箱 Wrench</span>
        <button
          onClick={toggleSidebar}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          title="收起侧边栏"
        >
          <PanelLeftClose size={14} />
        </button>
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
              <span className="bg-wrench-600/20 text-wrench-400 ml-auto rounded-full px-1.5 py-0.5 text-xs">
                {sshSessions.length}
              </span>
            )}
          </button>
        )
      })}

      <div className="mt-auto border-t border-slate-700/50 pt-3">
        {/* AI Agent 入口（桌面端） */}
        {aiEnabled && (
          <button
            onClick={() => setAgentOpen(!agentOpen)}
            className={`sidebar-item mb-2 ${agentOpen ? 'active' : ''}`}
          >
            <Brain size={16} />
            <span>AI Agent</span>
            <span className="ml-auto text-[10px] text-slate-600">⌘⇧A</span>
          </button>
        )}

        {/* 网络质量指示器 */}
        <div className="mb-2 px-1">
          <NetworkQualityIndicator />
        </div>

        <div className="flex items-center gap-2 px-2 text-xs text-slate-500">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          v0.3.0
        </div>
      </div>
    </nav>
  )
}
