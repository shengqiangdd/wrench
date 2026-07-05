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

// OpenRouter 流式 API 调用（支持取消）
async function* streamChat(
  messages: AiMessage[],
  apiKey: string,
  model: string,
  baseUrl: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'SmartBox',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
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

export default function AiSidebar({ sessionId, connectionId, onClose }: Props) {
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
  const [streaming, setStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // 取消流式响应
  const cancelStream = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
    // 如果生成了部分内容，保留已生成的内容
    if (streamingContent.trim()) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamingContent }])
      setStreamingContent('')
    }
  }, [streamingContent])

  // 发送消息
  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const abortController = new AbortController()
    abortRef.current = abortController

    const userMsg: AiMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)
    setStreamingContent('')

    try {
      let fullContent = ''
      const stream = streamChat(
        newMessages,
        aiConfig.apiKey,
        aiConfig.model,
        aiConfig.baseUrl,
        abortController.signal,
      )

      for await (const chunk of stream) {
        // 如果已取消，停止消费流
        if (abortController.signal.aborted) break
        fullContent += chunk
        setStreamingContent(fullContent)
      }

      // 如果未被取消，完整添加消息；如果已取消，上面的 break 已保留已生成内容
      if (!abortController.signal.aborted) {
        setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }])
        setStreamingContent('')
      }
    } catch (err: unknown) {
      // 如果是用户取消的，不报错
      if (err instanceof Error && err.name === 'AbortError') return
      const errMsg = err instanceof Error ? err.message : '请求失败'
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `**错误**: ${errMsg}\n\n请检查 API Key 和网络连接。` },
      ])
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }, [input, messages, streaming, aiConfig])

  // 提取消息中的 bash 命令
  const extractCommands = (content: string): string[] => {
    const matches = content.match(/```bash\n([\s\S]*?)```/g)
    if (!matches) return []
    return matches.map((m) =>
      m
        .replace(/```bash\n/g, '')
        .replace(/```/g, '')
        .trim(),
    )
  }

  // 通过 REST API 执行命令并获取结果，插入到对话中
  const executeCommand = async (cmd: string) => {
    if (!connectionId) return
    // 添加占位消息表示正在执行
    const execId = `exec_${crypto.randomUUID()}`
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: `⏳ 正在执行: \`${cmd}\``,
        _execId: execId,
        _executing: true,
      } as AiMessage,
    ])

    try {
      const res = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, command: cmd }),
      })
      const result = await res.json()

      // 替换占位消息为执行结果
      setMessages((prev) =>
        prev.map((m) => {
          const msg = m as AiMessage
          return msg._execId === execId
            ? ({
                ...msg,
                content: formatExecResult(cmd, result),
                _execResult: { command: cmd, ...(result as Record<string, unknown>) },
              } as AiMessage)
            : m
        }),
      )
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '未知错误'
      setMessages((prev) =>
        prev.map((m) => {
          const msg = m as AiMessage
          return msg._execId === execId
            ? ({ ...msg, role: 'assistant', content: `❌ 执行失败: ${errMsg}` } as AiMessage)
            : m
        }),
      )
    }
  }

  // 发送执行结果给 AI 分析
  const analyzeResult = useCallback((cmd: string, stdout: string, stderr: string) => {
    const prompt = `以下是命令的执行结果，请分析：\n\n命令: ${cmd}\n\n标准输出:\n${stdout || '(无输出)'}\n${stderr ? `\n标准错误:\n${stderr}` : ''}`
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

  // 如果 AI 未启用
  if (!aiConfig.enabled || !aiConfig.apiKey) {
    return (
      <div className="flex h-full w-full flex-col border-l border-slate-700/50 bg-slate-900/80 md:w-96">
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
            <p className="text-sm text-slate-500">AI Agent 未配置</p>
            <p className="mt-1 text-xs text-slate-600">在设置中填写 API Key 并启用 AI Agent</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col border-l border-slate-700/50 bg-slate-900/80 md:w-96">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <Brain size={14} className="text-smartbox-400" />
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
                  ? 'bg-smartbox-600/20 border-smartbox-600/30 border text-slate-200'
                  : 'border border-slate-700/30 bg-slate-800/50 text-slate-300'
              }`}
            >
              {/* 消息内容 */}
              <div className="break-words whitespace-pre-wrap">
                {renderMessageContent(
                  msg.content,
                  extractCommands,
                  copyCommand,
                  executeCommand,
                  copiedCmd,
                )}
              </div>
              {/* 执行结果：添加「发送给 AI 分析」按钮 */}
              {'_execResult' in msg && !msg._executing && msg._execResult && (
                <button
                  onClick={() => {
                    const r = msg._execResult
                    if (!r) return
                    analyzeResult(r.command, r.stdout || '', r.stderr || '')
                  }}
                  className="text-smartbox-400 hover:bg-smartbox-500/10 border-smartbox-500/20 mt-2 flex items-center gap-1 rounded border px-2 py-1 text-[10px]"
                >
                  <Brain size={10} /> 发送给 AI 分析
                </button>
              )}
            </div>
          </div>
        ))}

        {/* 流式输出 */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg border border-slate-700/30 bg-slate-800/50 px-3 py-2 text-xs text-slate-300">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <Loader2 size={10} className="animate-spin" />
                  生成中...
                </div>
                <button
                  onClick={cancelStream}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-500/10"
                  title="停止生成"
                >
                  <X size={10} /> 停止
                </button>
              </div>
              <div className="break-words whitespace-pre-wrap">
                {renderMessageContent(
                  streamingContent,
                  extractCommands,
                  copyCommand,
                  executeCommand,
                  copiedCmd,
                )}
              </div>
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
            placeholder={sessionId ? '描述你想要做的操作...' : '先连接 SSH...'}
            disabled={streaming || !sessionId}
            rows={2}
            className="input flex-1 resize-none py-2 text-xs"
            style={{ minHeight: '36px', maxHeight: '120px' }}
          />
          {streaming ? (
            <button
              onClick={cancelStream}
              className="btn-danger flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-0"
              title="停止生成"
            >
              <X size={14} />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim() || !sessionId}
              className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-0 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        <p className="mt-1 text-[10px] text-slate-600">Enter 发送 · Shift+Enter 换行</p>
      </div>
    </div>
  )
}

// 格式化命令执行结果为可读文本
function formatExecResult(
  cmd: string,
  result: { stdout?: string; stderr?: string; exitCode?: number; error?: string },
): string {
  if (result.error) {
    return `❌ 执行失败: ${result.error}`
  }
  const parts: string[] = []
  if (result.stdout?.trim()) parts.push(result.stdout.trim())
  if (result.stderr?.trim()) parts.push(`[stderr] ${result.stderr.trim()}`)
  const output = parts.join('\n') || '(无输出)'
  return `✅ \`${cmd}\` 执行完成 (exit: ${result.exitCode ?? '?'})\n\`\`\`\n${output}\n\`\`\``
}

// 渲染消息内容（支持代码块和命令按钮）
function renderMessageContent(
  content: string,
  extractCommands: (c: string) => string[],
  copyCommand: (c: string) => void,
  executeCommand: (c: string) => void,
  copiedCmd: string | null,
) {
  const commands = extractCommands(content)

  // 如果有命令，分段渲染
  if (commands.length > 0) {
    const parts = content.split(/```bash[\s\S]*?```/)
    const elements: React.ReactNode[] = []

    commands.forEach((cmd, idx) => {
      // 命令之前的文本
      if (parts[idx]?.trim()) {
        elements.push(
          <p key={`text-${idx}`} className="mb-1">
            {parts[idx]}
          </p>,
        )
      }

      // 命令块
      elements.push(
        <div
          key={`cmd-${idx}`}
          className="my-1.5 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/80"
        >
          <div className="flex items-center justify-between bg-slate-800/50 px-2 py-1">
            <span className="flex items-center gap-1 text-[10px] text-slate-500">
              <Terminal size={10} /> bash
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => executeCommand(cmd)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-500/10"
                title="在终端执行"
              >
                ▶ 执行
              </button>
              <button
                onClick={() => copyCommand(cmd)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700"
                title="复制命令"
              >
                {copiedCmd === cmd ? <Check size={10} /> : <Copy size={10} />}
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto p-2 font-mono text-[11px] leading-relaxed text-slate-200">
            <code>{cmd}</code>
          </pre>
        </div>,
      )
    })

    // 剩余文本
    if (parts[commands.length]?.trim()) {
      elements.push(
        <p key="text-last" className="mt-1">
          {parts[commands.length]}
        </p>,
      )
    }

    return <>{elements}</>
  }

  // 无命令：普通文本渲染
  return <p>{content}</p>
}
