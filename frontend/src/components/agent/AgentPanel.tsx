/**
 * AgentPanel.tsx
 *
 * 全局 AI Agent 侧边栏 — 独立于 SSH，任何页面可呼出。
 *
 * 核心能力：
 * - 多会话管理（新建 / 切换 / 删除 / 重命名）
 * - 流式输出 + 中断
 * - Markdown 富文本渲染
 * - 一键执行命令
 * - 上下文感知 System Prompt
 * - 快捷键 ⌘+Shift+A 开关
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  memo,
  useMemo,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { authedFetch } from '../../services/auth'
import {
  Brain,
  Send,
  Loader2,
  X,
  Sparkles,
  Trash2,
  Plus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Square,
  Search,
} from 'lucide-react'
import { useAiStore, type AiChatSession, type AiSessionContext } from '../../stores/ai-store'
import { useAppStore } from '../../stores/app-store'
import AgentMarkdown from './AgentMarkdown'
import type { AiMessage } from '../../types/ai'

// ─── SSE 流式读取 ───

async function* streamChat(
  messages: AiMessage[],
  apiKey: string,
  model: string,
  baseUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await authedFetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
      api_key: apiKey || undefined,
      base_url: baseUrl || undefined,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`API 错误 (${res.status}): ${errText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('无法读取响应流')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content || ''
        if (content) yield content
      } catch {
        /* ignore parse errors */
      }
    }
  }
}

// ─── 单条消息组件（memo 包裹，避免不必要的重渲染） ───

interface MessageItemProps {
  msg: AiMessage
  index: number
  sessionId: string | null
  extractCommands: (text: string) => string[]
  onExecute?: (cmd: string) => void
}

