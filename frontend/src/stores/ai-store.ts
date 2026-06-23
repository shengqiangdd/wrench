import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AiConfig, AiMessage, AiSuggestion } from '../types/ai'

interface AiState {
  config: AiConfig
  messages: AiMessage[]
  suggestions: AiSuggestion[]
  isStreaming: boolean
  streamingContent: string

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

  // 默认配置
  getDefaultConfig: () => AiConfig
}

export const useAiStore = create<AiState>()(
  persist(
    (set) => ({
      config: {
        apiKey: '',
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: false,
      },
      messages: [],
      suggestions: [],
      isStreaming: false,
      streamingContent: '',

      setConfig: (partial) =>
        set((s) => ({ config: { ...s.config, ...partial } })),

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
          messages: [
            ...s.messages,
            { role: 'assistant', content: s.streamingContent },
          ],
          streamingContent: '',
        })),

      addSuggestion: (suggestion) =>
        set((s) => ({ suggestions: [suggestion, ...s.suggestions] })),

      markSuggestionApplied: (id) =>
        set((s) => ({
          suggestions: s.suggestions.map((sg) =>
            sg.id === id ? { ...sg, applied: true } : sg,
          ),
        })),

      removeSuggestion: (id) =>
        set((s) => ({
          suggestions: s.suggestions.filter((sg) => sg.id !== id),
        })),

      getDefaultConfig: () => ({
        apiKey: '',
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: false,
      }),
    }),
    {
      name: 'smartbox-ai',
      partialize: (state) => ({
        config: state.config,
      }),
    },
  ),
)
