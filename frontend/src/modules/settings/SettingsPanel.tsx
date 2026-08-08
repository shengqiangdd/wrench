import { useMemo } from 'react'
import { Settings, Moon, Sun, Monitor, Server } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import SystemMaintenance from './SystemMaintenance'
import AiSettings from './AiSettings'
import ImportExport from './ImportExport'

export default function SettingsPanel() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const themeOptions = useMemo(
    () => [
      { value: 'dark' as const, label: '深色', icon: Moon },
      { value: 'light' as const, label: '浅色', icon: Sun },
      { value: 'system' as const, label: '跟随系统', icon: Monitor },
    ],
    [],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-700/50 px-4 py-3 sm:px-6 sm:py-4">
        <Settings size={20} className="text-wrench-400" />
        <h1 className="text-base font-semibold text-slate-200 sm:text-lg">设置</h1>
      </div>

      {/* Content */}
      <div className="pb-nav flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-2xl space-y-8">
          {/* ─── 外观 ─── */}
          <section>
            <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
              <Monitor size={14} />
              外观
            </h3>
            <div className="flex gap-2">
              {themeOptions.map((opt) => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors ${
                      theme === opt.value
                        ? 'border-wrench-500/50 bg-wrench-600/10 text-wrench-400'
                        : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                    }`}
                  >
                    <Icon size={16} />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ─── SSH 连接 ─── */}
          <section>
            <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
              <Server size={14} />
              SSH 连接管理
            </h3>
            <p className="mb-3 text-[11px] text-slate-500">
              点击左侧导航栏「SSH」查看和管理所有 SSH 连接。
            </p>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
              <p className="text-xs text-slate-400">
                连接管理已迁移至独立页面，在左侧导航栏点击「SSH」即可访问。
                你可以在这里管理所有已保存的连接配置。
              </p>
            </div>
          </section>

          {/* ─── AI Agent ─── */}
          <AiSettings />

          {/* ─── 数据管理 ─── */}
          <ImportExport />

          {/* ─── 系统维护 ─── */}
          <SystemMaintenance />
        </div>
      </div>
    </div>
  )
}