const MessageItem = memo(function MessageItem({
  msg,
  index,
  sessionId,
  extractCommands,
  onExecute,
}: MessageItemProps) {
  return (
    <div
      key={`${sessionId}-${index}`}
      className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[92%] rounded-xl px-3 py-2 ${
          msg.role === 'user'
            ? 'bg-wrench-600/20 border-wrench-600/30 border text-[13px] text-slate-200'
            : 'text-[13px] text-slate-300'
        }`}
      >
        {msg.role === 'assistant' ? (
          <AgentMarkdown
            content={msg.content}
            extractCommands={extractCommands}
            onExecute={onExecute}
          />
        ) : (
          <div className="break-words whitespace-pre-wrap">{msg.content}</div>
        )}
      </div>
    </div>
  )
})

// ─── 主组件 ───

interface Props {
  /** 上下文来源 */
  context?: AiSessionContext
  /** 命令执行回调（来自 SSH 等模块注入） */
  onExecuteCommand?: (cmd: string) => void
}

export default function AgentPanel({ context, onExecuteCommand }: Props) {
  const config = useAiStore((s) => s.config)
  const sessions = useAiStore((s) => s.sessions)
  const activeSessionId = useAiStore((s) => s.activeSessionId)
  const isStreaming = useAiStore((s) => s.isStreaming)
  const streamingContent = useAiStore((s) => s.streamingContent)
  const createSession = useAiStore((s) => s.createSession)
  const deleteSession = useAiStore((s) => s.deleteSession)
  const renameSession = useAiStore((s) => s.renameSession)
  const setActiveSession = useAiStore((s) => s.setActiveSession)
  const addUserMessage = useAiStore((s) => s.addUserMessage)
  const startStreaming = useAiStore((s) => s.startStreaming)
  const appendStreamContent = useAiStore((s) => s.appendStreamContent)
  const finishStreaming = useAiStore((s) => s.finishStreaming)
  const addMessage = useAiStore((s) => s.addMessage)
  const clearCurrentMessages = useAiStore((s) => s.clearCurrentMessages)
  const setAgentOpen = useAppStore((s) => s.setAgentOpen)

  const [input, setInput] = useState('')
  const [showSessionList, setShowSessionList] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 自动创建初始会话
  useEffect(() => {
    if (sessions.length === 0) {
      createSession(context)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 切换上下文时更新活跃会话的 system prompt
  useEffect(() => {
    if (context && activeSessionId) {
      const session = sessions.find((x) => x.id === activeSessionId)
      if (session && session.messages.length <= 1) {
        // 新会话且还没有用户消息，可以更新 system prompt
        // 通过重新创建会话的 system message 来更新
      }
    }
  }, [context, activeSessionId, sessions])

  // 获取当前活跃会话
  const activeSession = useMemo(
    () => sessions.find((x) => x.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )

  // 过滤后的会话列表
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.role !== 'system' && m.content.toLowerCase().includes(q)),
    )
  }, [sessions, searchQuery])

  // 自动滚动到底部（节流：100ms 内最多触发一次）
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (scrollTimerRef.current) return
    scrollTimerRef.current = setTimeout(() => {
      scrollTimerRef.current = null
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 100)
    return () => {
      if (scrollTimerRef.current) {
        clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = null
      }
    }
  }, [activeSession?.messages.length, streamingContent])

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [activeSessionId])

  // ─── 命令执行 ───

  const executeCommand = useCallback(
    async (cmd: string) => {
      if (onExecuteCommand) {
        onExecuteCommand(cmd)
        return
      }
      // 没有外部执行回调时，仅复制到剪贴板
      navigator.clipboard?.writeText(cmd)
    },
    [onExecuteCommand],
  )

  // ─── 发送消息 ───

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    // 确保有活跃会话
    let sessionId = activeSessionId
    if (!sessionId) {
      sessionId = createSession(context)
    }

    addUserMessage(text)
    setInput('')
    startStreaming()

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // 获取最新的消息列表
      const currentSession = useAiStore.getState().sessions.find((x) => x.id === sessionId)
      if (!currentSession) return

      const stream = streamChat(
        currentSession.messages,
        config.apiKey || '',
        config.model,
        config.baseUrl || 'https://openrouter.ai/api/v1',
        controller.signal,
      )

      for await (const chunk of stream) {
        appendStreamContent(chunk)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消
      } else {
        const errMsg = err instanceof Error ? err.message : '未知错误'
        addMessage({ role: 'assistant', content: `❌ AI 请求失败: ${errMsg}` })
      }
    } finally {
      finishStreaming()
      abortRef.current = null
    }
  }, [
    input,
    isStreaming,
    activeSessionId,
    config,
    context,
    addUserMessage,
    startStreaming,
    appendStreamContent,
    addMessage,
    finishStreaming,
    createSession,
  ])

  // ─── 中断生成 ───

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    finishStreaming()
  }, [finishStreaming])

  // ─── 重命名 ───

  const startRename = useCallback((session: AiChatSession) => {
    setEditingSessionId(session.id)
    setEditTitle(session.title)
    setMenuSessionId(null)
  }, [])

  const confirmRename = useCallback(() => {
    if (editingSessionId && editTitle.trim()) {
      renameSession(editingSessionId, editTitle.trim())
    }
    setEditingSessionId(null)
    setEditTitle('')
  }, [editingSessionId, editTitle, renameSession])

  // ─── 键盘事件 ───

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  // ─── 渲染 ───

  // 用户消息中提取可执行命令
  const extractCommands = useCallback((content: string): string[] => {
    const regex = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g
    const cmds: string[] = []
    let m: RegExpExecArray | null
    while ((m = regex.exec(content)) !== null) {
      if (m[1]) cmds.push(m[1].trim())
    }
    return cmds
  }, [])

  // 过滤系统消息，用 useMemo 缓存
  const visibleMessages = useMemo(
    () => activeSession?.messages.filter((m) => m.role !== 'system') ?? [],
    [activeSession?.messages],
  )

  // 如果 AI 未启用
  if (!config.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <Sparkles size={32} className="mb-3 text-slate-600" />
        <p className="text-sm text-slate-500">AI Agent 未启用</p>
        <p className="mt-1 text-xs text-slate-600">在设置中开启 AI Agent 即可使用</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── 头部 ── */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={() => setShowSessionList(!showSessionList)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-300"
          >
            <Brain size={14} className="text-wrench-400 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{activeSession?.title || '新对话'}</span>
            <MessageSquare size={10} className="shrink-0 text-slate-600" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pl-1">
          {activeSession && activeSession.messages.length > 1 && (
            <button
              onClick={clearCurrentMessages}
              className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-red-400"
              title="清除当前对话"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={() => {
              createSession(context)
              setShowSessionList(false)
            }}
            className="hover:text-wrench-400 rounded-md p-1 text-slate-500 hover:bg-slate-800"
            title="新建对话"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setAgentOpen(false)}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
            title="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── 会话列表抽屉 ── */}
      {showSessionList && (
        <div className="border-b border-slate-700/50 bg-slate-900/95">
          {/* 搜索栏 */}
          <div className="border-b border-slate-700/30 px-3 py-2">
            <div className="relative">
              <Search
                size={12}
                className="absolute top-1/2 left-2 -translate-y-1/2 text-slate-500"
              />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索对话..."
                className="focus:border-wrench-500 w-full rounded-md border border-slate-700/50 bg-slate-800/50 py-1.5 pr-2 pl-7 text-[11px] text-slate-300 placeholder-slate-500 focus:outline-none"
              />
            </div>
          </div>
          {/* 会话列表 */}
          <div className="max-h-[240px] overflow-y-auto">
            {filteredSessions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                {searchQuery ? '没有找到匹配的对话' : '还没有对话'}
              </div>
            ) : (
              filteredSessions.map((session) => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-slate-800/50 ${
                    session.id === activeSessionId
                      ? 'bg-wrench-500/10 text-wrench-400'
                      : 'text-slate-400'
                  }`}
                >
                  {editingSessionId === session.id ? (
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename()
                        if (e.key === 'Escape') setEditingSessionId(null)
                      }}
                      autoFocus
                      className="border-wrench-500/50 flex-1 rounded border bg-slate-800 px-1.5 py-0.5 text-[12px] text-slate-200 focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        setActiveSession(session.id)
                        setShowSessionList(false)
                        setSearchQuery('')
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <MessageSquare size={11} className="shrink-0 text-slate-600" />
                      <span className="truncate">{session.title}</span>
                      <span className="shrink-0 text-[10px] text-slate-600">
                        {session.messages.filter((m) => m.role !== 'system').length} 条
                      </span>
                    </button>
                  )}
                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuSessionId(menuSessionId === session.id ? null : session.id)
                      }}
                      className="rounded p-0.5 text-slate-500 hover:text-slate-300"
                    >
                      <MoreHorizontal size={12} />
                    </button>
                  </div>
                  {/* 下拉菜单 */}
                  {menuSessionId === session.id && (
                    <div className="absolute right-2 z-50 mt-1 rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
                      <button
                        onClick={() => startRename(session)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-slate-300 hover:bg-slate-700"
                      >
                        <Pencil size={11} /> 重命名
                      </button>
                      <button
                        onClick={() => {
                          deleteSession(session.id)
                          setMenuSessionId(null)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-[11px] text-red-400 hover:bg-slate-700"
                      >
                        <Trash2 size={11} /> 删除
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── 消息列表 ── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* 欢迎消息 */}
        {(!activeSession ||
          activeSession.messages.filter((m) => m.role !== 'system').length === 0) && (
          <div className="flex h-full flex-col items-center justify-center p-6">
            <div className="bg-wrench-500/10 mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
              <Brain size={24} className="text-wrench-400" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-slate-300">Wrench AI Agent</h3>
            <p className="mb-4 text-center text-[11px] text-slate-500">
              智能运维助手，通过自然语言控制服务器
            </p>
            <div className="grid w-full max-w-[280px] grid-cols-2 gap-2">
              {[
                { icon: '🔍', label: '分析问题', desc: '诊断服务器异常' },
                { icon: '⚡', label: '生成命令', desc: 'Shell/脚本一键执行' },
                { icon: '📝', label: '解释输出', desc: '解读命令执行结果' },
                { icon: '🛡️', label: '安全检查', desc: '检测潜在风险' },
              ].map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    setInput(`帮我${item.label.replace(/\p{Emoji_Presentation}/gu, '').trim()}...`)
                    inputRef.current?.focus()
                  }}
                  className="hover:border-wrench-500/30 rounded-lg border border-slate-700/50 bg-slate-800/30 p-2.5 text-left transition-colors hover:bg-slate-800/60"
                >
                  <div className="mb-1 text-sm">{item.icon}</div>
                  <div className="text-[11px] font-medium text-slate-300">{item.label}</div>
                  <div className="text-[10px] text-slate-500">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 对话消息 — useMemo 避免每次渲染重新 filter */}
        {visibleMessages.map((msg, i) => (
          <MessageItem
            key={`${activeSessionId}-${i}`}
            msg={msg}
            index={i}
            sessionId={activeSessionId}
            extractCommands={extractCommands}
            onExecute={executeCommand}
          />
        ))}

        {/* 流式输出中 */}
        {isStreaming && (
          <div className="mb-3 flex justify-start">
            <div className="max-w-[92%] px-1">
              {streamingContent ? (
                <AgentMarkdown
                  content={streamingContent}
                  extractCommands={extractCommands}
                  onExecute={executeCommand}
                />
              ) : (
                <div className="flex items-center gap-2 text-[12px] text-slate-500">
                  <Loader2 size={14} className="animate-spin" />
                  AI 正在思考...
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── 输入区 ── */}
      <div className="shrink-0 border-t border-slate-700/50 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要做的操作..."
            rows={1}
            className="focus:border-wrench-500 max-h-[120px] min-h-[44px] flex-1 resize-none rounded-xl border border-slate-700/50 bg-slate-800/50 px-3 py-2.5 text-[13px] text-slate-200 placeholder-slate-500 focus:outline-none"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          {isStreaming ? (
            <button
              onClick={stopGeneration}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30"
              title="停止生成"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="bg-wrench-600 hover:bg-wrench-500 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between px-1">
          <span className="text-[10px] text-slate-600">
            {config.model.split('/').pop()} · Enter 发送，Shift+Enter 换行
          </span>
        </div>
      </div>
    </div>
  )
}
