import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { SearchAddon } from 'xterm-addon-search'
import 'xterm/css/xterm.css'
import { getWsClient } from '../../services/websocket'

/** 分屏面板配置 */
export interface SplitPanel {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  size: number // 百分比 0-100
  children?: SplitPanel[]
}

interface Props {
  connectionId: string
  sessionId: string
  className?: string
  onConnected?: () => void
  onDisconnected?: () => void
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

export default function TerminalView({ connectionId, sessionId, className = '', onConnected, onDisconnected }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const connectedRef = useRef(false)
  const disposedRef = useRef(false)
  const wsClient = getWsClient()

  // 初始化 xterm 实例
  const initTerminal = useCallback(() => {
    if (disposedRef.current) return null

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
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)

    return { term, fitAddon, searchAddon }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    const { term, fitAddon } = initTerminal()!
    if (!term) return

    const container = containerRef.current
    term.open(container)

    // 延迟执行 fit 确保容器已渲染
    const fitTimer = setTimeout(() => {
      try { fitAddon.fit() } catch { /* ignore */ }
    }, 50)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // 发送终端数据到后端（shell 模式）
    term.onData((data) => {
      // 将用户输入以 base64 编码发送
      const encoded = btoa(unescape(encodeURIComponent(data)))
      wsClient.send({
        type: 'exec',
        connectionId,
        data: encoded,
      })
    })

    // 监听终端数据（来自后端）
    const unsubData = wsClient.on('data', (msg) => {
      if (msg.connectionId === connectionId) {
        const raw = msg.data as string
        try {
          const decoded = decodeURIComponent(escape(atob(raw)))
          if (!disposedRef.current) {
            term.write(decoded)
          }
        } catch {
          // 非 base64 的直接写入
          if (!disposedRef.current) {
            term.write(raw)
          }
        }
      }
    })

    // 监听连接状态
    const unsubConnected = wsClient.on('connected', (msg) => {
      if (msg.connectionId === connectionId) {
        connectedRef.current = true
        term.focus()
        setTimeout(() => {
          try { fitAddon.fit() } catch { /* ignore */ }
        }, 100)
        onConnected?.()
      }
    })

    const unsubDisconnected = wsClient.on('disconnected', (msg) => {
      if (msg.connectionId === connectionId) {
        connectedRef.current = false
        if (!disposedRef.current) {
          term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n')
        }
        onDisconnected?.()
      }
    })

    // 错误处理
    const unsubError = wsClient.on('error', (msg) => {
      if (msg.connectionId === connectionId) {
        if (!disposedRef.current) {
          term.write(`\r\n\x1b[31m[错误] ${msg.message || msg.code}\x1b[0m\r\n`)
        }
      }
    })

    // Resize 监听
    const observer = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* ignore */ }
    })
    observer.observe(container)

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
      disposedRef.current = true
      clearTimeout(fitTimer)
      observer.disconnect()
      unsubData()
      unsubConnected()
      unsubDisconnected()
      unsubError()
      // 关键：断开 xterm 与 DOM 的关联，阻止残留的 rAF 回调
      try { term._core?.viewport?._innerRefresh?.(); } catch {}
      term.dispose()
      // 清空容器 DOM 避免任何残留引用
      if (container) {
        container.innerHTML = ''
      }
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [connectionId, sessionId])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden bg-slate-950 px-1 ${className}`}
      style={{ minHeight: 0 }}
    />
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
}

interface SplitContainerProps {
  splits: SplitDef[]
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string) => void
  connections: Array<{ id: string; name: string }>
}

export function SplitContainer({
  splits,
  onSplit,
  onRemove,
  onConnectionChange,
  connections,
}: SplitContainerProps) {
  if (splits.length === 0) return null

  // 单个分屏
  if (splits.length === 1) {
    return (
      <SplitPane
        split={splits[0]}
        onSplit={onSplit}
        onRemove={onRemove}
        onConnectionChange={onConnectionChange}
        connections={connections}
      />
    )
  }

  // 多个分屏：根据各自方向分组
  const firstDirection = splits[0].direction
  const groupA: SplitDef[] = []
  const groupB: SplitDef[] = []

  // 按 50/50 分配或按方向分组
  const mid = Math.ceil(splits.length / 2)
  for (let i = 0; i < splits.length; i++) {
    if (i < mid) groupA.push(splits[i])
    else groupB.push(splits[i])
  }

  return (
    <div
      className={`flex flex-1 overflow-hidden ${
        firstDirection === 'vertical' ? 'flex-col' : 'flex-row'
      }`}
      style={{ minHeight: 0 }}
    >
      <div
        className="flex overflow-hidden"
        style={{ flex: groupA.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          splits={groupA}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
        />
      </div>

      {/* 分割线 */}
      <div
        className={`shrink-0 bg-slate-700/50 ${
          firstDirection === 'vertical' ? 'h-px' : 'w-px'
        }`}
      />

      <div
        className="flex overflow-hidden"
        style={{ flex: groupB.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          splits={groupB}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
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
}: {
  split: SplitDef
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string) => void
  connections: Array<{ id: string; name: string }>
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
      {/* 分屏工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-2 py-1">
        <div className="flex items-center gap-1">
          <select
            value={split.connectionId}
            onChange={(e) => onConnectionChange(split.id, e.target.value)}
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
          {/* 垂直分屏 */}
          <button
            onClick={() => onSplit(split.id, 'vertical')}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="垂直分屏"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
          {/* 水平分屏 */}
          <button
            onClick={() => onSplit(split.id, 'horizontal')}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="水平分屏"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </button>
          <div className="mx-1 h-3 w-px bg-slate-700/50" />
          {/* 关闭分屏 */}
          <button
            onClick={() => onRemove(split.id)}
            className="btn-icon text-slate-600 hover:text-red-400"
            title="关闭分屏"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
      />
    </div>
  )
}
