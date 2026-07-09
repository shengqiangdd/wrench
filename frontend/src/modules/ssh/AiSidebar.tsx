/**
 * AiSidebar.tsx
 *
 * AI Agent 侧边栏。用于与 AI 对话，通过自然语言控制 SSH 主机。
 * 支持流式输出、命令推荐、一键执行。
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { Brain, Send, Terminal, Loader2, X, Sparkles, Copy, Check, Trash2 } from 'lucide-react'
import { useAiStore } from '../../stores/ai-store'
import type { AiMessage } from '../../types/ai'

interface Props {
  sessionId: string | null
  /** SSH 连接 ID，用于通过 REST API 执行命令 */
  connectionId: string | null
  onClose: () => void
}

// 通过后端代理调用 LLM API（支持取消）
// 后端会自动使用服务端的 OPENROUTER_API_KEY，前端不需要自己填 Key
async function* streamChat(
  messages: AiMessage[],
  apiKey: string,
  model: string,
  baseUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const res = await fetch('/api/ai/chat', {
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

/**
 * 渲染 Markdown 内容（简化版，支持常用语法）
 */
function renderMarkdown(
  text: string,
  extractCommands: (text: string) => string[],
  copyCommand: (cmd: string) => void,
  executeCommand: (cmd: string) => void,
  copiedCmd: string | null,
) {
  // 先提取代码块
  const parts: React.ReactNode[] = []
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // 代码块前的文本
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {renderInlineMarkdown(text.slice(lastIndex, match.index))}
        </span>,
      )
    }

    const lang = match[1] || 'bash'
    const code = match[2]!.trim()
    const isCopied = copiedCmd === code

    parts.push(
      <div
        key={`code-${match.index}`}
        className="my-2 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-950/80"
      >
        {/* 代码块头部 */}
        <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-800/50 px-3 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Terminal size={12} className="text-wrench-400" />
            {lang}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => executeCommand(code)}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
            >
              <span className="text-xs">▶</span> 执行
            </button>
            <button
              onClick={() => copyCommand(code)}
              className="text-slate-500 hover:text-slate-300"
            >
              {isCopied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            </button>
          </div>
        </div>
        {/* 代码内容 */}
        <div className="overflow-x-auto p-3">
          <code className="font-mono text-[12px] leading-relaxed text-slate-300">{code}</code>
        </div>
      </div>,
    )
    lastIndex = match.index + match[0].length
  }

  // 剩余文本
  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{renderInlineMarkdown(text.slice(lastIndex))}</span>)
  }

  return parts.length > 0 ? parts : renderInlineMarkdown(text)
}

/**
 * 渲染行内 Markdown（粗体、行内代码、列表）
 */
function renderInlineMarkdown(text: string) {
  // 按行分割处理
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // 标题 (### Header)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const cls =
        level === 1
          ? 'text-base font-bold text-white mt-4 mb-2'
          : level === 2
            ? 'text-sm font-bold text-white mt-3 mb-1.5'
            : 'text-[13px] font-semibold text-slate-200 mt-2 mb-1'
      elements.push(
        <div key={`h-${i}`} className={cls}>
          {renderInline(headingMatch[2]!)}
        </div>,
      )
      continue
    }

    // 无序列表
    const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)$/)
    if (bulletMatch) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-1.5 py-0.5 pl-2">
          <span className="text-wrench-400 mt-px">•</span>
          <span className="flex-1">{renderInline(bulletMatch[1]!)}</span>
        </div>,
      )
      continue
    }

    // 有序列表
    const olMatch = line.match(/^[\s]*(\d+)[.)]\s+(.+)$/)
    if (olMatch) {
      elements.push(
        <div key={`ol-${i}`} className="flex gap-1.5 py-0.5 pl-2">
          <span className="text-wrench-400 min-w-[16px] text-right">{olMatch[1]}.</span>
          <span className="flex-1">{renderInline(olMatch[2]!)}</span>
        </div>,
      )
      continue
    }

    // 空行
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="h-2" />)
      continue
    }

    // 普通文本
    elements.push(
      <div key={`p-${i}`} className="py-0.5">
        {renderInline(line)}
      </div>,
    )
  }

  return elements
}

/**
 * 渲染行内格式（粗体、行内代码、链接）
 */
