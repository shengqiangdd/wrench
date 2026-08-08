/**
 * AiSettings.tsx — AI Agent 配置面板
 *
 * 提取自 SettingsPanel，包含 Provider 选择、模型选择、API Key 输入等。
 * 使用 React.memo 避免无关渲染。
 */

import { useState, useCallback, useEffect, memo, useMemo } from 'react'
import { authedFetch } from '../../services/auth'
import {
  Key,
  Globe,
  Brain,
  MessageSquare,
  ExternalLink,
  Check,
  ChevronDown,
  Pencil,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { useAiStore } from '../../stores/ai-store'
import { AI_PROVIDERS } from '../../types/ai'
import type { AiProvider } from '../../types/ai'

const AiSettings = memo(function AiSettings() {
  const aiConfig = useAiStore((s) => s.config)
  const setAiConfig = useAiStore((s) => s.setConfig)
  const fetchedModels = useAiStore((s) => s.fetchedModels)
  const fetchedModelsAt = useAiStore((s) => s.fetchedModelsAt)
  const isFetchingModels = useAiStore((s) => s.isFetchingModels)
  const setFetchedModels = useAiStore((s) => s.setFetchedModels)
  const setIsFetchingModels = useAiStore((s) => s.setIsFetchingModels)
  const fetchModelsError = useAiStore((s) => s.fetchModelsError)

  const [showApiKey, setShowApiKey] = useState(false)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [showProviderSelector, setShowProviderSelector] = useState(false)
  const [customModel, setCustomModel] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  // Provider 切换
  const currentProvider = useMemo(
    () => AI_PROVIDERS.find((p) => p.id === aiConfig.provider) || AI_PROVIDERS[0]!,
    [aiConfig.provider],
  )

  // 从后端环境变量获取 API Key（如果前端未填写）
  useEffect(() => {
    if (!aiConfig.apiKey && aiConfig.provider === 'openrouter') {
      authedFetch('/api/ai/config')
        .then((r) => r.json())
        .then((data) => {
          if (data.apiKeyHint && !data.apiKey) {
            console.log('后端已配置 API Key，请在下方填写你的 Key 或使用服务端 Key')
          }
        })
        .catch(() => {})
    }
  }, [aiConfig.provider, aiConfig.apiKey])

  // 模型列表
  const allModels = useMemo(
    () => (fetchedModels.length > 0 ? fetchedModels : currentProvider.models),
    [fetchedModels, currentProvider.models],
  )

  const formattedFetchTime = useMemo(
    () =>
      fetchedModelsAt
        ? new Date(fetchedModelsAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : null,
    [fetchedModelsAt],
  )

  const selectedModelLabel = useMemo(
    () => allModels.find((m) => m.value === aiConfig.model)?.label || aiConfig.model,
    [allModels, aiConfig.model],
  )

  const freeModelCount = useMemo(() => allModels.filter((m) => m.free).length, [allModels])

  // Provider 选择
  const handleSelectProvider = useCallback(
    (provider: AiProvider) => {
      if (provider.id === 'custom') {
        setAiConfig({
          provider: 'custom',
          model: '',
          baseUrl: '',
          customBaseUrl: true,
        })
        setShowProviderSelector(false)
        return
      }
      setAiConfig({
        provider: provider.id,
        baseUrl: provider.baseUrl,
        model: provider.defaultModel,
        customBaseUrl: false,
      })
      setShowProviderSelector(false)
      setShowCustomInput(false)
    },
    [setAiConfig],
  )

  // 模型选择
  const handleSelectModel = useCallback(
    (modelValue: string) => {
      if (modelValue === '__custom__') {
        setShowCustomInput(true)
        setShowModelSelector(false)
        return
      }
      setAiConfig({ model: modelValue })
      setShowModelSelector(false)
      setShowCustomInput(false)
    },
    [setAiConfig],
  )

  const handleSetCustomModel = useCallback(() => {
    if (customModel.trim()) {
      setAiConfig({ model: customModel.trim() })
      setShowCustomInput(false)
      setCustomModel('')
    }
  }, [customModel, setAiConfig])

  // 获取模型列表
  const fetchModels = useCallback(
    async (providerId?: string) => {
      setIsFetchingModels(true)
      setFetchedModels([])
      try {
        const params = new URLSearchParams()
        if (providerId) params.set('provider', providerId)
        if (aiConfig.apiKey) params.set('api_key', aiConfig.apiKey)
        params.set('base_url', currentProvider.baseUrl)
        const resp = await authedFetch(`/api/ai/fetch-all-models?${params.toString()}`)
        if (!resp.ok) throw new Error('API 请求失败: ' + resp.status)
        const data = await resp.json()
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
          setFetchedModels(data.models)
        } else {
          const errMsg = data.error || '该平台未返回模型列表'
          setFetchedModels([], errMsg)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('获取模型失败:', msg)
        setFetchedModels([], msg)
      } finally {
        setIsFetchingModels(false)
      }
    },
    [setFetchedModels, setIsFetchingModels, aiConfig.apiKey, currentProvider.baseUrl],
  )

  // 当前 provider 切换时自动拉取模型
  useEffect(() => {
    fetchModels(currentProvider.id)
  }, [currentProvider.id, fetchModels])

  // API Key 链接
  const apiKeyLink = useMemo(() => {
    const linkMap: Record<string, string> = {
      openrouter: 'https://openrouter.ai/keys',
      openai: 'https://platform.openai.com/api-keys',
      anthropic: 'https://console.anthropic.com/',
      google: 'https://aistudio.google.com/apikey',
      deepseek: 'https://platform.deepseek.com/api_keys',
      siliconflow: 'https://cloud.siliconflow.cn/account/ak',
    }
    return linkMap[currentProvider.id] || '#'
  }, [currentProvider.id])

  // API Key placeholder
  const apiKeyPlaceholder = useMemo(() => {
    const placeholderMap: Record<string, string> = {
      openrouter: 'sk-or-v1-...',
      openai: 'sk-...',
      anthropic: 'sk-ant-...',
    }
    return placeholderMap[currentProvider.id] || '输入 API Key'
  }, [currentProvider.id])

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
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
            <ChevronDown size={14} className="shrink-0 text-slate-500" />
          </button>

          {showProviderSelector && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowProviderSelector(false)} />
              <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                {AI_PROVIDERS.map((provider) => (
                  <button
                    key={provider.id}
                    onClick={() => handleSelectProvider(provider)}
                    className={`flex w-full items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-slate-700 ${
                      aiConfig.provider === provider.id
                        ? 'text-wrench-400 bg-slate-700/50'
                        : 'text-slate-300'
                    }`}
                  >
                    <div className="flex-1 text-left">
                      <div className="font-medium">{provider.name}</div>
                      {provider.description && (
                        <div className="mt-0.5 text-[10px] text-slate-500">
                          {provider.description}
                        </div>
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

      {/* API Base URL */}
      <div className="mb-3">
        <label className="mb-1.5 flex items-center gap-1 text-xs text-slate-500">
          <Globe size={12} />
          API Base URL
          <button
            onClick={() => setAiConfig({ customBaseUrl: !aiConfig.customBaseUrl })}
            className={`ml-2 inline-flex items-center gap-1 text-[10px] transition-colors ${
              aiConfig.customBaseUrl ? 'text-wrench-400' : 'text-slate-600 hover:text-slate-400'
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
          <div className="input flex cursor-not-allowed items-center justify-between bg-slate-800/30 text-sm text-slate-400">
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
            href={apiKeyLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-wrench-400 hover:text-wrench-300 ml-1 inline-flex min-h-[44px] items-center gap-0.5 px-2"
          >
            获取 <ExternalLink size={12} />
          </a>
        </label>
        <div className="relative">
          <form onSubmit={(e) => e.preventDefault()}>
            <input
              type={showApiKey ? 'text' : 'password'}
              value={aiConfig.apiKey}
              onChange={(e) => setAiConfig({ apiKey: e.target.value })}
              className="input min-h-[44px] pr-20"
              placeholder={apiKeyPlaceholder}
              autoComplete="off"
            />
          </form>
          <button
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute top-1/2 right-2 flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-xs text-slate-500 hover:text-slate-300"
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
          {freeModelCount > 0 && (
            <span className="ml-1 text-[10px] text-emerald-500/70">
              {freeModelCount} 个免费模型
            </span>
          )}
          <button
            onClick={() => fetchModels(currentProvider.id)}
            disabled={isFetchingModels}
            className="hover:text-wrench-400 ml-auto flex min-h-[44px] items-center gap-1 px-2 text-xs text-slate-500 transition-colors disabled:opacity-50"
            title={formattedFetchTime ? `上次更新: ${formattedFetchTime}` : '从 API 获取最新模型'}
          >
            {isFetchingModels ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            {isFetchingModels ? '获取中…' : '刷新模型'}
          </button>
        </label>

        {showCustomInput ? (
          <div className="flex items-center gap-2">
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSetCustomModel()
              }}
              className="input flex-1"
              placeholder="输入模型名称"
              autoFocus
            />
            <button
              onClick={handleSetCustomModel}
              className="btn btn-primary text-xs whitespace-nowrap"
            >
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
              <ChevronDown size={14} className="shrink-0 text-slate-500" />
            </button>

            {showModelSelector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[300px] overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                  {currentProvider.id === 'custom' ? (
                    <button
                      onClick={() => handleSelectModel('__custom__')}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-700"
                    >
                      ✏️ 输入自定义模型名称...
                    </button>
                  ) : (
                    <>
                      {fetchedModels.length > 0 && (
                        <>
                          <div className="border-b border-slate-700/50 px-3 py-1.5 text-[10px] tracking-wider text-blue-400/70 uppercase">
                            🔄 API 获取（{fetchedModels.length} 个模型）
                          </div>
                          {fetchedModels.map((model) => (
                            <button
                              key={model.value}
                              onClick={() => handleSelectModel(model.value)}
                              className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                                aiConfig.model === model.value
                                  ? 'text-wrench-400 bg-slate-700/50'
                                  : 'text-slate-300'
                              }`}
                            >
                              <span className="flex-1 truncate">{model.label}</span>
                              {model.free && (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-400">
                                  免费
                                </span>
                              )}
                              {aiConfig.model === model.value && (
                                <Check size={12} className="shrink-0" />
                              )}
                            </button>
                          ))}
                        </>
                      )}

                      {fetchedModels.length === 0 && currentProvider.models.length > 0 && (
                        <>
                          <div className="border-b border-slate-700/50 px-3 py-1.5 text-[10px] tracking-wider text-slate-500 uppercase">
                            📦 内置模型（点击刷新获取最新）
                          </div>
                          {currentProvider.models.map((model) => (
                            <button
                              key={model.value}
                              onClick={() => handleSelectModel(model.value)}
                              className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-slate-700 ${
                                aiConfig.model === model.value
                                  ? 'text-wrench-400 bg-slate-700/50'
                                  : 'text-slate-300'
                              }`}
                            >
                              <span className="flex-1 truncate">{model.label}</span>
                              {model.free && (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-400">
                                  免费
                                </span>
                              )}
                              {aiConfig.model === model.value && (
                                <Check size={12} className="shrink-0" />
                              )}
                            </button>
                          ))}
                        </>
                      )}

                      {fetchedModels.length === 0 &&
                        currentProvider.models.length === 0 &&
                        fetchModelsError && (
                          <div className="px-3 py-4 text-center">
                            <p className="text-xs text-slate-500">获取失败：{fetchModelsError}</p>
                          </div>
                        )}
                    </>
                  )}

                  {currentProvider.id !== 'custom' && (
                    <button
                      onClick={() => handleSelectModel('__custom__')}
                      className="flex w-full items-center gap-2 border-t border-slate-700/50 px-3 py-2 text-xs text-slate-400 hover:bg-slate-700"
                    >
                      ✏️ 输入自定义模型...
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 启用 Agent */}
      <div className="mb-3">
        <label className="flex cursor-pointer items-center gap-2">
          <div
            role="checkbox"
            aria-checked={aiConfig.enabled}
            tabIndex={0}
            onClick={() => setAiConfig({ enabled: !aiConfig.enabled })}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                setAiConfig({ enabled: !aiConfig.enabled })
              }
            }}
            className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
              aiConfig.enabled ? 'bg-wrench-500' : 'bg-slate-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                aiConfig.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </div>
          <div>
            <span className="text-xs text-slate-400">启用 AI Agent 功能</span>
            <p className="mt-0.5 text-[11px] text-slate-600">
              开启后可在 SSH 终端界面使用 AI 助手，通过自然语言控制服务器
            </p>
          </div>
        </label>
      </div>
    </section>
  )
})

export default AiSettings
