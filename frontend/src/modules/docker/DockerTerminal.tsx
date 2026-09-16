import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import type { IDisposable } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import {
  X,
  Maximize2,
  Search,
  Copy,
  ClipboardPaste,
  TextSelect,
  Eraser,
  RefreshCw,
} from 'lucide-react'
import { createSessionWsClient, type WsClient } from '../../services/websocket'
import { AnsiStreamBuffer } from '../../utils/ansi-preprocessor'
import {
  TerminalContextMenu,
  type TerminalMenuItem,
} from '../../components/terminal/TerminalContextMenu'
import { TerminalSearchBar } from '../../components/terminal/TerminalSearchBar'
import { useTerminalSearch } from '../../hooks/useTerminalSearch'
import { readTerminalPrefs, subscribeTerminalPrefs } from '../../utils/terminal-prefs'
import { registerTerminalLinks } from '../../utils/terminal-link-provider'
import { safeReadClipboard, safeWriteClipboard } from '../../utils/clipboard'

const TERMINAL_THEME = {
  background: '#0f172a',
  foreground: '#e2e8f0',
  cursor: '#38bdf8',
  selectionBackground: '#334155',
  black: '#1e293b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#f1f5f9',
}

interface Props {
  connectionId: string
  containerId: string
  shell?: string
  onClose: () => void
}

/**
 * 容器终端（在 Docker 容器里开一个 shell）。
 *
 * 它与 SSH 终端是**同一个产品里的两个终端**，所以显示偏好、链接可点、右键菜单、
 * 搜索这四件事必须一致 —— 否则用户会认为"只有 SSH 那个终端是好用的"。
 * 共用件：`utils/terminal-prefs`（字号/字体/光标/滚动缓冲）、`TerminalContextMenu`、
 * `TerminalSearchBar` + `hooks/useTerminalSearch`、`utils/terminal-link-provider`。
 */
