/**
 * AgentMarkdown.tsx
 *
 * 智能 Markdown 渲染组件 — 基于 react-markdown + remark-gfm。
 *
 * 支持：表格、引用块、任务列表、删除线、代码块语法高亮、一键复制/执行。
 */

import { memo, useCallback, useState, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Check, Play, Terminal } from 'lucide-react'

interface Props {
  content: string
  /** 提取可执行命令（可选） */
  extractCommands?: (text: string) => string[]
  /** 执行命令回调 */
  onExecute?: (cmd: string) => void
}

/** 语言显示名映射 */
const LANG_LABELS: Record<string, string> = {
  bash: 'Bash',
  sh: 'Shell',
  shell: 'Shell',
  zsh: 'Zsh',
  python: 'Python',
  py: 'Python',
  javascript: 'JavaScript',
  js: 'JavaScript',
  typescript: 'TypeScript',
  ts: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  lua: 'Lua',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
}

/** 可执行的 shell 语言 */
const EXECUTABLE_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'shell-session'])

function AgentMarkdown({ content, onExecute }: Props) {
  return (
    <div className="prose-agent">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const lang = match?.[1] || ''
            const codeString = String(children).replace(/\n$/, '')

            // 行内代码
            if (!className && !codeString.includes('\n')) {
              return (
                <code
                  className="text-wrench-300 rounded bg-slate-700/50 px-1.5 py-0.5 font-mono text-[12px]"
                  {...props}
                >
                  {children}
                </code>
              )
            }

            // 代码块
            return <CodeBlock language={lang} code={codeString} onExecute={onExecute} />
          },
          // 表格
          table({ children }) {
            return (
              <div className="my-2 overflow-x-auto rounded-lg border border-slate-700/50">
                <table className="w-full text-[12px]">{children}</table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-slate-800/60">{children}</thead>
          },
          th({ children }) {
            return (
              <th className="border-b border-slate-700/50 px-3 py-1.5 text-left font-medium text-slate-300">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="border-b border-slate-700/30 px-3 py-1.5 text-slate-400">
                {children}
              </td>
            )
          },
          // 引用块
          blockquote({ children }) {
            return (
              <blockquote className="border-wrench-500/50 bg-wrench-500/5 my-2 border-l-3 py-1 pl-3 text-[13px] text-slate-400 italic">
                {children}
              </blockquote>
            )
          },
          // 任务列表
          input({ checked, ...props }) {
            return (
              <input
                type="checkbox"
                checked={checked}
                readOnly
                className="accent-wrench-500 mr-1.5"
                {...props}
              />
            )
          },
          // 链接
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-wrench-400 decoration-wrench-400/30 hover:decoration-wrench-400 underline"
              >
                {children}
              </a>
            )
          },
          // 水平线
          hr() {
            return <hr className="my-3 border-slate-700/50" />
          },
          // 标题
          h1({ children }) {
            return <h1 className="mt-4 mb-2 text-base font-bold text-white">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="mt-3 mb-1.5 text-sm font-bold text-white">{children}</h2>
          },
          h3({ children }) {
            return (
              <h3 className="mt-2 mb-1 text-[13px] font-semibold text-slate-200">{children}</h3>
            )
          },
          h4({ children }) {
            return (
              <h4 className="mt-2 mb-1 text-[12px] font-semibold text-slate-300">{children}</h4>
            )
          },
          // 列表
          ul({ children }) {
            return (
              <ul className="my-1 list-disc space-y-0.5 pl-5 text-[13px] text-slate-400">
                {children}
              </ul>
            )
          },
          ol({ children }) {
            return (
              <ol className="my-1 list-decimal space-y-0.5 pl-5 text-[13px] text-slate-400">
                {children}
              </ol>
            )
          },
          li({ children }) {
            return <li className="leading-relaxed">{children}</li>
          },
          // 段落
          p({ children }) {
            return <p className="my-1.5 text-[13px] leading-relaxed text-slate-400">{children}</p>
          },
          // 删除线
          del({ children }) {
            return <del className="text-slate-500">{children}</del>
          },
          // 强调
          strong({ children }) {
            return <strong className="font-semibold text-slate-200">{children}</strong>
          },
          em({ children }) {
            return <em className="text-slate-300">{children}</em>
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}

export default memo(AgentMarkdown)

// ─── 代码块组件 ───

/** 超过此行数的代码块跳过语法高亮，直接用 <pre> 渲染 */
const CODE_BLOCK_LINE_THRESHOLD = 80

function CodeBlock({
  language,
  code,
  onExecute,
}: {
  language: string
  code: string
  onExecute?: (cmd: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const isExecutable = EXECUTABLE_LANGS.has(language.toLowerCase())
  const langLabel = LANG_LABELS[language.toLowerCase()] || language || 'text'

  // 统计行数，超长时跳过高亮
  const lineCount = useMemo(() => code.split('\n').length, [code])
  const useHighlight = lineCount <= CODE_BLOCK_LINE_THRESHOLD

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {
        // fallback
        const ta = document.createElement('textarea')
        ta.value = code
        ta.style.cssText = 'position:fixed;left:-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
    )
  }, [code])

  const handleExecute = useCallback(() => {
    onExecute?.(code)
  }, [code, onExecute])

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-950/80">
      {/* 头部栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-800/50 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Terminal size={12} className="text-wrench-400" />
          {langLabel}
          {!useHighlight && <span className="text-slate-600">({lineCount} 行)</span>}
        </span>
        <div className="flex items-center gap-2">
          {isExecutable && onExecute && (
            <button
              onClick={handleExecute}
              className="flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300"
              title="在终端执行"
            >
              <Play size={10} />
              执行
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      {/* 代码内容 */}
      <div className="overflow-x-auto">
        {useHighlight ? (
          <SyntaxHighlighter
            language={language || 'text'}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '12px',
              background: 'transparent',
              fontSize: '12px',
              lineHeight: '1.6',
            }}
            wrapLongLines
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <pre className="m-0 p-3 text-[12px] leading-[1.6] text-slate-300">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