function renderInline(text: string) {
  const parts: React.ReactNode[] = []
  // 匹配: **粗体** `行内代码` [链接](url)
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
  let lastIdx = 0
  let m: RegExpExecArray | null

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index))
    }

    if (m[2]) {
      // **粗体**
      parts.push(
        <strong key={`b-${m.index}`} className="font-semibold text-white">
          {m[2]}
        </strong>,
      )
    } else if (m[4]) {
      // `行内代码`
      parts.push(
        <code
          key={`c-${m.index}`}
          className="text-wrench-300 rounded bg-slate-700/50 px-1 py-0.5 font-mono text-[11px]"
        >
          {m[4]}
        </code>,
      )
    } else if (m[6] && m[7]) {
      // [链接](url)
      parts.push(
        <a
          key={`a-${m.index}`}
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-wrench-400 decoration-wrench-400/30 hover:decoration-wrench-400 underline"
        >
          {m[6]}
        </a>,
      )
    }

    lastIdx = m.index + m[0].length
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx))
  }

  return parts.length > 0 ? parts : text
}

export default function AiSidebar({ sessionId: _sessionId, connectionId, onClose }: Props) {
  const aiConfig = useAiStore((s) => s.config)
  const abortRef = useRef<AbortController | null>(null)
  const [messages, setMessages] = useState<AiMessage[]>([
    {
      role: 'system',
      content: `你是一个专业的 Linux 服务器运维助手。用户通过 SSH 连接到一台服务器，你可以：

1. **分析问题**：根据用户的描述分析服务器问题
2. **推荐命令**：给出需要执行的 Shell 命令
3. **解释输出**：解释命令执行结果

重要规则：
- 命令用 \\\`\\\`\\\`bash 代码块包裹，方便用户一键复制
- 需要执行命令时先解释命令的作用，再提供命令
- 保持回答简洁专业
- 涉及危险操作（rm -rf、dd、格式化等）必须加警告
- 对于复杂操作，分步骤说明

当前连接的服务器信息已就绪。`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 从消息中提取可执行的 Shell 命令
  const extractCommands = useCallback((content: string): string[] => {
    const codeBlockRegex = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g
    const commands: string[] = []
    let match: RegExpExecArray | null
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const code = match[1]!.trim()
      if (code) commands.push(code)
    }
    return commands
  }, [])

  // 执行命令（通过 REST API）
  const executeCommand = useCallback(
    async (cmd: string) => {
      if (!connectionId) {
        alert('请先连接到 SSH 服务器')
        return
      }

      // 标记消息为执行中
      setMessages((prev) =>
        prev.map((m, i) =>
          i === prev.length - 1 && m.role === 'assistant'
            ? { ...m, _executing: true, _execResult: undefined }
            : m,
        ),
      )

      try {
        const res = await fetch(`/api/ssh/exec?connection_id=${connectionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd }),
        })

        const data = await res.json()

        if (res.ok) {
          const resultText = data.stdout || data.stderr || '(无输出)'
          setMessages((prev) => {
            const newMessages = [
              ...prev.slice(0, -1),
              {
                ...prev[prev.length - 1]!,
                _executing: false,
                _execResult: resultText,
              } as AiMessage,
            ]
            return newMessages
          })
        } else {
          const errMsg = data.error || '执行失败'
          setMessages((prev) => [
            ...prev.slice(0, -1),
            { ...prev[prev.length - 1]!, _executing: false } as AiMessage,
            { role: 'user', content: `❌ 执行失败: ${errMsg}` },
          ])
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : '网络错误'
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === 'assistant'
              ? ({ ...m, role: 'assistant', content: `❌ 执行失败: ${errMsg}` } as AiMessage)
              : m,
          ),
        )
      }
    },
    [connectionId],
  )

  // 发送执行结果给 AI 分析
  const analyzeResult = useCallback((cmd: string, stdout: string, _stderr: string) => {
    const prompt = `以下是命令的执行结果，请分析：\n\n命令: ${cmd}\n\n标准输出:\n${stdout || '(无输出)'}`
    setInput(prompt)
    inputRef.current?.focus()
  }, [])

  // 复制命令
  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd)
    setCopiedCmd(cmd)
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  // 清除对话
  const clearChat = () => {
    if (messages.length <= 1) return
    setMessages([messages[0]!]) // 保留 system prompt
  }

  // 发送消息
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMessage: AiMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      let assistantContent = ''
      const stream = streamChat(
        newMessages,
        aiConfig.apiKey || '',
        aiConfig.model,
        aiConfig.baseUrl || 'https://openrouter.ai/api/v1',
        controller.signal,
      )

      for await (const chunk of stream) {
        assistantContent += chunk
        setMessages((prev) => {
          const updated = [...prev]
          const lastMsg = updated[updated.length - 1]
          if (lastMsg?.role === 'assistant') {
            updated[updated.length - 1] = { ...lastMsg, content: assistantContent }
          } else {
            updated.push({ role: 'assistant', content: assistantContent })
          }
          return updated
        })
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户取消
      } else {
        const errMsg = err instanceof Error ? err.message : '未知错误'
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `❌ AI 请求失败: ${errMsg}` },
        ])
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [input, loading, messages, aiConfig])

  // 如果 AI 未启用
  if (!aiConfig.enabled) {
    return (
      <div className="flex flex-1 flex-col border-l border-slate-700/50 bg-slate-900/80 md:w-96">
        <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
            <Brain size={14} />
            AI Agent
          </span>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="text-center">
            <Sparkles size={32} className="mx-auto mb-3 text-slate-600" />
            <p className="text-sm text-slate-500">AI Agent 未启用</p>
            <p className="mt-1 text-xs text-slate-600">在设置中开启 AI Agent 即可使用</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col border-l border-slate-700/50 bg-slate-900/80 md:w-96">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <Brain size={14} className="text-wrench-400" />
          AI Agent
          <span className="ml-1 text-[10px] text-slate-600">{aiConfig.model.split('/').pop()}</span>
        </span>
        <div className="flex items-center gap-1">
          {messages.length > 1 && (
            <button
              onClick={clearChat}
              className="btn-icon text-slate-500 hover:text-red-400"
              title="清除对话"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* 欢迎消息 */}
        {messages.length === 1 && (
          <div className="rounded-lg border border-slate-700/30 bg-slate-800/30 p-3 text-xs text-slate-500">
            <p className="mb-1 flex items-center gap-1.5 text-slate-400">
              <Sparkles size={14} /> 你好！我是你的 AI 运维助手
            </p>
            <p className="mt-1">我可以帮你：</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>分析服务器问题</li>
              <li>生成 Shell 命令</li>
              <li>解释系统输出</li>
              <li>编写脚本和配置</li>
            </ul>
            <p className="mt-1 text-[10px] text-slate-600">
              输入你的问题，我会给出建议和可执行的命令 👇
            </p>
          </div>
        )}

        {/* 对话消息 */}
        {messages.slice(1).map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-xs ${
                msg.role === 'user'
                  ? 'bg-wrench-600/20 border-wrench-600/30 border text-slate-200'
                  : 'border border-slate-700/30 bg-slate-800/50 text-slate-300'
              }`}
            >
              {/* 消息内容 */}
              <div className="break-words whitespace-pre-wrap">
                {msg.role === 'assistant'
                  ? renderMarkdown(
                      msg.content,
                      extractCommands,
                      copyCommand,
                      executeCommand,
                      copiedCmd,
                    )
                  : msg.content}
              </div>
              {/* 执行结果：添加「发送给 AI 分析」按钮 */}
              {'_execResult' in msg && !msg._executing && msg._execResult && (
                <button
                  onClick={() => {
                    const cmd = extractCommands(msg.content).pop() || ''
                    const execResult = (msg as { _execResult?: string })._execResult || ''
                    analyzeResult(cmd, execResult, '')
                  }}
                  className="border-wrench-600/30 bg-wrench-600/10 text-wrench-400 hover:bg-wrench-600/20 mt-2 flex items-center gap-1 rounded border px-2 py-1 text-[11px]"
                >
                  <Send size={10} /> 发送给 AI 分析
                </button>
              )}
            </div>
          </div>
        ))}

        {/* 加载状态 */}
        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/30 bg-slate-800/50 px-3 py-2 text-xs text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              AI 正在思考...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="border-t border-slate-700/50 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendMessage()
              }
            }}
            placeholder="描述你想要做的操作..."
            rows={1}
            className="focus:border-wrench-500 flex-1 resize-none rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="bg-wrench-600 hover:bg-wrench-500 flex h-8 w-8 items-center justify-center rounded-lg text-white disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}
