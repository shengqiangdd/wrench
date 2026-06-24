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
 /** 命令同步：收到用户输入时回调（用于广播到同组其他分屏） */
 onTerminalData?: (data: string) => void
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

export default function TerminalView({ connectionId, sessionId, className = '', onConnected, onDisconnected, onTerminalData }: Props) {
 const containerRef = useRef<HTMLDivElement>(null)
 const terminalRef = useRef<XTerm | null>(null)
 const fitAddonRef = useRef<FitAddon | null>(null)
 const connectedRef = useRef(false)
 const disposedRef = useRef(false)
 const wsClient = getWsClient()

 // 初始化 xterm 实例
 const initTerminal = useCallback(() => {
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

 disposedRef.current = false
 const result = initTerminal()
 if (!result) return
 const { term, fitAddon } = result

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
 // 命令同步：广播到同组其他分屏
 onTerminalData?.(encoded)
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

 // Resize 监听 — 用 rAF 确保 DOM 就绪后再 fit
 const doFit = () => {
 if (disposedRef.current) return
 requestAnimationFrame(() => {
 if (disposedRef.current) return
 try { fitAddon.fit() } catch { /* ignore */ }
 })
 }
 const observer = new ResizeObserver(doFit)
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

 // 定时检查 term 是否还存活（避免残留 rAF 导致崩溃）
 const healthCheck = setInterval(() => {
 if (disposedRef.current) {
 clearInterval(healthCheck)
 return
 }
 if (!document.contains(container)) {
 clearInterval(healthCheck)
 disposedRef.current = true
 observer.disconnect()
 try {
 if (terminalRef.current) {
 terminalRef.current.dispose()
 terminalRef.current = null
 }
 } catch {}
 }
 }, 3000)

 return () => {
 disposedRef.current = true
 clearTimeout(fitTimer)
 clearInterval(healthCheck)
 observer.disconnect()
 unsubData()
 unsubConnected()
 unsubDisconnected()
 unsubError()
 try { term.dispose() } catch {}
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
 onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
 connections: Array<{ id: string; name: string }>
 /** 命令同步切换 */
 onToggleSync?: (id: string) => void
 /** 拖动合并 */
 onMerge?: (sourceId: string, targetId: string, position: 'left' | 'right' | 'top' | 'bottom') => void
 /** 同步组映射：syncGroup → split ID 列表 */
 syncGroups?: Record<string, string[]>
 /** 当前活跃的分屏 ID */
 activeSplitId?: string | null
 onSetActiveSplit?: (id: string) => void
 /** 命令同步：分屏收到的终端输入 */
 onTerminalData?: (sessionId: string, data: string) => void
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
}: SplitContainerProps) {
 if (splits.length === 0) return null

 // 单个分屏
 if (splits.length === 1) {
 return (
 <SplitPane
 key={splits[0].id}
 split={splits[0]}
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
 />
 )
 }

 // 多个分屏：按 50/50 分配
 const firstDirection = splits[0].direction
 const groupA: SplitDef[] = []
 const groupB: SplitDef[] = []
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
 key="group-a"
 className="flex overflow-hidden"
 style={{ flex: groupA.length, minHeight: 0, minWidth: 0 }}
 >
 <SplitContainer
 key={`split-a-${groupA.map((s) => s.id).join('-')}`}
 splits={groupA}
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
 />
 </div>

 {/* 分割线 */}
 <div
 key="divider"
 className={`shrink-0 bg-slate-700/50 ${
 firstDirection === 'vertical' ? 'h-px' : 'w-px'
 }`}
 />

 <div
 key="group-b"
 className="flex overflow-hidden"
 style={{ flex: groupB.length, minHeight: 0, minWidth: 0 }}
 >
      <SplitContainer
        key={`split-b-${groupB.map((s) => s.id).join('-')}`}
        splits={groupB}
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
}: {
 split: SplitDef
 onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
 onRemove: (id: string) => void
 onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
 connections: Array<{ id: string; name: string }>
 onToggleSync?: (id: string) => void
 onMerge?: (sourceId: string, targetId: string, position: 'left' | 'right' | 'top' | 'bottom') => void
 syncGroups?: Record<string, string[]>
 activeSplitId?: string | null
 onSetActiveSplit?: (id: string) => void
}) {
 const isSyncOn = !!split.syncGroup
 const groupId = split.syncGroup || ''
 const groupMembers = (groupId && syncGroups?.[groupId]) || []
 const isActive = activeSplitId === split.id

 // 拖拽状态
 const [dragOver, setDragOver] = useState<'none' | 'left' | 'right' | 'top' | 'bottom'>('none')
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
 const threshold = 0.3 // 30% 边缘触发

 if (x / rect.width < threshold) {
 setDragOver('left')
 } else if (x / rect.width > 1 - threshold) {
 setDragOver('right')
 } else if (y / rect.height < threshold) {
 setDragOver('top')
 } else if (y / rect.height > 1 - threshold) {
 setDragOver('bottom')
 } else {
 setDragOver('none')
 }
 }

 const handleDragLeave = () => {
 setDragOver('none')
 }

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault()
 const sourceId = e.dataTransfer.getData('text/plain')
 if (!sourceId || sourceId === split.id || !onMerge) return
 setDragOver('none')
 // 映射 dragOver 状态到位置
 const posMap: Record<string, 'left' | 'right' | 'top' | 'bottom'> = {
 left: 'left', right: 'right', top: 'top', bottom: 'bottom',
 }
 const pos = posMap[dragOver] || 'left'
 onMerge(sourceId, split.id, pos)
 }

 // 计算边框高亮
 const borderStyles = (() => {
 if (dragOver === 'none') return {}
 const color = 'rgba(34, 211, 238, 0.5)' // cyan-400
 switch (dragOver) {
 case 'left': return { borderLeft: `3px solid ${color}` }
 case 'right': return { borderRight: `3px solid ${color}` }
 case 'top': return { borderTop: `3px solid ${color}` }
 case 'bottom': return { borderBottom: `3px solid ${color}` }
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
 onClick={(e) => { e.stopPropagation(); onToggleSync(split.id) }}
 className={`btn-icon relative ${
 isSyncOn ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400'
 }`}
 title={
 isSyncOn
 ? `命令同步中 (${groupMembers.length} 个分屏)`
 : '开启命令同步'
 }
 >
 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
 <path d="M5 12h14M12 5l7 7-7 7" />
 </svg>
 {isSyncOn && groupMembers.length > 1 && (
 <span className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-cyan-500 text-[8px] text-white">
 {groupMembers.length}
 </span>
 )}
 </button>
 )}
 {/* 垂直分屏 */}
 <button
 onClick={(e) => { e.stopPropagation(); onSplit(split.id, 'vertical') }}
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
 onClick={(e) => { e.stopPropagation(); onSplit(split.id, 'horizontal') }}
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
 onClick={(e) => { e.stopPropagation(); onRemove(split.id) }}
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
