import type { TerminalSuggestion } from '../../utils/terminal-suggestions'

interface Props {
  suggestions: TerminalSuggestion[]
  selectedIndex: number
  onSelect: (suggestion: TerminalSuggestion) => void
  onClearHistory?: () => void
}

export function TerminalSuggestionPanel({
  suggestions,
  selectedIndex,
  onSelect,
  onClearHistory,
}: Props) {
  if (suggestions.length === 0) return null

  return (
    <div
      data-testid="terminal-suggestion-panel"
      role="listbox"
      aria-label="命令建议"
      className="absolute right-2 bottom-12 left-2 z-20 max-h-52 overflow-y-auto rounded-md border border-slate-700 bg-slate-900/95 p-1 font-mono text-xs shadow-xl backdrop-blur-sm sm:right-3 sm:bottom-3 sm:left-auto sm:w-[min(32rem,calc(100%-1.5rem))]"
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={`${suggestion.source}-${suggestion.command}`}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
            index === selectedIndex
              ? 'bg-sky-500/20 text-sky-100'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
          onPointerDown={(event) => {
            // Keep the xterm hidden textarea focused, especially on touch devices.
            event.preventDefault()
            onSelect(suggestion)
          }}
        >
          <span className="min-w-0 flex-1 truncate">{suggestion.command}</span>
          <span className="shrink-0 text-right text-[10px] text-slate-500">
            {suggestion.risk !== 'safe' && (
              <span
                className={
                  suggestion.risk === 'dangerous' ? 'block text-rose-300' : 'block text-amber-300'
                }
              >
                {suggestion.risk === 'dangerous' ? '危险' : '有副作用'}
              </span>
            )}
            <span className="block">
              {suggestion.category === 'project'
                ? '项目'
                : suggestion.category === 'shell'
                  ? '内置'
                  : '历史'}
            </span>
            <span className="block max-w-44 truncate" title={suggestion.reason}>
              {suggestion.reason}
            </span>
          </span>
        </button>
      ))}
      <div className="px-2 pt-1 text-[10px] text-slate-500">Tab / → 接受 · Esc 关闭</div>
      {onClearHistory && (
        <button
          type="button"
          className="mt-1 w-full border-t border-slate-800 px-2 pt-1 text-left text-[10px] text-slate-500 hover:text-slate-300"
          onPointerDown={(event) => {
            event.preventDefault()
            onClearHistory()
          }}
        >
          清除本地历史
        </button>
      )}
    </div>
  )
}
