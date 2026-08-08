/**
 * ai-store.ts
 *
 * 智能 AI Agent Store — 多会话管理 + 持久化 + 上下文感知。
 *
 * 核心能力：
 * - 多会话 CRUD（创建/切换/删除/重命名）
 * - 对话消息持久化到 localStorage（刷新不丢）
 * - 流式输出状态管理
 * - 动态 System Prompt（根据上下文自动构建）
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AiConfig, AiMessage, AiProviderModel } from '../types/ai'

// ─── 会话类型 ───

export interface AiChatSession {
  id: string
  title: string
  messages: AiMessage[]
  createdAt: number
  updatedAt: number
  /** 上下文来源（用于动态 System Prompt） */
  context?: AiSessionContext
}

export interface AiSessionContext {
  /** 上下文类型 */
  type: 'ssh' | 'code' | 'general'
  /** SSH 主机信息 */
  sshHost?: string
  sshUser?: string
  sshOs?: string
  sshCwd?: string
  /** 代码上下文 */
  codeLanguage?: string
  codeFileName?: string
  /** 额外元数据 */
  meta?: Record<string, string>
}

// ─── Store 状态 ───

interface AiState {
  // ── 全局配置 ──
  config: AiConfig
  setConfig: (config: Partial<AiConfig>) => void

  // ── 多会话管理 ──
  sessions: AiChatSession[]
  activeSessionId: string | null

  /** 创建新会话 */
  createSession: (context?: AiSessionContext) => string
  /** 删除会话 */
  deleteSession: (id: string) => void
  /** 重命名会话 */
  renameSession: (id: string, title: string) => void
  /** 切换会话 */
  setActiveSession: (id: string) => void
  /** 获取当前活跃会话 */
  getActiveSession: () => AiChatSession | null

  // ── 消息操作 ──
  /** 添加用户消息 */
  addUserMessage: (content: string) => void
  /** 开始流式 assistant 回复 */
  startStreaming: () => void
  /** 追加流式内容 */
  appendStreamContent: (content: string) => void
  /** 完成流式回复 */
  finishStreaming: () => void
  /** 添加一条完整消息（用于执行结果等） */
  addMessage: (msg: AiMessage) => void
  /** 清空当前会话消息 */
  clearCurrentMessages: () => void

  // ── 流式状态 ──
  isStreaming: boolean
  streamingContent: string

  // ── 模型更新 ──
  fetchedModels: AiProviderModel[]
  fetchedModelsAt: number | null
  isFetchingModels: boolean
  fetchModelsError: string | null
  setFetchedModels: (models: AiProviderModel[], error?: string | null) => void
  setIsFetchingModels: (v: boolean) => void

  // ── 建议 ──
  suggestions: import('../types/ai').AiSuggestion[]
  addSuggestion: (s: import('../types/ai').AiSuggestion) => void
  markSuggestionApplied: (id: string) => void
  removeSuggestion: (id: string) => void
}

// ─── 辅助函数 ───

function genId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 根据上下文动态构建 System Prompt */
function buildSystemPrompt(context?: AiSessionContext): string {
  const base = `你是一个智能运维与开发助手。你可以：
1. **分析问题**：根据用户的描述分析技术问题
2. **推荐命令**：给出需要执行的 Shell 命令
3. **解释输出**：解释命令执行结果
4. **编写脚本**：编写 Bash/Python/Node.js 等脚本
5. **代码分析**：解释、重构、优化代码

重要规则：
- 命令用 \`\`\`bash 代码块包裹，方便用户一键复制
- 需要执行命令时先解释命令的作用，再提供命令
- 保持回答简洁专业
- 涉及危险操作（rm -rf、dd、格式化等）必须加 ⚠️ 警告
- 对于复杂操作，分步骤说明
- 使用中文回答`

  if (!context) return base

  const parts: string[] = [base]

  if (context.type === 'ssh') {
    parts.push('')
    parts.push('## 当前 SSH 上下文')
    if (context.sshHost) parts.push(`- 主机: ${context.sshHost}`)
    if (context.sshUser) parts.push(`- 用户: ${context.sshUser}`)
    if (context.sshOs) parts.push(`- 系统: ${context.sshOs}`)
    if (context.sshCwd) parts.push(`- 当前目录: ${context.sshCwd}`)
    parts.push('')
    parts.push('用户可以通过「执行」按钮直接在服务器上运行你推荐的命令。')
    parts.push('请优先给出可直接执行的命令，并解释每条命令的作用。')
  }

  if (context.type === 'code') {
    parts.push('')
    parts.push('## 当前代码上下文')
    if (context.codeLanguage) parts.push(`- 语言: ${context.codeLanguage}`)
    if (context.codeFileName) parts.push(`- 文件: ${context.codeFileName}`)
    parts.push('')
    parts.push('用户选中了代码片段需要你分析。请给出专业的代码建议。')
  }

  return parts.join('\n')
}

/** 从第一条用户消息自动生成标题（截取前 20 字） */
function autoTitle(content: string): string {
  const clean = content.replace(/[\n\r]+/g, ' ').trim()
  if (clean.length <= 20) return clean
  return clean.slice(0, 20) + '…'
}

/** 重新加载 AI Store 数据（用于导入配置后刷新） */
export const refreshAiStore = () => {
  useAiStore.persist.rehydrate()
}

// ─── Store 定义 ───

