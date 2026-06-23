import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import 'xterm/css/xterm.css'
import { getWsClient } from '../../services/websocket'

interface Props {
  connectionId: string
  sessionId: string
  className?: string
}

export default function TerminalView({ connectionId, sessionId, className = '' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const [connected, setConnected] = useState(false)
  const wsClient = getWsClient()

  useEffect(() => {
    if (!containerRef.current) return

    // 初始化 xterm.js
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: {
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
      },
      allowTransparency: true,
      scrollback: 5000,
      tabStopWidth: 4,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)

    term.open(containerRef.current)

    // 延迟执行 fit 确保容器已渲染
    const fitTimer = setTimeout(() => fitAddon.fit(), 50)

    terminalRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // 发送终端数据到后端
    term.onData((data) => {
      wsClient.send({
        type: 'exec',
        connectionId,
        data: btoa(unescape(encodeURIComponent(data))),
      })
    })

    // 监听终端数据
    const unsubData = wsClient.on('data', (msg) => {
      if (msg.connectionId === connectionId) {
        const decoded = decodeURIComponent(escape(atob(msg.data as string)))
        term.write(decoded)
      }
    })

    // 监听连接状态
    const unsubConnected = wsClient.on('connected', (msg) => {
      if (msg.connectionId === connectionId) {
        setConnected(true)
        term.focus()
        setTimeout(() => fitAddon.fit(), 100)
      }
    })

    const unsubDisconnected = wsClient.on('disconnected', (msg) => {
      if (msg.connectionId === connectionId) {
        setConnected(false)
        term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n')
      }
    })

    // Resize 监听
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* ignore */ }
    })
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    // 发送 resize 到后端
    term.onResize(({ cols, rows }) => {
      wsClient.send({
        type: 'resize',
        connectionId,
        cols,
        rows,
      })
    })

    return () => {
      clearTimeout(fitTimer)
      observer.disconnect()
      unsubData()
      unsubConnected()
      unsubDisconnected()
      term.dispose()
    }
  }, [connectionId, sessionId])

  return (
    <div className={`relative flex flex-col ${className}`}>
      {/* 状态栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-900 px-3 py-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              connected ? 'bg-emerald-500' : 'bg-slate-600'
            }`}
          />
          <span className="text-xs text-slate-500">
            {connected ? '已连接' : '未连接'}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              if (terminalRef.current) {
                terminalRef.current.clear()
              }
            }}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="清屏"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 终端容器 */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-slate-950 px-1"
        style={{ minHeight: 0 }}
      />
    </div>
  )
}
