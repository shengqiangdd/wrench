import type { RefObject } from 'react'
import { Search, X, ChevronUp, ChevronDown } from 'lucide-react'
import {
  SEARCH_OPTION_META,
  formatMatchCounter,
  type TerminalSearchOptions,
} from '../../utils/terminal-search'

interface Props {
  query: string
  onQueryChange: (q: string) => void
  options: TerminalSearchOptions
  onOptionChange: (key: keyof TerminalSearchOptions, value: boolean) => void
  matchCount: number
  matchIndex: number
  /** 查询非法时的可读提示（目前只有正则解析失败） */
  error: string | null
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
}

/**
 * 终端搜索条 —— SSH 终端与容器终端共用。
 *
 * 相对旧版（只有输入框 + 上/下/关闭）补了三件事：
 * 1. **区分大小写 / 全字匹配 / 正则** 三个开关（xterm SearchAddon 原生支持，之前没用）；
 * 2. **匹配计数**（`3/12`），且用 decorations 把全部匹配高亮出来；
 * 3. **正则是错的就说出来**（`[` 这种半成品之前会让搜索静默失效）。
 */
export function TerminalSearchBar({
  query,
  onQueryChange,
  options,
  onOptionChange,
  matchCount,
  matchIndex,
  error,
  onNext,
  onPrev,
  onClose,
  inputRef,
}: Props) {
  const counter = formatMatchCounter(matchIndex, matchCount, query)
  return (
    <div
      className="absolute right-0 bottom-0 left-0 z-20 border-t border-slate-700/50 bg-slate-900"
      data-testid="terminal-search-bar"
    >
      <div className="flex items-center gap-1 px-2 py-1">
        <Search size={13} className="shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onNext()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="搜索终端内容..."
          className={`flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none placeholder:text-slate-600 ${
            error ? 'ring-1 ring-red-500/60' : ''
          }`}
        />
        {counter && <span className="text-[10px] text-slate-500">{counter}</span>}
        {SEARCH_OPTION_META.map((opt) => {
          const active = options[opt.key]
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onOptionChange(opt.key, !active)}
              title={`${opt.title}（点击${active ? '关闭' : '开启'}）`}
              aria-pressed={active}
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                active
                  ? 'bg-wrench-600/80 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
        <button
          type="button"
          onClick={onPrev}
          disabled={!query.trim()}
          className="btn-icon text-slate-500 hover:text-slate-300 disabled:opacity-30"
          title="上一个 (Shift+Enter)"
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!query.trim()}
          className="btn-icon text-slate-500 hover:text-slate-300 disabled:opacity-30"
          title="下一个 (Enter)"
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="关闭 (Esc)"
        >
          <X size={12} />
        </button>
      </div>
      {error && (
        <div className="px-3 pb-1 text-[10px] text-red-400" data-testid="terminal-search-error">
          {error}
        </div>
      )}
    </div>
  )
}

export default TerminalSearchBar
