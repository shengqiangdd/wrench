import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchAddon } from '@xterm/addon-search'
import {
  DEFAULT_SEARCH_OPTIONS,
  toXtermSearchOptions,
  validateSearchQuery,
  type TerminalSearchOptions,
} from '../utils/terminal-search'

/**
 * 终端搜索状态机 —— SSH 终端与容器终端共用。
 *
 * 抽出来的原因：搜索是"每个终端都该有"的能力，之前只有 SSH 终端有，而且是散在
 * 组件里的 5 个 state + 一段 window 级 keydown。这里把"打开/关闭、查询、三个开关、
 * 匹配计数、上/下一个"收成一处，两个终端各自只负责把搜索条渲染出来。
 *
 * 两条实现纪律（都是本项目 ESLint 里 React Compiler 规则强制的）：
 * 1. 渲染期不写 ref —— 需要给 window 级快捷键回调用的"最新值"一律在 effect 里同步；
 * 2. effect 里不直接 setState —— "没有匹配/查询清空"这类重置放在**事件处理器**里做
 *    （输入变化时先归零），effect 只负责命令式地驱动 addon，计数一律由
 *    `onDidChangeResults` 回调带回来。
 *
 * @param getAddon     取当前终端的 SearchAddon（未就绪时返回 null）
 * @param onOpenChange 面板开合回调（画布需要知道搜索是否占用了屏幕）
 */
export function useTerminalSearch(
  getAddon: () => SearchAddon | null,
  onOpenChange?: (open: boolean) => void,
) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<TerminalSearchOptions>(DEFAULT_SEARCH_OPTIONS)
  const [matchCount, setMatchCount] = useState(0)
  const [matchIndex, setMatchIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // window 级快捷键回调要读到最新值，而它是在 effect 里注册的（闭包会过期）
  const openRef = useRef(false)
  const onOpenChangeRef = useRef(onOpenChange)
  const errorRef = useRef<string | null>(null)
  useEffect(() => {
    openRef.current = open
  }, [open])
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  const error = validateSearchQuery(query, options)
  useEffect(() => {
    errorRef.current = error
  }, [error])

  /** 真正调用 addon 的搜索；返回是否命中。只从事件处理器调用（见文件头纪律 2） */
  const runSearch = useCallback(
    (dir: 'next' | 'prev', incremental: boolean): boolean => {
      const addon = getAddon()
      if (!addon) return false
      if (errorRef.current || !query.trim()) {
        try {
          addon.clearDecorations()
        } catch {
          /* addon 未激活 */
        }
        setMatchCount(0)
        setMatchIndex(0)
        return false
      }
      try {
        const opts = toXtermSearchOptions(options, incremental)
        const hit = dir === 'prev' ? addon.findPrevious(query, opts) : addon.findNext(query, opts)
        if (!hit) {
          setMatchCount(0)
          setMatchIndex(0)
        }
        return hit
      } catch {
        // 正则里出现非法结构时 addon 会抛（例如刚敲到一半的 `[`）
        setMatchCount(0)
        setMatchIndex(0)
        return false
      }
    },
    [getAddon, options, query],
  )

  const openSearch = useCallback(() => {
    setOpen(true)
    // 等面板挂载后再聚焦（否则 ref 还是 null）
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  const closeSearch = useCallback(() => {
    setOpen(false)
    try {
      getAddon()?.clearDecorations()
    } catch {
      /* ignore */
    }
    setMatchCount(0)
    setMatchIndex(0)
  }, [getAddon])

  const toggleSearch = useCallback(() => {
    if (openRef.current) closeSearch()
    else openSearch()
  }, [closeSearch, openSearch])

  /** 输入/开关变化：先归零计数（事件处理器里做，不在 effect 里 setState） */
  const updateQuery = useCallback((next: string) => {
    setQuery(next)
    setMatchCount(0)
    setMatchIndex(0)
  }, [])

  const updateOption = useCallback((key: keyof TerminalSearchOptions, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }))
    setMatchCount(0)
    setMatchIndex(0)
  }, [])

  // 面板开合通知（画布据此让出屏幕）
  useEffect(() => {
    onOpenChangeRef.current?.(open)
    return () => onOpenChangeRef.current?.(false)
  }, [open])

  // 匹配计数：只有带 decorations 的搜索才会触发 onDidChangeResults
  useEffect(() => {
    if (!open) return
    const addon = getAddon()
    if (!addon) return
    const sub = addon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setMatchCount(resultCount)
      setMatchIndex(resultIndex < 0 ? 0 : resultIndex)
    })
    return () => sub.dispose()
  }, [open, getAddon])

  // 查询/开关变化 → 重新搜索（增量：继续扩展当前选中的匹配）。
  // 这里只命令式驱动 addon，不 setState —— 计数由上面的订阅带回来。
  useEffect(() => {
    if (!open) return
    const addon = getAddon()
    if (!addon) return
    if (errorRef.current || !query.trim()) {
      try {
        addon.clearDecorations()
      } catch {
        /* ignore */
      }
      return
    }
    try {
      addon.findNext(query, toXtermSearchOptions(options, true))
    } catch {
      /* 非法正则：错误文案已由 validateSearchQuery 展示 */
    }
  }, [open, query, options, getAddon])

  const next = useCallback(() => runSearch('next', false), [runSearch])
  const prev = useCallback(() => runSearch('prev', false), [runSearch])

  // 查询为空或正则非法时不展示旧计数（计数归零发生在事件处理器里，见 updateQuery）
  const showCounts = !error && query.trim().length > 0

  return {
    open,
    openSearch,
    closeSearch,
    toggleSearch,
    query,
    setQuery: updateQuery,
    options,
    updateOption,
    matchCount: showCounts ? matchCount : 0,
    matchIndex: showCounts ? matchIndex : 0,
    error,
    next,
    prev,
    inputRef,
  }
}
