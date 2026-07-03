import { X, Copy, Check, Trash2, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { CommandResult } from './useCommands'

interface CommandOutputProps {
  results: CommandResult[]
  onClose: (index: number) => void
  onClear: () => void
  onSendToTerminal: (cmd: string) => void
  onPanelClose?: () => void
}

export default function CommandOutput({
  results,
  onClose,
  onClear,
  onSendToTerminal,
  onPanelClose,
}: CommandOutputProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

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
        <span className="text-xs font-medium text-slate-400">执行记录</span>
        <div className="flex items-center gap-1">
          {onPanelClose && (
            <button
              onClick={onPanelClose}
              className="flex min-h-[44px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-slate-500 transition-colors hover:text-slate-300 md:hidden"
            >
              <X size={12} /> 关闭
            </button>
          )}
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
        {results.map((result, idx) => (
          <div key={idx} className="border-b border-slate-800/50 px-3 py-2">
            {/* 命令头 */}
            <div className="mb-1 flex items-center gap-2">
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                  result.exitCode === 0 ? 'bg-emerald-500' : 'bg-red-500'
                }`}
              />
              <code className="truncate font-mono text-[11px] font-medium text-slate-300">
                {result.command}
              </code>
              <span className="shrink-0 text-[9px] text-slate-600">
                exit: {result.exitCode ?? '?'}
              </span>
              <button
                onClick={() => handleCopy(result.stdout + result.stderr, idx)}
                className="ml-auto shrink-0 rounded p-0.5 text-slate-600 transition-colors hover:bg-slate-700/50 hover:text-slate-300"
                title="复制输出"
              >
                {copiedIdx === idx ? (
                  <Check size={11} className="text-emerald-400" />
                ) : (
                  <Copy size={11} />
                )}
              </button>
              <button
                onClick={() => onSendToTerminal(result.command)}
                className="shrink-0 rounded p-0.5 text-slate-600 transition-colors hover:bg-violet-600/20 hover:text-violet-400"
                title="发送命令到终端"
              >
                <Terminal size={11} />
              </button>
              <button
                onClick={() => onClose(idx)}
                className="shrink-0 rounded p-0.5 text-slate-600 transition-colors hover:bg-red-900/20 hover:text-red-400"
                title="关闭"
              >
                <X size={11} />
              </button>
            </div>

            {/* 输出内容 */}
            <pre className="max-h-64 overflow-auto rounded bg-slate-900/80 p-2 font-mono text-[10px] leading-relaxed text-slate-400">
              {result.stdout && <span className="text-slate-400">{result.stdout}</span>}
              {result.stderr && <span className="text-red-400">{result.stderr}</span>}
              {!result.stdout && !result.stderr && (
                <span className="text-slate-600">（无输出）</span>
              )}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}
