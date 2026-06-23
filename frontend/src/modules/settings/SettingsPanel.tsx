import { Settings, Moon, Sun, Monitor, Key, Globe } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'

export default function SettingsPanel() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const themeOptions = [
    { value: 'dark' as const, label: '深色', icon: Moon },
    { value: 'light' as const, label: '浅色', icon: Sun },
    { value: 'system' as const, label: '跟随系统', icon: Monitor },
  ]

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-6 flex items-center gap-2">
        <Settings size={20} className="text-slate-400" />
        <h2 className="text-lg font-semibold text-slate-200">设置</h2>
      </div>

      <div className="space-y-6">
        {/* 外观 */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
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
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    theme === opt.value
                      ? 'border-smartbox-500 bg-smartbox-500/10 text-smartbox-400'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
                  }`}
                >
                  <Icon size={16} />
                  {opt.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* AI 配置 */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Key size={14} />
            AI 配置
          </h3>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-xs text-slate-500">API Key</label>
              <input
                type="password"
                className="input"
                placeholder="输入 OpenRouter API Key..."
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">模型</label>
              <select className="input">
                <option>meta-llama/llama-3.1-8b-instruct:free</option>
                <option>openai/gpt-4o-mini</option>
                <option>anthropic/claude-3-haiku</option>
              </select>
            </div>
          </div>
        </section>

        {/* 关于 */}
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Globe size={14} />
            关于
          </h3>
          <p className="text-xs text-slate-500">
            SmartBox v0.1.0 · 可插拔 AI 增强工具箱
          </p>
        </section>
      </div>
    </div>
  )
}
