import type { TerminalPrefs } from './terminal-prefs'

/** 终端搜索选项（对应 xterm SearchAddon 的三个开关） */
export interface TerminalSearchOptions {
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
}

export const DEFAULT_SEARCH_OPTIONS: TerminalSearchOptions = {
  caseSensitive: false,
  regex: false,
  wholeWord: false,
}

/** 三个开关的展示元数据（搜索条按此渲染，避免 UI 与语义漂移） */
export const SEARCH_OPTION_META: {
  key: keyof TerminalSearchOptions
  label: string
  title: string
}[] = [
  { key: 'caseSensitive', label: 'Aa', title: '区分大小写' },
  { key: 'wholeWord', label: '|ab|', title: '全字匹配' },
  { key: 'regex', label: '.*', title: '正则表达式' },
]

/**
 * 传给 `SearchAddon.findNext/findPrevious` 的选项。
 *
 * 装饰（highlight 全部匹配）用固定色：xterm 要求 `#RRGGBB`，
 * 与终端主题的蓝/青系一致；带 decorations 才会触发 `onDidChangeResults`（匹配计数）。
 */
export function toXtermSearchOptions(options: TerminalSearchOptions, incremental: boolean) {
  return {
    caseSensitive: options.caseSensitive,
    regex: options.regex,
    wholeWord: options.wholeWord,
    incremental,
    decorations: {
      matchBackground: '#1e3a5f',
      matchBorder: '#3b82f6',
      matchOverviewRuler: '#3b82f6',
      activeMatchBackground: '#f59e0b',
      activeMatchBorder: '#fbbf24',
      activeMatchColorOverviewRuler: '#f59e0b',
    },
  }
}

/**
 * 正则是否可用。用户输入 `[` 这种半成品正则时不能把异常抛到 xterm 里
 * （会让搜索静默失效），要给出可读的提示。
 */
export function validateSearchQuery(query: string, options: TerminalSearchOptions): string | null {
  if (!query) return null
  if (!options.regex) return null
  try {
    new RegExp(query)
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return `正则表达式不合法：${msg}`
  }
}

/** 匹配计数文案：`3/12`；无匹配时 `0/0`；未输入时为空 */
export function formatMatchCounter(matchIndex: number, matchCount: number, query: string): string {
  if (!query.trim()) return ''
  if (matchCount <= 0) return '0/0'
  return `${matchIndex + 1}/${matchCount}`
}

/** 字号缩放文案（用户按 Ctrl± 时给一条轻提示） */
export function formatFontSizeHint(prefs: TerminalPrefs): string {
  return `终端字号 ${prefs.fontSize}px（Ctrl/⌘ + 0 复位）`
}
