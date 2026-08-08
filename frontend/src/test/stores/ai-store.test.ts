import { describe, it, expect, beforeEach } from 'vitest'
import { useAiStore } from '../../stores/ai-store'
import type { AiProviderModel } from '../../types/ai'

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
    sessions: [],
    activeSessionId: null,
    suggestions: [],
    isStreaming: false,
    streamingContent: '',
    fetchedModels: [],
    fetchedModelsAt: null,
    isFetchingModels: false,
    fetchModelsError: null,
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
      expect(state.config.provider).toBe('openrouter')
    })
  })

  describe('sessions', () => {
    it('creates a session with system prompt', () => {
      const id = useAiStore.getState().createSession()
      const state = useAiStore.getState()
      expect(state.sessions).toHaveLength(1)
      expect(state.activeSessionId).toBe(id)
      expect(state.sessions[0]!.messages).toHaveLength(1)
      expect(state.sessions[0]!.messages[0]!.role).toBe('system')
      expect(state.sessions[0]!.title).toBe('新对话')
    })

    it('creates session with context', () => {
      const ctx = { type: 'ssh' as const, sshHost: '1.2.3.4' }
      useAiStore.getState().createSession(ctx)
      const session = useAiStore.getState().sessions[0]!
      expect(session.context?.sshHost).toBe('1.2.3.4')
      expect(session.messages[0]!.content).toContain('SSH 上下文')
    })

    it('switches active session', () => {
      const id1 = useAiStore.getState().createSession()
      const id2 = useAiStore.getState().createSession()
      const state = useAiStore.getState()
      expect(state.activeSessionId).toBe(id2)
      useAiStore.getState().setActiveSession(id1)
      expect(useAiStore.getState().activeSessionId).toBe(id1)
    })

    it('deletes session', () => {
      const id1 = useAiStore.getState().createSession()
      useAiStore.getState().createSession()
      useAiStore.getState().deleteSession(id1)
      const state = useAiStore.getState()
      expect(state.sessions).toHaveLength(1)
      expect(state.activeSessionId).not.toBe(id1)
    })

    it('renames session', () => {
      const id = useAiStore.getState().createSession()
      useAiStore.getState().renameSession(id, 'Test Session')
      expect(useAiStore.getState().sessions[0]!.title).toBe('Test Session')
    })

    it('returns active session via getActiveSession', () => {
      const id = useAiStore.getState().createSession()
      expect(useAiStore.getState().getActiveSession()?.id).toBe(id)
    })

    it('returns null when no active session', () => {
      expect(useAiStore.getState().getActiveSession()).toBeNull()
    })
  })

  describe('messages', () => {
    it('adds user message to active session', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().addUserMessage('hello')
      const session = useAiStore.getState().getActiveSession()!
      // system + user
      expect(session.messages).toHaveLength(2)
      expect(session.messages[1]!.role).toBe('user')
      expect(session.messages[1]!.content).toBe('hello')
    })

    it('auto-titles session from first user message', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().addUserMessage('Fix the bug in login')
      expect(useAiStore.getState().getActiveSession()!.title).toBe('Fix the bug in login')
    })

    it('truncates long auto-titles', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().addUserMessage('这是一条非常非常非常非常非常非常长的消息')
      expect(useAiStore.getState().getActiveSession()!.title.length).toBeLessThanOrEqual(21)
    })

    it('does not change title if already custom', () => {
      const id = useAiStore.getState().createSession()
      useAiStore.getState().renameSession(id, 'My Session')
      useAiStore.getState().addUserMessage('another message')
      expect(useAiStore.getState().getActiveSession()!.title).toBe('My Session')
    })

    it('clears messages keeps system prompt', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().addUserMessage('msg1')
      useAiStore.getState().addMessage({ role: 'assistant', content: 'msg2' })
      useAiStore.getState().clearCurrentMessages()
      const msgs = useAiStore.getState().getActiveSession()!.messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0]!.role).toBe('system')
    })
  })

  describe('streaming', () => {
    it('starts streaming with empty content', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().startStreaming()
      const state = useAiStore.getState()
      expect(state.isStreaming).toBe(true)
      expect(state.streamingContent).toBe('')
      // Empty assistant message added
      const msgs = state.getActiveSession()!.messages
      expect(msgs[msgs.length - 1]!.role).toBe('assistant')
      expect(msgs[msgs.length - 1]!.content).toBe('')
    })

    it('appends streaming content', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().startStreaming()
      useAiStore.getState().appendStreamContent('Hello')
      useAiStore.getState().appendStreamContent(', world')
      expect(useAiStore.getState().streamingContent).toBe('Hello, world')
      // ⚡ 流式期间内容只在 streamingContent 中，不逐 chunk 写入 sessions
      // sessions 中的 assistant 消息在 finishStreaming 时一次性写入
      const msgs = useAiStore.getState().getActiveSession()!.messages
      expect(msgs[msgs.length - 1]!.content).toBe('')
    })

    it('finishes streaming', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().startStreaming()
      useAiStore.getState().appendStreamContent('Done')
      useAiStore.getState().finishStreaming()
      const state = useAiStore.getState()
      expect(state.isStreaming).toBe(false)
      expect(state.streamingContent).toBe('')
      // 流式结束后，内容应一次性写入 sessions 中的 assistant 消息
      const msgs = state.getActiveSession()!.messages
      expect(msgs[msgs.length - 1]!.content).toBe('Done')
    })

    it('removes empty assistant message on finish', () => {
      useAiStore.getState().createSession()
      useAiStore.getState().addUserMessage('test')
      useAiStore.getState().startStreaming()
      useAiStore.getState().finishStreaming()
      const msgs = useAiStore.getState().getActiveSession()!.messages
      // system + user (empty assistant was removed)
      expect(msgs).toHaveLength(2)
    })
  })

  describe('suggestions', () => {
    const suggestion = {
      id: 's1',
      title: 'Fix bug',
      description: 'Add null check',
      code: 'if (x == null) return',
      language: 'typescript',
      timestamp: Date.now(),
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
    const mockModels: AiProviderModel[] = [
      { value: 'model-a', label: 'Model A' },
      { value: 'model-b', label: 'Model B' },
    ]

    it('stores fetched models with timestamp', () => {
      useAiStore.getState().setFetchedModels(mockModels)
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

  describe('session limits', () => {
    it('limits sessions to MAX_SESSIONS (100)', () => {
      for (let i = 0; i < 105; i++) {
        useAiStore.getState().createSession()
      }
      expect(useAiStore.getState().sessions.length).toBeLessThanOrEqual(100)
    })

    it('limits messages per session to MAX_MESSAGES (200)', () => {
      useAiStore.getState().createSession()
      for (let i = 0; i < 210; i++) {
        useAiStore.getState().addUserMessage(`msg ${i}`)
      }
      const msgs = useAiStore.getState().getActiveSession()!.messages
      expect(msgs.length).toBeLessThanOrEqual(201) // 200 user + 1 system
    })
  })
})
