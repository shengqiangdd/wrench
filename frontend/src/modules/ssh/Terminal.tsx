import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { Search, X, ChevronUp, ChevronDown, Keyboard } from 'lucide-react'
import { createTerminalWsClient, type WsClient } from '../../services/websocket'
import { getToken } from '../../services/auth'

/** 分屏面板配置 */
export interface SplitPanel {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  size: number // 百分比 0-100
  children?: SplitPanel[]
}

/** SSH 连接凭据（传递给 Terminal 以建立独立 WS 连接） */
export interface SshCredentials {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  sudoPassword?: string
}

interface Props {
  connectionId: string
  sessionId: string
  className?: string
  onConnected?: () => void
  onDisconnected?: () => void
  /** 命令同步：收到用户输入时回调（用于广播到同组其他分屏） */
  onTerminalData?: (data: string) => void
  /** SSH 连接凭据（用于建立独立 WebSocket 连接） */
  credentials?: SshCredentials
}

// 主题配色（与终端一致）
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

export default function TerminalView({
  connectionId,
  sessionId,
  className = '',
  onConnected,
  onDisconnected,
  onTerminalData,
  credentials,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const connectedRef = useRef(false)
  const disposedRef = useRef(false)
  // 搜索状态
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, _setSearchMatchIndex] = useState(0)
  const [searchMatchCount, _setSearchMatchCount] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 用 ref 避免 event handler 中的闭包过期
  const onConnectedRef = useRef(onConnected)
  const onDisconnectedRef = useRef(onDisconnected)
  const showSearchRef = useRef(showSearch)
  useEffect(() => {
    onConnectedRef.current = onConnected
    onDisconnectedRef.current = onDisconnected
    showSearchRef.current = showSearch
  }, [onConnected, onDisconnected, showSearch])
  /** generation ID：每次 mount 递增，防止旧实例的异步回调污染新实例 */
  const genRef = useRef(0)
  // 每个终端独立的 WebSocket 客户端（用于 SSH I/O）
  const termWsRef = useRef<WsClient | null>(null)
  // 凭据 ref（避免 effect 依赖变化）
  const credentialsRef = useRef(credentials)
  useEffect(() => {
    credentialsRef.current = credentials
  }, [credentials])

  // ─── 移动端快捷键面板 ───
  const [showShortcuts, setShowShortcuts] = useState(false)

  // ─── 移动端虚拟键盘高度补偿 ──
  // 直接用 JS 强制设置终端容器高度，绕过所有 CSS 计算
  const sshConnectedRef = useRef(false)

  useEffect(() => {
    const vv = window.visualViewport
    const container = containerRef.current
    if (!vv || !container) return

    const TOOLBAR_HEIGHT = 48 // 顶部标签栏高度

    const update = () => {
      const vvH = vv.height
      if (vvH <= 0) return

      // 直接设置容器高度为可视区域高度减去工具栏
      const targetH = Math.floor(vvH - TOOLBAR_HEIGHT)
      if (targetH > 0) {
        container.style.height = `${targetH}px`
      }

      // 键盘变化时重新 fit
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit()
        } catch {
          /* ignore */
        }
      })
    }

    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()

    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    genRef.current += 1
    const gen = genRef.current
    disposedRef.current = false

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: TERMINAL_THEME,
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
      // 移动端优化
      screenReaderMode: false,
      disableStdin: false,
      allowProposedApi: true,
      // 给予初始 cols/rows 防止 Viewport 在 DOM 渲染前访问 undefined dimensions
      cols: 80,
      rows: 24,
      // 禁用平滑滚动，触摸滚动由自定义处理器控制
      smoothScrollDuration: 0,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    const container = containerRef.current
    term.open(container)

    // ─── 自定义触摸滚动处理器（含惯性滚动） ───
    // xterm.js 的 .xterm-screen 覆盖在 .xterm-viewport 之上，
    // 触摸事件被 screen 层拦截，无法到达 viewport 的滚动机制。
    // 通过 JS 直接处理触摸事件并调用 term.scrollLines() 解决。
    let touchLastY = 0
    let touchStartY = 0
    let touchAccumulator = 0
    let touchVelocity = 0
    let lastTouchTime = 0
    let momentumRafId = 0
    let isScrolling = false

    /** 动态获取当前行高（像素） */
    const getRowHeight = (): number => {
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null
      if (viewport && term.rows > 0) {
        return viewport.clientHeight / term.rows
      }
      return 16 // fallback
    }

    /** 按像素滚动（支持亚行精度） */
    const scrollByPixels = (px: number) => {
      const rowHeight = getRowHeight()
      touchAccumulator += px
      const linesToScroll = Math.trunc(touchAccumulator / rowHeight)
      if (linesToScroll !== 0) {
        // 手指下滑 → px 正 → 查看历史 → scrollLines 负值
        term.scrollLines(-linesToScroll)
        touchAccumulator -= linesToScroll * rowHeight
      }
    }

    /** 惯性滚动动画 */
    const momentumScroll = () => {
      if (Math.abs(touchVelocity) < 0.5) {
        touchVelocity = 0
        return
      }
      scrollByPixels(touchVelocity)
      touchVelocity *= 0.92 // 摩擦系数
      momentumRafId = requestAnimationFrame(momentumScroll)
    }

    const handleTouchStart = (e: TouchEvent) => {
      // 停止惯性滚动
      cancelAnimationFrame(momentumRafId)
      touchVelocity = 0
      isScrolling = false

      const touch = e.touches[0]
      if (touch) {
        touchLastY = touch.clientY
        touchStartY = touch.clientY
      }
      touchAccumulator = 0
      lastTouchTime = Date.now()
    }

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return

      const deltaY = touch.clientY - touchStartY

      // 只有滑动超过阈值才认定为滚动（防止误判 tap 为 scroll）
      if (!isScrolling && Math.abs(deltaY) > 8) {
        isScrolling = true
      }

      if (isScrolling) {
        e.preventDefault() // 仅在滚动时阻止默认行为（保留 tap 的 click 事件）

        const moveDelta = touch.clientY - touchLastY
        const now = Date.now()
        const dt = Math.max(1, now - lastTouchTime)

        // 计算瞬时速度（像素/帧，假设 60fps ≈ 16.7ms/帧）
        touchVelocity = (moveDelta / dt) * 16.7

        touchLastY = touch.clientY
        lastTouchTime = now

        scrollByPixels(moveDelta)
      }
    }

    const handleTouchEnd = () => {
      if (isScrolling) {
        // 启动惯性滚动
        if (Math.abs(touchVelocity) > 1) {
          momentumRafId = requestAnimationFrame(momentumScroll)
        }
      }
      isScrolling = false
      touchAccumulator = 0
    }

    // 使用 { passive: false } 以允许 preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    // 延迟执行 fit 确保容器已渲染
    const fitTimer = setTimeout(() => {
      const c = containerRef.current
      if (c && c.offsetWidth > 0 && c.offsetHeight > 0 && gen === genRef.current) {
        try {
          fitAddon.fit()
        } catch {
          /* ignore */
        }
      }
    }, 50)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // ─── 创建独立 WebSocket 连接用于此终端 ───
    // 后端 handle_terminal_connect 会阻塞整个 WS 主循环，
    // 因此每个终端必须有自己的 WS 连接以支持多主机同时连接。
    const initTerminalConnection = async () => {
      if (gen !== genRef.current) return

      const creds = credentialsRef.current
      if (!creds) {
        term.write('\r\n\x1b[31m[错误] 缺少连接凭据\x1b[0m\r\n')
        return
      }

      try {
        const token = await getToken()
        if (gen !== genRef.current) return

        const termWs = createTerminalWsClient(token)
        termWsRef.current = termWs

        // 注册事件处理器（在连接前注册，确保不遗漏）
        termWs.on('data', (msg) => {
          if (msg.connectionId !== connectionId) return

          // 处理 SSH 连接成功消息
          if (msg.type === 'connected') {
            sshConnectedRef.current = true
            // SSH 连接成功后，执行 fit 调整终端尺寸
            setTimeout(() => {
              const c = containerRef.current
              if (c && c.offsetWidth > 0 && c.offsetHeight > 0 && gen === genRef.current) {
                try {
                  fitAddon.fit()
                } catch {
                  /* ignore */
                }
              }
            }, 50)
            return
          }

          // 过滤后端错误响应（SSH 断开后前端消息被主循环拒绝）
          if (msg.type === 'error') {
            sshConnectedRef.current = false
            return
          }

          const raw = msg.data as string
          try {
            const decoded = decodeURIComponent(escape(atob(raw)))
            if (!disposedRef.current) term.write(decoded)
          } catch {
            if (!disposedRef.current) term.write(raw)
          }
        })

        termWs.on('connected', () => {
          connectedRef.current = true
          term.focus()
          onConnectedRef.current?.()
        })

        termWs.on('disconnected', () => {
          connectedRef.current = false
          if (!disposedRef.current) {
            term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n')
          }
          onDisconnectedRef.current?.()
        })

        termWs.on('error', (msg) => {
          if (!disposedRef.current) {
            term.write(`\r\n\x1b[31m[错误] ${(msg.message as string) || '未知错误'}\x1b[0m\r\n`)
          }
        })

        // 连接 WebSocket
        termWs.connect()

        // 等待连接建立后发送 SSH connect 消息
        const unsub = termWs.onStatus((status) => {
          if (status === 'connected') {
            unsub()
            if (gen !== genRef.current) return
            termWs.send({
              type: 'connect',
              connectionId,
              host: creds.host,
              port: creds.port,
              username: creds.username,
              password: creds.password || '',
              privateKey: creds.privateKey || '',
              sudoPassword: creds.sudoPassword || '',
            })
          } else if (status === 'disconnected') {
            unsub()
            if (!disposedRef.current) {
              term.write('\r\n\x1b[31m[WebSocket 连接失败]\x1b[0m\r\n')
            }
          }
        })
      } catch (err) {
        if (gen !== genRef.current) return
        const msg = err instanceof Error ? err.message : '获取认证令牌失败'
        term.write(`\r\n\x1b[31m[错误] ${msg}\x1b[0m\r\n`)
      }
    }

    initTerminalConnection()

    // ─── 快捷键注册 ───
    // Ctrl+C: 选中文本时复制，未选中时发送 SIGINT
    // Ctrl+V / Shift+Insert: 粘贴
    // Ctrl+Shift+C: 强制复制 / Ctrl+Shift+V: 强制粘贴
    term.attachCustomKeyEventHandler((e) => {
      const { key, ctrlKey, shiftKey, type } = e

      // Ctrl+Shift+C → 复制选中文本
      if (type === 'keydown' && ctrlKey && shiftKey && key.toLowerCase() === 'c') {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
          term.clearSelection()
        }
        return false // 阻止发送到终端
      }

      // Ctrl+Shift+V → 粘贴
      if (type === 'keydown' && ctrlKey && shiftKey && key.toLowerCase() === 'v') {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && sshConnectedRef.current) {
              const encoded = btoa(unescape(encodeURIComponent(text)))
              termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
              onTerminalData?.(encoded)
            }
          })
          .catch(() => {})
        return false
      }

      // Ctrl+C → 有选中则复制，否则放行（终端发 SIGINT）
      if (type === 'keydown' && ctrlKey && !shiftKey && key.toLowerCase() === 'c') {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {})
          term.clearSelection()
          return false // 阻止 SIGINT
        }
        return true // 放行给终端（发送 SIGINT）
      }

      // Ctrl+V / Shift+Insert → 粘贴
      if (
        type === 'keydown' &&
        ((ctrlKey && !shiftKey && key.toLowerCase() === 'v') ||
          (!ctrlKey && shiftKey && key === 'Insert'))
      ) {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text && sshConnectedRef.current) {
              const encoded = btoa(unescape(encodeURIComponent(text)))
              termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
              onTerminalData?.(encoded)
            }
          })
          .catch(() => {})
        return false
      }

      return true
    })

    term.onData((data) => {
      // 只有 SSH 连接建立后才发送数据
      if (!sshConnectedRef.current) return
      // 将用户输入以 base64 编码发送
      const encoded = btoa(unescape(encodeURIComponent(data)))
      termWsRef.current?.send({
        type: 'exec',
        connectionId,
        data: encoded,
      })
      // 命令同步：广播到同组其他分屏
      onTerminalData?.(encoded)
    })

    // Resize 监听 — 用 rAF 确保 DOM 就绪后再 fit
    const observer = new ResizeObserver(() => {
      if (gen !== genRef.current) return
      requestAnimationFrame(() => {
        if (gen !== genRef.current) return
        const c = containerRef.current
        if (!c || c.offsetWidth === 0 || c.offsetHeight === 0) return
        try {
          fitAddon.fit()
        } catch {
          /* ignore */
        }
      })
    })
    observer.observe(container)

    // 发送 resize 到后端（只有 SSH 连接建立后才发送）
    term.onResize(({ cols, rows }) => {
      if (!sshConnectedRef.current) return
      termWsRef.current?.send({
        type: 'resize',
        connectionId,
        cols,
        rows,
      })
    })

    // ─── Ctrl+Shift+F 搜索 ───
    const searchKeyHandler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch((s) => !s)
        if (!showSearchRef.current) setTimeout(() => searchInputRef.current?.focus(), 50)
      }
      if (e.key === 'Escape') {
        setShowSearch(false)
        setSearchQuery('')
        term.focus()
      }
    }
    window.addEventListener('keydown', searchKeyHandler)

    // 清理函数
    return () => {
      clearTimeout(fitTimer)
      observer.disconnect()
      window.removeEventListener('keydown', searchKeyHandler)
      // 移除触摸事件监听器
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      // 断开并清理独立 WebSocket
      if (termWsRef.current) {
        termWsRef.current.disconnect()
        termWsRef.current = null
      }
      try {
        term.dispose()
      } catch {}
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
    // connectionId/sessionId 变化时重新创建终端连接
    // credentials 通过 ref 引用，onTerminalData 由父组件 useCallback 包装，均稳定不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, sessionId])

  // ─── 搜索函数 ───
  const doSearch = useCallback((query: string, dir: 'next' | 'prev' = 'next') => {
    const sa = searchAddonRef.current
    if (!sa || !query.trim()) return
    try {
      if (dir === 'prev') {
        sa.findPrevious(query)
      } else {
        sa.findNext(query)
      }
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div className={`relative flex flex-col ${className}`} style={{ minHeight: 0 }}>
      {/* 搜索面板 */}
      {showSearch && (
        <div className="absolute right-0 bottom-0 left-0 z-20 flex items-center gap-1 border-t border-slate-700/50 bg-slate-900 px-2 py-1">
          <Search size={13} className="shrink-0 text-slate-500" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              if (e.key === 'Escape') {
                setShowSearch(false)
                setSearchQuery('')
                terminalRef.current?.focus()
              }
            }}
            placeholder="搜索终端内容..."
            className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          {searchQuery.trim() && (
            <span className="text-[10px] text-slate-600">
              {searchMatchCount > 0 ? `${searchMatchIndex + 1}/${searchMatchCount}` : '0'}
            </span>
          )}
          <button
            onClick={() => doSearch(searchQuery, 'prev')}
            disabled={!searchQuery.trim()}
            className="btn-icon text-slate-500 hover:text-slate-300 disabled:opacity-30"
            title="上一个 (Shift+Enter)"
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={() => doSearch(searchQuery, 'next')}
            disabled={!searchQuery.trim()}
            className="btn-icon text-slate-500 hover:text-slate-300 disabled:opacity-30"
            title="下一个 (Enter)"
          >
            <ChevronDown size={13} />
          </button>
          <button
            onClick={() => {
              setShowSearch(false)
              setSearchQuery('')
              terminalRef.current?.focus()
            }}
            className="btn-icon text-slate-500 hover:text-slate-300"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        className="overflow-hidden bg-slate-950 px-1"
        style={{
          // 阻止浏览器默认触摸行为，由自定义触摸滚动处理器接管
          touchAction: 'none',
          // 初始高度，后续由 visualViewport 事件动态调整
          height: '100%',
        }}
      />

      {/* 移动端快捷键浮动按钮 — 使用 onPointerDown 防止焦点转移（避免 IME 关闭） */}
      <button
        onPointerDown={(e) => {
          e.preventDefault() // 阻止焦点转移，保持 IME 活跃
          setShowShortcuts((v) => !v)
        }}
        className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800/80 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700/80 hover:text-slate-200 md:hidden"
        title="快捷键"
      >
        <Keyboard size={16} />
      </button>

      {/* 移动端快捷键面板 - 始终显示在可视区域底部 */}
      {showShortcuts && (
        <div
          className="absolute inset-x-0 bottom-0 z-50 rounded-t-xl border-t border-slate-700/50 bg-slate-900/95 p-3 backdrop-blur-lg md:hidden"
          style={{
            maxHeight: '40vh',
            overflowY: 'auto',
          }}
        >
          <div className="flex items-center justify-between border-b border-slate-700/30 pb-2">
            <span className="text-xs font-medium text-slate-300">快捷键（点击发送）</span>
            <button
              onPointerDown={(e) => {
                e.preventDefault() // 阻止焦点转移，保持 IME 活跃
                setShowShortcuts(false)
              }}
              className="btn-icon text-slate-500 hover:text-slate-300"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[
              { key: 'Tab', label: '补全', seq: '\t' },
              { key: 'Esc', label: '取消', seq: '\x1b' },
              { key: 'Ctrl+C', label: '中断', seq: '\x03' },
              { key: 'Ctrl+D', label: 'EOF', seq: '\x04' },
              { key: 'Ctrl+Z', label: '挂起', seq: '\x1a' },
              { key: 'Ctrl+L', label: '清屏', seq: '\x0c' },
              { key: '↑', label: '上', seq: '\x1b[A' },
              { key: '↓', label: '下', seq: '\x1b[B' },
              { key: '→', label: '右', seq: '\x1b[C' },
              { key: '←', label: '左', seq: '\x1b[D' },
              { key: 'Home', label: '行首', seq: '\x1b[H' },
              { key: 'End', label: '行尾', seq: '\x1b[F' },
              { key: 'PgUp', label: '上翻', seq: '\x1b[5~' },
              { key: 'PgDn', label: '下翻', seq: '\x1b[6~' },
              { key: 'Del', label: '删除', seq: '\x1b[3~' },
            ].map((s) => (
              <button
                key={s.key}
                onPointerDown={(e) => {
                  // 阻止默认行为：防止焦点从 textarea 转移到按钮（避免 IME 中断）
                  e.preventDefault()
                  if (!sshConnectedRef.current) return
                  const encoded = btoa(unescape(encodeURIComponent(s.seq)))
                  termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
                  onTerminalData?.(encoded)
                }}
                className="flex min-h-[44px] items-center justify-between rounded-lg bg-slate-800/80 px-3 py-2 transition-colors active:bg-slate-700"
              >
                <kbd className="font-mono text-sm text-slate-200">{s.key}</kbd>
                <span className="text-[11px] text-slate-500">{s.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 border-t border-slate-700/30 pt-2">
            <p className="text-center text-[11px] text-slate-500">💡 单指滑动可滚动终端内容</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 分屏管理器组件 ───

export interface SplitDef {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  split?: 'vertical' | 'horizontal'
  first?: SplitDef
  second?: SplitDef
  size?: number // 百分比
  /** 命令同步组 */
  syncGroup?: string
}

interface SplitContainerProps {
  splits: SplitDef[]
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
  connections: Array<{ id: string; name: string }>
  /** 命令同步切换 */
  onToggleSync?: (id: string) => void
  /** 拖动合并 */
  onMerge?: (
    sourceId: string,
    targetId: string,
    position: 'left' | 'right' | 'top' | 'bottom',
  ) => void
  /** 同步组映射：syncGroup → split ID 列表 */
  syncGroups?: Record<string, string[]>
  /** 当前活跃的分屏 ID */
  activeSplitId?: string | null
  onSetActiveSplit?: (id: string) => void
  /** 命令同步：分屏收到的终端输入 */
  onTerminalData?: (sessionId: string, data: string) => void
  /** 每个 session 的 SSH 凭据（用于建立独立 WS 连接） */
  credentialsMap?: Map<string, SshCredentials>
}

export function SplitContainer({
  splits,
  onSplit,
  onRemove,
  onConnectionChange,
  connections,
  onToggleSync,
  onMerge,
  syncGroups,
  activeSplitId,
  onSetActiveSplit,
  onTerminalData,
  credentialsMap,
}: SplitContainerProps) {
  if (splits.length === 0) return null

  // 单个分屏或同方向平铺
  if (splits.length === 1) {
    const single = splits[0]!
    return (
      <SplitPane
        key={single.id}
        split={single}
        onSplit={onSplit}
        onRemove={onRemove}
        onConnectionChange={onConnectionChange}
        connections={connections}
        onToggleSync={onToggleSync}
        onMerge={onMerge}
        syncGroups={syncGroups}
        activeSplitId={activeSplitId}
        onSetActiveSplit={onSetActiveSplit}
        onTerminalData={onTerminalData}
        credentialsMap={credentialsMap}
      />
    )
  }

  // 构建树形布局：找到方向变化点
  const firstDir = splits[0]!.direction
  // 从右往左找第一个方向不同的分界点
  let splitIdx = splits.length
  for (let i = splits.length - 1; i >= 1; i--) {
    if (splits[i]!.direction !== firstDir) {
      splitIdx = i
      break
    }
  }

  // 全部同方向 → 直接平铺
  if (splitIdx === splits.length) {
    return (
      <div
        className={`flex flex-1 overflow-hidden ${
          splits[0]!.direction === 'vertical' ? 'flex-col' : 'flex-row'
        }`}
        style={{ minHeight: 0 }}
      >
        {splits.map((s, i) => (
          <div
            key={s.id}
            className="flex overflow-hidden"
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          >
            {i > 0 && (
              <div
                className={`shrink-0 bg-slate-700/50 ${
                  splits[0]!.direction === 'vertical' ? 'h-px' : 'w-px'
                }`}
              />
            )}
            <SplitPane
              split={s}
              onSplit={onSplit}
              onRemove={onRemove}
              onConnectionChange={onConnectionChange}
              connections={connections}
              onToggleSync={onToggleSync}
              onMerge={onMerge}
              syncGroups={syncGroups}
              activeSplitId={activeSplitId}
              onSetActiveSplit={onSetActiveSplit}
              onTerminalData={onTerminalData}
              credentialsMap={credentialsMap}
            />
          </div>
        ))}
      </div>
    )
  }

  // 有方向变化：外层用 firstDir，内层用另一个方向
  const outerSplits = splits.slice(0, splitIdx)
  const innerSplits = splits.slice(splitIdx)

  return (
    <div
      className={`flex flex-1 overflow-hidden ${firstDir === 'vertical' ? 'flex-col' : 'flex-row'}`}
      style={{ minHeight: 0 }}
    >
      <div
        className="flex overflow-hidden"
        style={{ flex: outerSplits.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          key={`outer-${outerSplits.map((s) => s.id).join('-')}`}
          splits={outerSplits}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
          onToggleSync={onToggleSync}
          onMerge={onMerge}
          syncGroups={syncGroups}
          activeSplitId={activeSplitId}
          onSetActiveSplit={onSetActiveSplit}
          onTerminalData={onTerminalData}
          credentialsMap={credentialsMap}
        />
      </div>

      <div className={`shrink-0 bg-slate-700/50 ${firstDir === 'vertical' ? 'h-px' : 'w-px'}`} />

      <div
        className="flex overflow-hidden"
        style={{ flex: innerSplits.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          key={`inner-${innerSplits.map((s) => s.id).join('-')}`}
          splits={innerSplits}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
          onToggleSync={onToggleSync}
          onMerge={onMerge}
          syncGroups={syncGroups}
          activeSplitId={activeSplitId}
          onSetActiveSplit={onSetActiveSplit}
          onTerminalData={onTerminalData}
          credentialsMap={credentialsMap}
        />
      </div>
    </div>
  )
}

// 单个分屏面板
function SplitPane({
  split,
  onSplit,
  onRemove,
  onConnectionChange,
  connections,
  onToggleSync,
  onMerge,
  syncGroups,
  activeSplitId,
  onSetActiveSplit,
  onTerminalData,
  credentialsMap,
}: {
  split: SplitDef
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
  connections: Array<{ id: string; name: string }>
  onToggleSync?: (id: string) => void
  onMerge?: (
    sourceId: string,
    targetId: string,
    position: 'left' | 'right' | 'top' | 'bottom',
  ) => void
  syncGroups?: Record<string, string[]>
  activeSplitId?: string | null
  onSetActiveSplit?: (id: string) => void
  onTerminalData?: (sessionId: string, data: string) => void
  credentialsMap?: Map<string, SshCredentials>
}) {
  const isSyncOn = !!split.syncGroup
  const groupId = split.syncGroup || ''
  const groupMembers = (groupId && syncGroups?.[groupId]) || []
  const isActive = activeSplitId === split.id

  // 拖拽状态
  const [dragOver, setDragOver] = useState<'none' | 'left' | 'right' | 'top' | 'bottom'>('none')
  const dragOverRef = useRef<'none' | 'left' | 'right' | 'top' | 'bottom'>('none')
  const dragRef = useRef<string | null>(null)

  const handleDragStart = (e: React.DragEvent) => {
    dragRef.current = split.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', split.id)
    // 让拖拽时显示一个半透明卡片
    const el = e.currentTarget as HTMLElement
    el.classList.add('opacity-40')
  }

  const handleDragEnd = (e: React.DragEvent) => {
    dragRef.current = null
    setDragOver('none')
    const el = e.currentTarget as HTMLElement
    el.classList.remove('opacity-40')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // 判断鼠标在拖拽目标中的位置
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const threshold = 0.25 // 25% 边缘触发

    let pos: 'none' | 'left' | 'right' | 'top' | 'bottom' = 'none'
    if (x / rect.width < threshold) {
      pos = 'left'
    } else if (x / rect.width > 1 - threshold) {
      pos = 'right'
    } else if (y / rect.height < threshold) {
      pos = 'top'
    } else if (y / rect.height > 1 - threshold) {
      pos = 'bottom'
    }
    dragOverRef.current = pos
    setDragOver(pos)
  }

  const handleDragLeave = () => {
    dragOverRef.current = 'none'
    setDragOver('none')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === split.id || !onMerge) return
    setDragOver('none')

    // 直接用鼠标位置计算 drop 位置（避免 state 过期）
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const threshold = 0.25

    let pos: 'left' | 'right' | 'top' | 'bottom'
    if (x / rect.width < threshold) {
      pos = 'left'
    } else if (x / rect.width > 1 - threshold) {
      pos = 'right'
    } else if (y / rect.height < threshold) {
      pos = 'top'
    } else if (y / rect.height > 1 - threshold) {
      pos = 'bottom'
    } else {
      // 中心区域：根据分屏方向决定默认插入位置
      pos = split.direction === 'vertical' ? 'right' : 'bottom'
    }

    onMerge(sourceId, split.id, pos)
  }

  // 计算边框高亮
  const borderStyles = (() => {
    if (dragOver === 'none') return {}
    const color = 'rgba(34, 211, 238, 0.5)' // cyan-400
    switch (dragOver) {
      case 'left':
        return { borderLeft: `3px solid ${color}` }
      case 'right':
        return { borderRight: `3px solid ${color}` }
      case 'top':
        return { borderTop: `3px solid ${color}` }
      case 'bottom':
        return { borderBottom: `3px solid ${color}` }
    }
  })()

  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden transition-shadow ${
        isActive ? 'ring-1 ring-cyan-500/40' : ''
      }`}
      style={{ minHeight: 0, ...borderStyles }}
      onClick={() => onSetActiveSplit?.(split.id)}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 分屏工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-2 py-1">
        <div className="flex items-center gap-1">
          <select
            value={split.connectionId}
            onChange={(e) => {
              const val = e.target.value
              // 如果是 sessionId（已连接），直接使用；否则需要新建连接
              const isSession = connections.some((c) => c.id === val)
              if (isSession) {
                onConnectionChange(split.id, val, `sess_${val}_${Date.now()}`)
              }
            }}
            className="max-w-[120px] truncate rounded bg-transparent text-[11px] text-slate-400 outline-none hover:text-slate-300"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          {/* 命令同步开关 */}
          {onToggleSync && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSync(split.id)
              }}
              className={`btn-icon relative ${
                isSyncOn ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400'
              }`}
              title={isSyncOn ? `命令同步中 (${groupMembers.length} 个分屏)` : '开启命令同步'}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {isSyncOn && groupMembers.length > 1 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-cyan-500 text-[8px] text-white">
                  {groupMembers.length}
                </span>
              )}
            </button>
          )}
          {/* 垂直分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSplit(split.id, 'vertical')
            }}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="垂直分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
          {/* 水平分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSplit(split.id, 'horizontal')
            }}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="水平分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </button>
          <div className="mx-1 h-3 w-px bg-slate-700/50" />
          {/* 关闭分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(split.id)
            }}
            className="btn-icon text-slate-600 hover:text-red-400"
            title="关闭分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 终端 */}
      <TerminalView
        connectionId={split.connectionId}
        sessionId={split.sessionId}
        className="flex-1"
        onTerminalData={
          onTerminalData ? (data: string) => onTerminalData(split.sessionId, data) : undefined
        }
        credentials={credentialsMap?.get(split.sessionId)}
      />
    </div>
  )
}
