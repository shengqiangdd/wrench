import { X, Copy, Check, Trash2, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { CommandResult } from './useCommands'

interface CommandOutputProps {
  results: CommandResult[]
  onClose: (index: number) => void
  onClear: () => void
  onSendToTerminal: (cmd: string) => void
}

export default function CommandOutput({
  results,
  onClose,
  onClear,
  onSendToTerminal,
}: CommandOutputProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 2000)
    } catch {}
  }

  if (results.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
        <Terminal size={32} className="text-slate-600" />
        <p className="text-xs">暂无执行记录</p>
        <p className="text-[10px] text-slate-600">点击命令旁的 ▶ 执行</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-700/30 px-3 py-1.5">
        <span className="text-xs font-medium text-slate-400">
          执行记录
          <span className="ml-1 text-[10px] text-slate-600">({results.length})</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onClear}
            className="flex min-h-[44px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:bg-red-900/20 hover:text-red-400"
          >
            <Trash2 size={11} /> 清空
          </button>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="flex-1 overflow-y-auto">
        {results.map((result, idx) => {
          const isExpanded = expandedIdx === idx
          const hasOutput = result.stdout || result.stderr

          return (
            <div key={idx} className="border-b border-slate-800/50 px-3 py-2">
              {/* 命令头 */}
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                    result.exitCode === 0 ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                />
                <button
                  onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  className="min-w-0 flex-1 text-left"
                >
                  <code className="block truncate font-mono text-[11px] font-medium text-slate-300">
                    {result.command}
                  </code>
                </button>
                <span className="shrink-0 text-[9px] text-slate-600">
                  exit: {result.exitCode ?? '?'}
                </span>
                <button
                  onClick={() => handleCopy(result.stdout + result.stderr, idx)}
                  className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                  title="复制输出"
                >
                  {copiedIdx === idx ? (
                    <Check size={12} className="text-emerald-400" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
                <button
                  onClick={() => onClose(idx)}
                  className="shrink-0 rounded p-1 text-slate-500 transition-colors hover:bg-red-900/20 hover:text-red-400"
                  title="删除记录"
                >
                  <X size={12} />
                </button>
              </div>

              {/* 输出内容（展开时显示） */}
              {isExpanded && hasOutput && (
                <div className="mt-2 rounded-md bg-slate-950/50 p-2">
                  {result.stdout && (
                    <pre className="max-h-60 overflow-auto font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">
                      {result.stdout}
                    </pre>
                  )}
                  {result.stderr && (
                    <pre className="mt-1 max-h-40 overflow-auto font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-red-400/80">
                      {result.stderr}
                    </pre>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => onSendToTerminal(result.command)}
                      className="flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
                    >
                      <Terminal size={10} /> 再次执行
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