const MAX_SESSIONS = 100
const MAX_MESSAGES_PER_SESSION = 200

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      // ── 配置 ──
      config: {
        apiKey: '',
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        baseUrl: 'https://openrouter.ai/api/v1',
        provider: 'openrouter',
        customBaseUrl: false,
        enabled: false,
      },

      setConfig: (partial) => set((s) => ({ config: { ...s.config, ...partial } })),

      // ── 多会话 ──
      sessions: [],
      activeSessionId: null,

      createSession: (context) => {
        const id = genId()
        const now = Date.now()
        const session: AiChatSession = {
          id,
          title: '新对话',
          messages: [{ role: 'system', content: buildSystemPrompt(context) }],
          createdAt: now,
          updatedAt: now,
          context,
        }

        set((s) => {
          let sessions = [session, ...s.sessions]
          // 超过上限时删除最旧的非活跃会话
          if (sessions.length > MAX_SESSIONS) {
            sessions = sessions.slice(0, MAX_SESSIONS)
          }
          return { sessions, activeSessionId: id }
        })
        return id
      },

      deleteSession: (id) =>
        set((s) => {
          const remaining = s.sessions.filter((x) => x.id !== id)
          const newActive =
            s.activeSessionId === id ? (remaining[0]?.id ?? null) : s.activeSessionId
          return { sessions: remaining, activeSessionId: newActive }
        }),

      renameSession: (id, title) =>
        set((s) => ({
          sessions: s.sessions.map((x) =>
            x.id === id ? { ...x, title, updatedAt: Date.now() } : x,
          ),
        })),

      setActiveSession: (id) => set({ activeSessionId: id }),

      getActiveSession: () => {
        const { sessions, activeSessionId } = get()
        return sessions.find((x) => x.id === activeSessionId) ?? null
      },

      // ── 消息操作 ──
      addUserMessage: (content) =>
        set((s) => {
          const sessions = s.sessions.map((x) => {
            if (x.id !== s.activeSessionId) return x
            const msgs = [...x.messages, { role: 'user' as const, content }]
            // 自动标题：第一条用户消息
            const title = x.title === '新对话' ? autoTitle(content) : x.title
            return {
              ...x,
              messages: msgs.slice(-MAX_MESSAGES_PER_SESSION),
              title,
              updatedAt: Date.now(),
            }
          })
          return { sessions }
        }),

      startStreaming: () =>
        set((s) => {
          const sessions = s.sessions.map((x) => {
            if (x.id !== s.activeSessionId) return x
            return {
              ...x,
              messages: [...x.messages, { role: 'assistant' as const, content: '' }],
            }
          })
          return { sessions, isStreaming: true, streamingContent: '' }
        }),

      appendStreamContent: (content) =>
        set((s) => {
          const newStreaming = s.streamingContent + content
          // ⚡ 优化：流式期间只更新 streamingContent，不逐 chunk 复制整个 sessions 数组
          // sessions 中的 assistant 消息在 finishStreaming 时一次性写入
          return { streamingContent: newStreaming }
        }),

      finishStreaming: () =>
        set((s) => {
          const finalContent = s.streamingContent
          const sessions = s.sessions.map((x) => {
            if (x.id !== s.activeSessionId) return x
            const msgs = [...x.messages]
            const last = msgs[msgs.length - 1]
            if (last && last.role === 'assistant') {
              if (!finalContent) {
                // 流式内容为空，移除空消息
                msgs.pop()
              } else {
                // 一次性写入完整流式内容
                msgs[msgs.length - 1] = { ...last, content: finalContent }
              }
            }
            return { ...x, messages: msgs, updatedAt: Date.now() }
          })
          return { sessions, isStreaming: false, streamingContent: '' }
        }),

      addMessage: (msg) =>
        set((s) => {
          const sessions = s.sessions.map((x) => {
            if (x.id !== s.activeSessionId) return x
            const msgs = [...x.messages, msg].slice(-MAX_MESSAGES_PER_SESSION)
            return { ...x, messages: msgs, updatedAt: Date.now() }
          })
          return { sessions }
        }),

      clearCurrentMessages: () =>
        set((s) => {
          const sessions = s.sessions.map((x) => {
            if (x.id !== s.activeSessionId) return x
            // 保留 system prompt
            const systemMsgs = x.messages.filter((m) => m.role === 'system')
            return { ...x, messages: systemMsgs, updatedAt: Date.now() }
          })
          return { sessions }
        }),

      // ── 流式状态 ──
      isStreaming: false,
      streamingContent: '',

      // ── 模型 ──
      fetchedModels: [],
      fetchedModelsAt: null,
      isFetchingModels: false,
      fetchModelsError: null,
      setFetchedModels: (models, error = null) =>
        set({ fetchedModels: models, fetchedModelsAt: Date.now(), fetchModelsError: error }),
      setIsFetchingModels: (v) => set({ isFetchingModels: v }),

      // ── 建议 ──
      suggestions: [],
      addSuggestion: (suggestion) =>
        set((state) => ({ suggestions: [suggestion, ...state.suggestions] })),
      markSuggestionApplied: (id) =>
        set((state) => ({
          suggestions: state.suggestions.map((sg) =>
            sg.id === id ? { ...sg, applied: true } : sg,
          ),
        })),
      removeSuggestion: (id) =>
        set((state) => ({
          suggestions: state.suggestions.filter((sg) => sg.id !== id),
        })),
    }),
    {
      name: 'wrench-ai-agent',
      // 只持久化配置和会话列表，不持久化流式状态
      partialize: (state) => ({
        config: state.config,
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
)
