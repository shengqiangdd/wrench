import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AiConfig, AiMessage, AiSuggestion, AiProviderModel } from '../types/ai'

interface AiState {
  config: AiConfig
  messages: AiMessage[]
  suggestions: AiSuggestion[]
  isStreaming: boolean
  streamingContent: string
  /** 从 API 动态获取的免费模型列表 */
  fetchedModels: AiProviderModel[]
  /** 上次获取时间 */
  fetchedModelsAt: number | null
  /** 是否正在获取 */
  isFetchingModels: boolean

  // 配置操作
  setConfig: (config: Partial<AiConfig>) => void

  // 对话操作
  addMessage: (msg: AiMessage) => void
  clearMessages: () => void
  setStreaming: (streaming: boolean) => void
  appendStreamingContent: (content: string) => void
  finalizeStreaming: () => void

  // 建议操作
  addSuggestion: (suggestion: AiSuggestion) => void
  markSuggestionApplied: (id: string) => void
  removeSuggestion: (id: string) => void

  // 模型更新
  setFetchedModels: (models: AiProviderModel[]) => void
  setIsFetchingModels: (v: boolean) => void

  // 默认配置
  getDefaultConfig: () => AiConfig
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      config: {
        apiKey: '',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        provider: 'openrouter',
        customBaseUrl: false,
        enabled: false,
      },
      messages: [],
      suggestions: [],
      isStreaming: false,
      streamingContent: '',
      fetchedModels: [],
      fetchedModelsAt: null,
      isFetchingModels: false,

      setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),

      addMessage: (msg) =>
        set((s) => {
          if (s.isStreaming) return s
          return { messages: [...s.messages, msg] }
        }),

      clearMessages: () => set({ messages: [] }),

      setStreaming: (streaming) => set({ isStreaming: streaming, streamingContent: '' }),

      appendStreamingContent: (content) =>
        set((s) => ({ streamingContent: s.streamingContent + content })),

      finalizeStreaming: () =>
        set((s) => ({
          isStreaming: false,
          messages: [...s.messages, { role: 'assistant', content: s.streamingContent }],
          streamingContent: '',
        })),

      addSuggestion: (suggestion) => set((s) => ({ suggestions: [suggestion, ...s.suggestions] })),

      markSuggestionApplied: (id) =>
        set((s) => ({
          suggestions: s.suggestions.map((sg) => (sg.id === id ? { ...sg, applied: true } : sg)),
        })),

      removeSuggestion: (id) =>
        set((s) => ({
          suggestions: s.suggestions.filter((sg) => sg.id !== id),
        })),

      setFetchedModels: (models) => set({ fetchedModels: models, fetchedModelsAt: Date.now() }),

      setIsFetchingModels: (v) => set({ isFetchingModels: v }),

      getDefaultConfig: () => ({
        apiKey: '',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        provider: 'openrouter',
        customBaseUrl: false,
        enabled: false,
      }),
    }),
    {
      name: 'smartbox-ai',
      partialize: (state) => ({
        config: state.config,
      }),
      // 修复 persist merge，确保 config 正确恢复
      merge: (persisted: unknown, current: AiState) => {
        const raw = (persisted || {}) as Record<string, unknown>
        const state = (raw.state || raw) as Record<string, unknown>
        return {
          ...current,
          config: { ...current.config, ...(state.config || {}) },
        }
      },
    },
  ),
)

/** 触发 store 重新从 localStorage 读取 */
export const refreshAiStore = () => {
  const raw = localStorage.getItem('smartbox-ai')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const state = parsed.state || parsed
    useAiStore.setState({
      config: { ...useAiStore.getState().config, ...(state.config || {}) },
    })
  } catch {
    /* ignore */
  }
}
