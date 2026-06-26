import { useState, useCallback, useEffect } from 'react'
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
  Pencil,
  Download,
  Upload,
  Lock,
  Unlock,
  AlertTriangle,
} from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { useAiStore } from '../../stores/ai-store'
import { AI_PROVIDERS } from '../../types/ai'
import type { AiProvider } from '../../types/ai'
import {
  exportConfig,
  importConfigFromFile,
  importEncryptedFile,
} from '../../services/importExport'
import { ConfirmModal } from '../../components/ConfirmModal'

export default function SettingsPanel() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  const aiConfig = useAiStore((s) => s.config)
  const setAiConfig = useAiStore((s) => s.setConfig)

  const [showApiKey, setShowApiKey] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showProviderSelector, setShowProviderSelector] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customBaseUrl, setCustomBaseUrl] = useState('')

  // ─── 导入导出状态 ───
  const [exportPassword, setExportPassword] = useState('')
  const [showExportPassword, setShowExportPassword] = useState(false)
  const [importPassword, setImportPassword] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [importingFile, setImportingFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [showReloadConfirm, setShowReloadConfirm] = useState(false)
  const [pendingReload, setPendingReload] = useState(false)

  const themeOptions = [
    { value: 'dark' as const, label: '深色', icon: Moon },
    { value: 'light' as const, label: '浅色', icon: Sun },
    { value: 'system' as const, label: '跟随系统', icon: Monitor },
  ]

  // ── Provider 切换 ──
  const currentProvider = AI_PROVIDERS.find((p) => p.id === aiConfig.provider) || AI_PROVIDERS[0]

  const handleSelectProvider = useCallback((provider: AiProvider) => {
    if (provider.id === 'custom') {
      setAiConfig({
        provider: 'custom',
        model: '',
        baseUrl: customBaseUrl || '',
        customBaseUrl: true,
      })
      setShowProviderSelector(false)
      return
    }
    setAiConfig({
      provider: provider.id as any,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      customBaseUrl: false,
    })
    setShowProviderSelector(false)
    setShowCustomInput(false)
  }, [setAiConfig, customBaseUrl])

  // ── 模型切换 ──
  const allModels = currentProvider.models
  const selectedModelLabel = allModels.find((m) => m.value === aiConfig.model)?.label || aiConfig.model

  const handleSelectModel = useCallback((modelValue: string) => {
    if (modelValue === '__custom__') {
      setShowCustomInput(true)
      setShowModelSelector(false)
      return
    }
    setAiConfig({ model: modelValue })
    setShowModelSelector(false)
    setShowCustomInput(false)
  }, [setAiConfig])

  const handleSetCustomModel = useCallback(() => {
    if (customModel.trim()) {
      setAiConfig({ model: customModel.trim() })
      setShowCustomInput(false)
      setCustomModel('')
    }
  }, [customModel, setAiConfig])

  // ─── 导入导出处理函数 ───

  const handleImportClick = useCallback(() => {
    setImportingFile(null)
    setImportError('')
    setIsImporting(true)
    importConfigFromFile().catch((err: any) => {
      setImportError(err.message || '导入失败')
    }).finally(() => {
      setIsImporting(false)
    })
  }, [])

  const handleConfirmImport = useCallback(() => {
    if (!importingFile) return
    setIsImporting(true)
    importEncryptedFile(importingFile, importPassword)
      .then(() => {
        setShowImportDialog(false)
        setImportingFile(null)
        setImportPassword('')
        setImportError('')
        setShowReloadConfirm(true)
      })
      .catch((err: any) => {
        setImportError(err.message || '导入失败')
      })
      .finally(() => setIsImporting(false))
  }, [importingFile, importPassword])

  const handleExportWithoutPassword = useCallback(() => {
    setShowExportConfirm(false)
    exportConfig()
  }, [])

  const handleExportWithPassword = useCallback(() => {
    if (!exportPassword.trim()) return
    exportConfig(exportPassword.trim())
    setShowExportPassword(false)
    setExportPassword('')
  }, [exportPassword])

  // 监听加密导入事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setImportingFile(detail.file)
      setShowImportDialog(true)
      detail.resolve(new Promise<void>((resolve, reject) => {
        // 密码输入后 handleConfirmImport 会调用 detail.reject/resolve
        // 这里通过全局变量暂存
        ;(window as any).__importResolve = resolve
        ;(window as any).__importReject = reject
      }))
    }
    window.addEventListener('smartbox-import-needs-password', handler)
    return () => window.removeEventListener('smartbox-import-needs-password', handler)
  }, [])

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
          <p className="mt-2 text-[11px] text-slate-600">
            {theme === 'dark' ? '🌙 当前为深色主题，点击浅色可切换' : theme === 'light' ? '☀️ 当前为浅色主题，界面清新明亮' : '🔄 当前跟随系统主题，自动适配深浅色'}
          </p>
        </section>

        {/* ─── AI 配置 ─── */}
        <section>
          <h3 className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Brain size={14} />
            AI Agent 配置
          </h3>

          {/* Provider 选择 */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Globe size={12} />
              AI 服务商
            </label>
            <div className="relative">
              <button
                onClick={() => setShowProviderSelector(!showProviderSelector)}
                className="input flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-slate-200">{currentProvider.name}</span>
                  {currentProvider.description && (
                    <span className="text-[10px] text-slate-500">{currentProvider.description}</span>
                  )}
                </div>
                <ChevronDown size={14} className="text-slate-500 shrink-0" />
              </button>

              {showProviderSelector && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowProviderSelector(false)} />
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-slate-700 bg-slate-800 shadow-xl overflow-hidden">
                    {AI_PROVIDERS.map((provider) => (
                      <button
                        key={provider.id}
                        onClick={() => handleSelectProvider(provider)}
                        className={`flex w-full items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-slate-700 ${
                          aiConfig.provider === provider.id ? 'bg-slate-700/50 text-smartbox-400' : 'text-slate-300'
                        }`}
                      >
                        <div className="flex-1 text-left">
                          <div className="font-medium">{provider.name}</div>
                          {provider.description && (
                            <div className="mt-0.5 text-[10px] text-slate-500">{provider.description}</div>
                          )}
                        </div>
                        {aiConfig.provider === provider.id && <Check size={12} className="shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* API Endpoint - 可编辑版本 */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Globe size={12} />
              API Base URL
              <button
                onClick={() => setAiConfig({ customBaseUrl: !aiConfig.customBaseUrl })}
                className={`ml-2 inline-flex items-center gap-1 text-[10px] transition-colors ${
                  aiConfig.customBaseUrl ? 'text-smartbox-400' : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                <Pencil size={10} />
                {aiConfig.customBaseUrl ? '自定义模式' : '预设模式'}
              </button>
            </label>
            {aiConfig.customBaseUrl ? (
              <input
                value={aiConfig.baseUrl}
                onChange={(e) => setAiConfig({ baseUrl: e.target.value })}
                className="input"
                placeholder="https://api.example.com/v1"
              />
            ) : (
              <div className="input flex items-center justify-between text-sm text-slate-400 cursor-not-allowed bg-slate-800/30">
                <span>{currentProvider.baseUrl || aiConfig.baseUrl}</span>
                <span className="text-[10px] text-slate-600">预设</span>
              </div>
            )}
          </div>

          {/* API Key */}
          <div className="mb-3">
            <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
              <Key size={12} />
              API Key
              <a
                href={currentProvider.id === 'openrouter' ? 'https://openrouter.ai/keys' :
                      currentProvider.id === 'openai' ? 'https://platform.openai.com/api-keys' :
                      currentProvider.id === 'anthropic' ? 'https://console.anthropic.com/' :
                      currentProvider.id === 'google' ? 'https://aistudio.google.com/apikey' :
                      currentProvider.id === 'deepseek' ? 'https://platform.deepseek.com/api_keys' :
                      currentProvider.id === 'siliconflow' ? 'https://cloud.siliconflow.cn/account/ak' :
                      '#'}
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
                placeholder={currentProvider.id === 'openrouter' ? 'sk-or-v1-...' :
                            currentProvider.id === 'openai' ? 'sk-...' :
                            currentProvider.id === 'anthropic' ? 'sk-ant-...' : '输入 API Key'}
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
              {currentProvider.models.some((m) => m.free) && (
                <span className="ml-1 text-[10px] text-emerald-500/70">
                  {currentProvider.models.filter((m) => m.free).length} 个免费模型
                </span>
              )}
            </label>

            {showCustomInput ? (
              <div className="flex items-center gap-2">
                <input
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSetCustomModel() }}
                  className="input flex-1"
                  placeholder="输入模型名称"
                  autoFocus
                />
                <button onClick={handleSetCustomModel} className="btn btn-primary text-xs whitespace-nowrap">
                  <Check size={14} /> 确认
                </button>
                <button onClick={() => setShowCustomInput(false)} className="btn btn-ghost text-xs">
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
                  <ChevronDown size={14} className="text-slate-500 shrink-0" />
                </button>

                {showModelSelector && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                      {currentProvider.models.length === 0 && currentProvider.id === 'custom' ? (
                        <button
                          onClick={() => handleSelectModel('__custom__')}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-700"
                        >
                          ✏️ 输入自定义模型名称...
                        </button>
                      ) : (
                        <>
                          {/* 免费模型组 */}
                          {currentProvider.models.some((m) => m.free) && (
                            <>
                              <div className="border-b border-slate-700/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-emerald-400/70">
                                🆓 免费模型
                              </div>
                              {currentProvider.models.filter((m) => m.free).map((model) => (
                                <button
                                  key={model.value}
                                  onClick={() => handleSelectModel(model.value)}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                                    aiConfig.model === model.value ? 'bg-slate-700/50 text-smartbox-400' : 'text-slate-300'
                                  }`}
                                >
                                  <span className="flex-1">{model.label}</span>
                                  {model.description && (
                                    <span className="text-[10px] text-slate-500">{model.description}</span>
                                  )}
                                  {aiConfig.model === model.value && <Check size={12} className="shrink-0" />}
                                </button>
                              ))}
                            </>
                          )}

                          {/* 付费/其他模型 */}

                          {currentProvider.models.filter((m) => !m.free).length > 0 && (
                            <>
                              <div className="border-b border-t border-slate-700/50 px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">
                                💰 其他模型
                              </div>
                              {currentProvider.models.filter((m) => !m.free).map((model) => (
                                <button
                                  key={model.value}
                                  onClick={() => handleSelectModel(model.value)}
                                  className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                                    aiConfig.model === model.value ? 'bg-slate-700/50 text-smartbox-400' : 'text-slate-300'
                                  }`}
                                >
                                  <span className="flex-1">{model.label}</span>
                                  {model.description && (
                                    <span className="text-[10px] text-slate-500">{model.description}</span>
                                  )}
                                  {aiConfig.model === model.value && <Check size={12} className="shrink-0" />}
                                </button>
                              ))}
                            </>
                          )}

                          {/* 自定义模型入口 */}
                          <button
                            onClick={() => handleSelectModel('__custom__')}
                            className="flex w-full items-center gap-2 border-t border-slate-700/50 px-3 py-2 text-xs text-slate-400 hover:bg-slate-700"
                          >
                            ✏️ 输入自定义模型...
                          </button>
                        </>
                      )}
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

        {/* ─── 数据管理 ─── */}
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <Download size={14} />
            数据管理
          </h3>

          <div className="space-y-3">
            {/* 导出 */}
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-300">导出配置</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    导出 SSH 连接、AI 配置、插件状态和 UI 偏好
                  </p>
                </div>
                <button
                  onClick={() => setShowExportConfirm(true)}
                  className="btn btn-ghost flex items-center gap-1.5 text-xs"
                >
                  <Download size={14} />
                  导出
                </button>
              </div>
            </div>

            {/* 导入 */}
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-300">导入配置</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    导入 .smartbox 文件，现有连接不会被覆盖
                  </p>
                </div>
                <button
                  onClick={handleImportClick}
                  disabled={isImporting}
                  className="btn btn-ghost flex items-center gap-1.5 text-xs"
                >
                  <Upload size={14} />
                  {isImporting ? '导入中...' : '导入'}
                </button>
              </div>
            </div>

            {/* 提示信息 */}
            <p className="text-[11px] text-slate-600 leading-relaxed px-1">
              <AlertTriangle size={11} className="inline-block mr-1 text-amber-500/70" />
              敏感数据（密码、私钥、API Key）导出时包含在文件中。建议使用密码加密导出，确保传输安全。
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
            <p className="font-medium text-slate-400">智盒 SmartBox v0.3.0</p>
            <p className="mt-1">可插拔 AI 增强的网页版工具箱</p>
            <p className="mt-1">技术栈: React 19 + Vite 8 + CodeMirror 6 + xterm.js + Express 5 + SSH2</p>
            <p className="mt-1">内置 AI Agent 技能生成器 + 提示词模板库插件</p>
            <p className="mt-2 text-[10px] text-slate-600">
              AI 功能由 OpenRouter / OpenAI / Claude / Gemini 等 API 提供支持 · 所有数据加密传输
            </p>
          </div>
        </section>
      </div>

      {/* ── 导出确认弹窗 ── */}
      <ConfirmModal
        open={showExportConfirm}
        title="导出配置"
        message="是否加密导出的配置？加密后需要密码才能导入。建议加密导出以防敏感信息泄露。"
        confirmText="加密导出"
        cancelText="明文导出"
        onConfirm={() => setShowExportPassword(true)}
        onCancel={handleExportWithoutPassword}
      />

      {/* ── 导出密码输入弹窗 ── */}
      {showExportPassword && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowExportPassword(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-lg border border-slate-700/50 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
              <Lock size={14} className="text-smartbox-400" />
              设置导出密码
            </h3>
            <p className="mt-2 text-xs text-slate-400">
              导入此文件时需要输入此密码
            </p>
            <input
              type="password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleExportWithPassword()
              }}
              className="input mt-3"
              placeholder="输入导出密码"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowExportPassword(false)
                  setExportPassword('')
                }}
                className="rounded-md border border-slate-600/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-300"
              >
                取消
              </button>
              <button
                onClick={handleExportWithPassword}
                className="rounded-md bg-smartbox-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-smartbox-500"
              >
                确认导出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 导入密码输入弹窗 ── */}
      {showImportDialog && importingFile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60"
            onClick={() => {
              setShowImportDialog(false)
              setImportingFile(null)
              setImportError('')
            }}
          />
          <div className="relative z-10 w-full max-w-sm rounded-lg border border-slate-700/50 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
              <Unlock size={14} className="text-smartbox-400" />
              输入解密密码
            </h3>
            <p className="mt-2 text-xs text-slate-400">
              此配置文件已加密，请输入导出时设置的密码
            </p>
            <input
              type="password"
              value={importPassword}
              onChange={(e) => {
                setImportPassword(e.target.value)
                setImportError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmImport()
              }}
              className="input mt-3"
              placeholder="输入解密密码"
              autoFocus
            />
            {importError && (
              <p className="mt-2 text-xs text-red-400">{importError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowImportDialog(false)
                  setImportingFile(null)
                  setImportError('')
                  setImportPassword('')
                }}
                className="rounded-md border border-slate-600/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-300"
              >
                取消
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={isImporting}
                className="rounded-md bg-smartbox-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-smartbox-500 disabled:opacity-50"
              >
                {isImporting ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
