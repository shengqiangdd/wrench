import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_OPTIONS,
  SEARCH_OPTION_META,
  formatFontSizeHint,
  formatMatchCounter,
  toXtermSearchOptions,
  validateSearchQuery,
} from '../../utils/terminal-search'
import { DEFAULT_TERMINAL_PREFS } from '../../utils/terminal-prefs'

describe('validateSearchQuery', () => {
  it('空查询不报错', () => {
    expect(validateSearchQuery('', { ...DEFAULT_SEARCH_OPTIONS, regex: true })).toBeNull()
  })

  it('非正则模式下，任何字符串都合法（按字面量搜）', () => {
    expect(validateSearchQuery('a[', DEFAULT_SEARCH_OPTIONS)).toBeNull()
  })

  it('正则模式：合法正则通过', () => {
    expect(validateSearchQuery('\\d{2,4}', { ...DEFAULT_SEARCH_OPTIONS, regex: true })).toBeNull()
  })

  it('正则模式：半成品正则给出可读错误（而不是静默失效）', () => {
    const msg = validateSearchQuery('a[', { ...DEFAULT_SEARCH_OPTIONS, regex: true })
    expect(msg).toBeTruthy()
    expect(msg).toContain('正则表达式不合法')
  })
})

describe('toXtermSearchOptions', () => {
  it('三个开关透传，且带 decorations（否则拿不到匹配计数）', () => {
    const opts = toXtermSearchOptions({ caseSensitive: true, regex: true, wholeWord: true }, false)
    expect(opts.caseSensitive).toBe(true)
    expect(opts.regex).toBe(true)
    expect(opts.wholeWord).toBe(true)
    expect(opts.incremental).toBe(false)
    expect(opts.decorations?.matchBackground).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(opts.decorations?.activeMatchBackground).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('incremental 透传（边打边搜时为 true）', () => {
    expect(toXtermSearchOptions(DEFAULT_SEARCH_OPTIONS, true).incremental).toBe(true)
  })
})

describe('formatMatchCounter', () => {
  it('没输入就不显示计数', () => {
    expect(formatMatchCounter(0, 0, '')).toBe('')
    expect(formatMatchCounter(0, 0, '   ')).toBe('')
  })

  it('有输入但没匹配 → 0/0', () => {
    expect(formatMatchCounter(0, 0, 'zzz')).toBe('0/0')
  })

  it('命中 → 当前位置/总数（下标从 0 起，展示从 1 起）', () => {
    expect(formatMatchCounter(0, 12, 'x')).toBe('1/12')
    expect(formatMatchCounter(4, 12, 'x')).toBe('5/12')
  })
})

describe('formatFontSizeHint', () => {
  it('提示里带上当前字号与复位键', () => {
    const hint = formatFontSizeHint({ ...DEFAULT_TERMINAL_PREFS, fontSize: 16 })
    expect(hint).toContain('16px')
    expect(hint).toContain('0')
  })
})

describe('SEARCH_OPTION_META', () => {
  it('三个开关都有中文说明（搜索条标题不会漏）', () => {
    expect(SEARCH_OPTION_META.map((o) => o.key)).toEqual(['caseSensitive', 'wholeWord', 'regex'])
    for (const opt of SEARCH_OPTION_META) expect(opt.title.length).toBeGreaterThan(0)
  })
})
