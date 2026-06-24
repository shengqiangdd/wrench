import { useState } from 'react'
import {
  Settings,
  Moon,
  Sun,
  Monitor,
  Key,
  Globe,
  Brain,
  MessageSquare,
  ExternalLink,
  Check,
  ChevronDown,
  Server,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useAiStore } from '../../stores/ai-store'

// 预设模型列表，免费模型排前面
const FREE_MODELS = [
  { value: 'google/gemma-4-27b-it:free', label: 'Gemma 4 27B (免费)', provider: 'Google' },
  { value: 'meta-llama/llama-4-maverick:free', label: 'Llama 4 Maverick (免费)', provider: 'Meta' },
  { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 24B (免费)', provider: 'Mistral' },
  { value: 'qwen/qwen2.5-72b-instruct:free', label: 'Qwen 2.5 72B (免费)', provider: 'Alibaba' },
  { value: 'cohere/command-r7b-12-2024:free', label: 'Command R7B (免费)', provider: 'Cohere' },
  { value: 'deepseek/deepseek-chat:free', label: 'DeepSeek V3 (免费)', provider: 'DeepSeek' },
]

const PAID_MODELS = [
  { value: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI' },
  { value: 'openai/o3-mini', label: 'O3 Mini', provider: 'OpenAI' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { value: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', provider: 'Anthropic' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google' },
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google' },
  { value: 'deepseek/deepseek-chat', label: 'DeepSeek V3', provider: 'DeepSeek' },
  { value: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', provider: 'Meta' },
  { value: 'mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1', provider: 'Mistral' },
]

// OpenRouter 支持的 endpoint 列表
const API_ENDPOINTS = [
  { value: 'https://openrouter.ai/api/v1', label: 'OpenRouter (默认)' },
  { value: 'https://api.openai.com/v1', label: 'OpenAI' },
  { value: 'https://api.anthropic.com/v1', label: 'Anthropic' },
]

export default function SettingsPanel() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const aiConfig = useAiStore((s) => s.config)
  const setAiConfig = useAiStore((s) => s.setConfig)

  const [showApiKey, setShowApiKey] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  const themeOptions = [
    { value: 'dark' as const, label: '深色', icon: Moon },
    { value: 'light' as const, label: '浅色', icon: Sun },
    { value: 'system' as const, label: '跟随系统', icon: Monitor },
  ]

  const allModels = [...FREE_MODELS, { value: '---', label: '──────────', provider: '' }, ...PAID_MODELS]

  const selectedModelLabel = allModels.find(m => m.value === aiConfig.model)?.label
    || FREE_MODELS[0].label

  const handleSelectModel = (modelValue: string) => {
    if (modelValue === '---') return
    if (modelValue === '__custom__') {
      setShowCustomInput(true)
      setShowModelSelector(false)
      return
    }
    setAiConfig({ model: modelValue })
    setShowModelSelector(false)
    setShowCustomInput(false)
  }

  const handleSetCustomModel = () => {
    if (customModel.trim()) {
      setAiConfig({ model: customModel.trim() })
      setShowCustomInput(false)
      setCustomModel('')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center gap-2">
        <Settings size={20} className="text-slate-400" />
        <h2 className="text-lg font-semibold text-slate-200">设置</h2>
      </div>

      <div className="max-w-2xl space-y-8">
        {/* ─── 外观 ─── */}
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

        {/* ─── AI 配置 ─── */}
        <section>
          <h3 className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Brain size={14} />
            AI Agent 配置
          </h3>

          {/* API Endpoint */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Globe size={12} />
              API 端点
            </label>
            <select
              value={aiConfig.baseUrl}
              onChange={(e) => setAiConfig({ baseUrl: e.target.value })}
              className="input"
            >
              {API_ENDPOINTS.map((ep) => (
                <option key={ep.value} value={ep.value}>{ep.label}</option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Key size={12} />
              API Key
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 inline-flex items-center gap-0.5 text-smartbox-400 hover:text-smartbox-300"
              >
                获取 <ExternalLink size={10} />
              </a>
            </label>
            <div className="relative">
              <form onSubmit={(e) => e.preventDefault()}>
              <input
                type={showApiKey ? 'text' : 'password'}
                value={aiConfig.apiKey}
                onChange={(e) => setAiConfig({ apiKey: e.target.value })}
                className="input pr-20"
                placeholder="sk-or-v1-..."
                autoComplete="off"
              />
              </form>
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-300"
              >
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          {/* 模型选择 */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <MessageSquare size={12} />
              模型
              <span className="ml-1 text-[10px] text-emerald-500/70">免费模型已置顶</span>
            </label>

            {/* 自定义模型输入 */}
            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSetCustomModel() }}
                  className="input flex-1"
                  placeholder="输入模型名称，如 openai/gpt-4o"
                  autoFocus
                />
                <button onClick={handleSetCustomModel} className="btn-primary text-xs whitespace-nowrap">
                  <Check size={14} /> 确认
                </button>
                <button onClick={() => setShowCustomInput(false)} className="btn-ghost text-xs">
                  取消
                </button>
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  className="input flex items-center justify-between text-left"
                >
                  <span className="text-slate-200">{selectedModelLabel || aiConfig.model}</span>
                  <ChevronDown size={14} className="text-slate-500" />
                </button>

                {showModelSelector && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                      {/* 免费模型组 */}
                      <div className="border-b border-slate-700/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-emerald-400/70">
                        🆓 免费模型
                      </div>
                      {FREE_MODELS.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => handleSelectModel(model.value)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                            aiConfig.model === model.value ? 'bg-slate-700/50 text-smartbox-400' : 'text-slate-300'
                          }`}
                        >
                          <span className="flex-1">{model.label}</span>
                          {aiConfig.model === model.value && <Check size={12} className="shrink-0" />}
                        </button>
                      ))}

                      {/* 付费模型组 */}
                      <div className="border-b border-t border-slate-700/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                        💰 付费模型
                      </div>
                      {PAID_MODELS.map((model) => (
                        <button
                          key={model.value}
                          onClick={() => handleSelectModel(model.value)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                            aiConfig.model === model.value ? 'bg-slate-700/50 text-smartbox-400' : 'text-slate-300'
                          }`}
                        >
                          <span className="flex-1">{model.label}</span>
                          {aiConfig.model === model.value && <Check size={12} className="shrink-0" />}
                        </button>
                      ))}

                      {/* 自定义模型 */}
                      <button
                        onClick={() => handleSelectModel('__custom__')}
                        className="flex w-full items-center gap-2 border-t border-slate-700/50 px-3 py-2 text-xs text-slate-400 hover:bg-slate-700"
                      >
                        ✏️ 输入自定义模型...
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 启用 Agent */}
          <div className="mb-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={aiConfig.enabled}
                onChange={(e) => setAiConfig({ enabled: e.target.checked })}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-smartbox-500 focus:ring-smartbox-500"
              />
              <span className="text-xs text-slate-400">启用 AI Agent 功能</span>
            </label>
            <p className="mt-1 text-[11px] text-slate-600 pl-6">
              开启后可在 SSH 终端界面使用 AI 助手，通过自然语言控制服务器
            </p>
          </div>
        </section>

        {/* ─── SSH 连接 ─── */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Server size={14} />
            SSH 连接
          </h3>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
            <p className="text-xs text-slate-400">
              连接配置管理在 <span className="text-smartbox-400">SSH 连接</span> 页面中
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              支持密码和密钥认证，连接后可使用终端、文件管理和 AI Agent
            </p>
          </div>
        </section>

        {/* ─── 关于 ─── */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Globe size={14} />
            关于
          </h3>
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3 text-xs text-slate-500">
            <p className="font-medium text-slate-400">智盒 SmartBox v0.2.0</p>
            <p className="mt-1">可插拔 AI 增强的网页版工具箱</p>
            <p className="mt-1">技术栈: React 18 + Vite 6 + CodeMirror 6 + xterm.js + Express 5 + SSH2</p>
            <p className="mt-2 text-[10px] text-slate-600">
              AI 功能由 OpenRouter API 提供支持 · 所有数据加密传输
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
