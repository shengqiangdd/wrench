import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X } from 'lucide-react'
import { getWsClientSync } from '../../services/websocket'

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

export default function DockerTerminal({
  connectionId,
  containerId,
  shell = '/bin/bash',
  onClose,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const openedRef = useRef(false)

  useEffect(() => {
    if (openedRef.current) return
    openedRef.current = true

    const term = new XTerm({
      theme: TERMINAL_THEME,
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', Menlo, monospace",
      allowTransparency: true,
      rows: 30,
      cols: 100,
    })
    terminalRef.current = term

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    if (containerRef.current) {
      term.open(containerRef.current)
      setTimeout(() => fitAddon.fit(), 100)
    }

    const wsClient = getWsClientSync()
    const reqId = `docker-shell-${containerId}`
    let connected = false

    // 消息订阅
    const unsubReady = wsClient.on('docker_shell_ready', (msg) => {
      if (msg.connectionId !== connectionId && msg.requestId !== reqId) return
      connected = true
      term.focus()
      setTimeout(() => fitAddon.fit(), 200)
    })

    const unsubOutput = wsClient.on('docker_shell_output', (msg) => {
      if (msg.connectionId !== connectionId) return
      const data = atob(msg.data as string)
      term.write(data)
    })

    const unsubClosed = wsClient.on('docker_shell_closed', (msg) => {
      if (msg.connectionId !== connectionId) return
      term.write(`\r\n\x1b[31m[容器终端已关闭，退出码: ${msg.exitCode}]\x1b[0m\r\n`)
      connected = false
    })

    // 连接容器 shell
    wsClient.send({
      type: 'docker_shell',
      connectionId,
      requestId: reqId,
      containerId,
      shell,
    })

    // 键盘输入 → WebSocket
    const disposeInput = term.onData((data) => {
      if (!connected) return
      wsClient.send({
        type: 'docker_shell_data',
        connectionId,
        containerId,
        data: btoa(data),
      })
    })

    // 终端大小变化 → resize
    const disposeResize = term.onResize(({ cols, rows }) => {
      if (!connected) return
      wsClient.send({
        type: 'docker_shell_resize',
        connectionId,
        containerId,
        cols,
        rows,
      })
    })

    // 窗口 resize → fit
    const onWindowResize = () => {
      if (fitAddon && connected) {
        fitAddon.fit()
      }
    }
    window.addEventListener('resize', onWindowResize)

    return () => {
      window.removeEventListener('resize', onWindowResize)
      disposeInput.dispose()
      disposeResize.dispose()
      unsubReady()
      unsubOutput()
      unsubClosed()
      // 关闭容器 shell
      if (connected) {
        wsClient.send({
          type: 'docker_shell_data',
          connectionId,
          containerId,
          data: btoa('exit\r'),
        })
      }
      term.dispose()
    }
  }, [connectionId, containerId, shell])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-2 flex h-[80vh] w-full max-w-5xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-2.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="ml-2 font-mono text-sm text-slate-200">
            Docker: <span className="text-smartbox-400">{containerId.slice(0, 12)}</span>
          </span>
          <span className="ml-2 text-xs text-slate-500">
            {shell} — {connectionId}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => fitAddonRef.current?.fit()}
              className="rounded px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              适应
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 终端区域 */}
        <div ref={containerRef} className="flex-1 overflow-hidden bg-slate-950" />
      </div>
    </div>
  )
}