export default function DockerTerminal({
  connectionId,
  containerId,
  shell = '/bin/bash',
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const openedRef = useRef(false)
  const wsClientRef = useRef<WsClient | null>(null)
  const connectedRef = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  /** 重新申请一个容器 shell（断线/容器终端被关掉后的出路） */
  const requestShellRef = useRef<(() => void) | null>(null)

  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: TerminalMenuItem[]
  } | null>(null)
  const [closed, setClosed] = useState<string | null>(null)

  // ─── 显示偏好：与 SSH 终端同一来源（设置面板改一处，两个终端一起变）───
  const [prefs, setPrefs] = useState(readTerminalPrefs)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])
  useEffect(() => subscribeTerminalPrefs(() => setPrefs(readTerminalPrefs())), [])
  useEffect(() => {
    const term = terminalRef.current
    if (!term) return
    term.options.fontSize = prefs.fontSize
    term.options.fontFamily = prefs.fontFamily
    term.options.lineHeight = prefs.lineHeight
    term.options.cursorStyle = prefs.cursorStyle
    term.options.cursorBlink = prefs.cursorBlink
    term.options.scrollback = prefs.scrollback
    term.options.macOptionIsMeta = prefs.macOptionIsMeta
    setTimeout(() => fitAddonRef.current?.fit(), 0)
  }, [prefs])

  // ─── 搜索：与 SSH 终端共用状态机 ───
  const search = useTerminalSearch(() => searchAddonRef.current)

  const showHint = useCallback((text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 2500)
  }, [])

  /** 终端全部文本（复制全部用） */
  const getAllText = useCallback((): string => {
    const term = terminalRef.current
    if (!term) return ''
    try {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) || '')
      }
      return lines.join('\n')
    } catch {
      return ''
    }
  }, [])

  const handleCopy = useCallback(() => {
    const term = terminalRef.current
    if (!term) return
    const selection = term.getSelection() || ''
    void safeWriteClipboard(selection.trim() ? selection : getAllText())
  }, [getAllText])

  const sendData = useCallback(
    (text: string) => {
      if (!connectedRef.current) return
      // 与 SSH 终端同编码：btoa 直接吃非 ASCII 会抛，先做 UTF-8 转换
      wsClientRef.current?.send({
        type: 'docker_shell_data',
        connectionId,
        containerId,
        data: btoa(unescape(encodeURIComponent(text))),
      })
    },
    [connectionId, containerId],
  )

  const pasteToShell = useCallback(() => {
    void safeReadClipboard().then((text) => {
      if (!text) {
        showHint('读不到剪贴板（需 HTTPS 或浏览器授权）· 可用 Ctrl+V 直接粘贴')
        return
      }
      sendData(text)
    })
  }, [sendData, showHint])

  const goToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom()
  }, [])

  /** 菜单条目在事件处理器里构建（渲染期不能读 ref，React Compiler 规则） */
  const buildMenuItems = useCallback(
    (hasSel: boolean): TerminalMenuItem[] => [
      {
        id: 'copy',
        label: hasSel ? '复制选中' : '复制全部',
        icon: Copy,
        shortcut: 'Ctrl+Shift+C',
        onSelect: handleCopy,
      },
      {
        id: 'paste',
        label: '粘贴',
        icon: ClipboardPaste,
        shortcut: 'Ctrl+Shift+V',
        onSelect: pasteToShell,
      },
      {
        id: 'select-all',
        label: '全选',
        icon: TextSelect,
        separatorBefore: true,
        onSelect: () => terminalRef.current?.selectAll(),
      },
      {
        id: 'search',
        label: '查找',
        icon: Search,
        shortcut: 'Ctrl+F',
        onSelect: search.openSearch,
      },
      {
        id: 'clear',
        label: '清屏（仅本地视图）',
        icon: Eraser,
        separatorBefore: true,
        onSelect: () => {
          terminalRef.current?.clear()
          goToBottom()
        },
      },
      {
        id: 'refresh',
        label: '重新打开 shell',
        icon: RefreshCw,
        separatorBefore: true,
        onSelect: () => requestShellRef.current?.(),
      },
    ],
    [goToBottom, handleCopy, pasteToShell, search.openSearch],
  )

  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true

    const initialPrefs = prefsRef.current
    const term = new XTerm({
      theme: TERMINAL_THEME,
      cursorBlink: initialPrefs.cursorBlink,
      cursorStyle: initialPrefs.cursorStyle,
      fontSize: initialPrefs.fontSize,
      fontFamily: initialPrefs.fontFamily,
      lineHeight: initialPrefs.lineHeight,
      macOptionIsMeta: initialPrefs.macOptionIsMeta,
      scrollback: initialPrefs.scrollback,
      allowTransparency: true,
      rows: 30,
      cols: 100,
    })
    terminalRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    const searchAddon = new SearchAddon()
    searchAddonRef.current = searchAddon
    term.loadAddon(searchAddon)

    if (containerRef.current) {
      term.open(containerRef.current)
      setTimeout(() => fitAddon.fit(), 100)
    }

    // 可点击链接：与 SSH 终端同一实现（桌面需 Ctrl/⌘，触屏直接点）
    const linkDisposable = registerTerminalLinks(term, showHint)

    // 选中即复制（偏好项，默认关）
    const selectionDisposable: IDisposable = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (prefsRef.current.copyOnSelect && sel) void safeWriteClipboard(sel)
    })

    // Ctrl/⌘+F 搜当前终端内容（终端里没有原生查找，这个键不会抢浏览器行为）
    term.attachCustomKeyEventHandler((e) => {
      const { key, ctrlKey, metaKey, shiftKey, type } = e
      if (type === 'keydown' && (ctrlKey || metaKey) && !shiftKey && (key === 'f' || key === 'F')) {
        search.openSearch()
        return false
      }
      return true
    })

    // ─── Async init: get JWT from backend → create WS → connect ───
    const reqId = `docker-shell-${containerId}`
    const ansiBuf = new AnsiStreamBuffer()

    const initDockerTerminal = async () => {
      try {
        const client = createSessionWsClient('/ws')
        wsClientRef.current = client

        const readyOff = client.on('docker_shell_ready', (msg) => {
          if (msg.connectionId !== connectionId && msg.requestId !== reqId) return
          connectedRef.current = true
          setClosed(null)
          ansiBuf.reset()
          term.focus()
          setTimeout(() => fitAddon.fit(), 200)
        })

        const outputOff = client.on('docker_shell_output', (msg) => {
          if (msg.connectionId !== connectionId) return
          try {
            const ready = ansiBuf.push(atob(msg.data as string))
            if (ready) term.write(ready)
          } catch {
            const ready = ansiBuf.push(String(msg.data ?? ''))
            if (ready) term.write(ready)
          }
        })

        const closedOff = client.on('docker_shell_closed', (msg) => {
          if (msg.connectionId !== connectionId) return
          term.write(`\r\n\x1b[31m[容器终端已关闭，退出码: ${msg.exitCode}]\x1b[0m\r\n`)
          connectedRef.current = false
          // 给它一条出路：容器重启过 / shell 退出了，不必关弹窗再重开
          setClosed(`容器终端已关闭（退出码 ${msg.exitCode}）`)
        })

        const statusOff = client.onStatus((status) => {
          if (status === 'connected') {
            client.send({
              type: 'docker_shell',
              connectionId,
              requestId: reqId,
              containerId,
              shell,
            })
          }
        })

        requestShellRef.current = () => {
          setClosed(null)
          ansiBuf.reset()
          client.send({
            type: 'docker_shell',
            connectionId,
            requestId: `${reqId}-${Date.now()}`,
            containerId,
            shell,
          })
        }

        cleanupRef.current = () => {
          readyOff()
          outputOff()
          closedOff()
          statusOff()
        }

        client.connect()
      } catch (err) {
        term.write(
          `\r\n\x1b[31m[错误] 获取认证令牌失败: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`,
        )
      }
    }

    initDockerTerminal()

    const disposeInput = term.onData((data) => {
      if (!connectedRef.current) return
      wsClientRef.current?.send({
        type: 'docker_shell_data',
        connectionId,
        containerId,
        data: btoa(data),
      })
    })

    const disposeResize = term.onResize(({ cols, rows }) => {
      if (!connectedRef.current) return
      wsClientRef.current?.send({
        type: 'docker_shell_resize',
        connectionId,
        containerId,
        cols,
        rows,
      })
    })

    const onWindowResize = () => {
      if (fitAddon && connectedRef.current) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      disposeInput.dispose()
      disposeResize.dispose()
      linkDisposable.dispose()
      selectionDisposable.dispose()
      cleanupRef.current?.()
      if (connectedRef.current && wsClientRef.current) {
        wsClientRef.current.send({
          type: 'docker_shell_data',
          connectionId,
          containerId,
          data: btoa('exit\r'),
        })
      }
      wsClientRef.current?.disconnect()
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, containerId, shell])

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative mx-2 flex h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="ml-2 font-mono text-sm text-slate-200">
            Docker: <span className="text-wrench-400">{containerId.slice(0, 12)}</span>
          </span>
          <span className="ml-2 text-xs text-slate-500">{shell}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                search.openSearch()
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              title="查找终端内容 (Ctrl+F)"
            >
              <Search size={12} />
              查找
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                fitAddonRef.current?.fit()
              }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              title="适应窗口大小"
            >
              <Maximize2 size={12} />
              适应
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose()
              }}
              className="flex items-center gap-1 rounded px-2.5 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              title="关闭终端"
            >
              <X size={14} />
              关闭
            </button>
          </div>
        </div>

        {/* 容器终端已关闭：给出重开的路 */}
        {closed && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-amber-300">{closed}</span>
            <button
              type="button"
              onClick={() => {
                setClosed(null)
                showHint('正在重新打开容器 shell…')
                requestShellRef.current?.()
              }}
              className="shrink-0 rounded bg-amber-600/80 px-2 py-0.5 text-xs text-white hover:bg-amber-500"
            >
              重新打开
            </button>
          </div>
        )}

        {/* 终端区域 */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden bg-slate-950"
          onContextMenu={(e) => {
            e.preventDefault()
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              items: buildMenuItems(!!terminalRef.current?.getSelection()?.trim()),
            })
          }}
        />

        {/* 轻提示 */}
        {hint && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded bg-slate-800/95 px-3 py-1 text-[11px] text-slate-300 shadow-lg">
            {hint}
          </div>
        )}

        {search.open && (
          <TerminalSearchBar
            query={search.query}
            onQueryChange={search.setQuery}
            options={search.options}
            onOptionChange={search.updateOption}
            matchCount={search.matchCount}
            matchIndex={search.matchIndex}
            error={search.error}
            onNext={search.next}
            onPrev={search.prev}
            onClose={() => {
              search.closeSearch()
              terminalRef.current?.focus()
            }}
            inputRef={search.inputRef}
          />
        )}

        {contextMenu && (
          <TerminalContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  )
}
