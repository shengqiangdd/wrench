import { describe, it, expect, beforeEach } from 'vitest'
import { useAiStore } from '../../stores/ai-store'

// Helper to reset store between tests
function resetAiStore() {
  useAiStore.setState({
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
  })
}

describe('useAiStore', () => {
  beforeEach(() => {
    resetAiStore()
  })

  describe('config', () => {
    it('has default config', () => {
      const state = useAiStore.getState()
      expect(state.config.apiKey).toBe('')
      expect(state.config.provider).toBe('openrouter')
      expect(state.config.enabled).toBe(false)
    })

    it('updates config partially', () => {
      useAiStore.getState().setConfig({ apiKey: 'sk-test', enabled: true })
      const state = useAiStore.getState()
      expect(state.config.apiKey).toBe('sk-test')
      expect(state.config.enabled).toBe(true)
      // Other fields should remain unchanged
      expect(state.config.provider).toBe('openrouter')
    })

    it('provides default config via getDefaultConfig', () => {
      const defaultConfig = useAiStore.getState().getDefaultConfig()
      expect(defaultConfig.apiKey).toBe('')
      expect(defaultConfig.model).toContain('nemotron')
    })
  })

  describe('messages', () => {
    it('starts with empty messages', () => {
      expect(useAiStore.getState().messages).toHaveLength(0)
    })

    it('adds a message', () => {
      useAiStore.getState().addMessage({ role: 'user', content: 'hello' })
      const msgs = useAiStore.getState().messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0]!.content).toBe('hello')
      expect(msgs[0]!.role).toBe('user')
    })

    it('does not add message while streaming', () => {
      useAiStore.getState().setStreaming(true)
      useAiStore.getState().addMessage({ role: 'user', content: 'should-not-appear' })
      expect(useAiStore.getState().messages).toHaveLength(0)
    })

    it('clears all messages', () => {
      useAiStore.getState().addMessage({ role: 'user', content: 'msg1' })
      useAiStore.getState().addMessage({ role: 'assistant', content: 'msg2' })
      useAiStore.getState().clearMessages()
      expect(useAiStore.getState().messages).toHaveLength(0)
    })
  })

  describe('streaming', () => {
    it('starts streaming with empty content', () => {
      useAiStore.getState().setStreaming(true)
      const state = useAiStore.getState()
      expect(state.isStreaming).toBe(true)
      expect(state.streamingContent).toBe('')
    })

    it('appends streaming content', () => {
      useAiStore.getState().setStreaming(true)
      useAiStore.getState().appendStreamingContent('Hello')
      useAiStore.getState().appendStreamingContent(', world')
      expect(useAiStore.getState().streamingContent).toBe('Hello, world')
    })

    it('finalizes streaming into a message', () => {
      useAiStore.getState().setStreaming(true)
      useAiStore.getState().appendStreamingContent('Final result')
      useAiStore.getState().finalizeStreaming()
      const state = useAiStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.streamingContent).toBe('')
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0]!.role).toBe('assistant')
      expect(state.messages[0]!.content).toBe('Final result')
    })
  })

  describe('suggestions', () => {
    const suggestion = {
      id: 's1',
      title: 'Fix bug',
      description: 'Add null check',
      content: 'if (x == null) return',
      applied: false,
    }

    it('adds a suggestion', () => {
      useAiStore.getState().addSuggestion(suggestion)
      expect(useAiStore.getState().suggestions).toHaveLength(1)
      expect(useAiStore.getState().suggestions[0]!.title).toBe('Fix bug')
    })

    it('adds suggestions in reverse chronological order', () => {
      const s2 = { ...suggestion, id: 's2', title: 'Second' }
      useAiStore.getState().addSuggestion(suggestion)
      useAiStore.getState().addSuggestion(s2)
      const suggestions = useAiStore.getState().suggestions
      expect(suggestions[0]!.title).toBe('Second')
      expect(suggestions[1]!.title).toBe('Fix bug')
    })

    it('marks suggestion as applied', () => {
      useAiStore.getState().addSuggestion(suggestion)
      useAiStore.getState().markSuggestionApplied('s1')
      expect(useAiStore.getState().suggestions[0]!.applied).toBe(true)
    })

    it('removes a suggestion by id', () => {
      useAiStore.getState().addSuggestion(suggestion)
      useAiStore.getState().removeSuggestion('s1')
      expect(useAiStore.getState().suggestions).toHaveLength(0)
    })
  })

  describe('fetchedModels', () => {
    const mockModels = [
      { id: 'model-a', name: 'Model A', provider: 'openrouter' },
      { id: 'model-b', name: 'Model B', provider: 'openrouter' },
    ]

    it('stores fetched models with timestamp', () => {
      useAiStore.getState().setFetchedModels(mockModels as any[])
      const state = useAiStore.getState()
      expect(state.fetchedModels).toHaveLength(2)
      expect(state.fetchedModelsAt).toBeTypeOf('number')
    })

    it('sets fetching state', () => {
      useAiStore.getState().setIsFetchingModels(true)
      expect(useAiStore.getState().isFetchingModels).toBe(true)
      useAiStore.getState().setIsFetchingModels(false)
      expect(useAiStore.getState().isFetchingModels).toBe(false)
    })
  })
})
