import { useState, useCallback, useRef, useEffect } from 'react'
import { ScrollText, ChevronDown } from 'lucide-react'
import { useSshHostSelector } from '../../hooks/useSshHostSelector'
import LogViewer from './LogViewer'
import SourceConfig from './SourceConfig'

export default function LogsPage() {
  // ── 统一主机选择器 ──
  const { hosts, selectedId, setSelectedId, connectionId, connecting, hostLabel, hasHosts } =
    useSshHostSelector()

  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  )

  // 追踪 connectionId 变化，通知 SourceConfig 重新扫描
  const [scanKey, setScanKey] = useState(0)
  const prevConnIdRef = useRef(connectionId)
  useEffect(() => {
    if (connectionId !== prevConnIdRef.current) {
      prevConnIdRef.current = connectionId
      setCurrentPath(null)
      setScanKey((k) => k + 1)
    }
  }, [connectionId])

  // 监听窗口大小变化，移动端自动收起源面板
  // 注意：排除输入法弹出引起的 resize（height 大幅变化但 width 基本不变）
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768
      setIsMobile(mobile)
      if (mobile) setSourcePanelOpen(false)
    }
    // 记录初始尺寸，用于区分是否由输入法引起的 resize
    let lastWidth = window.innerWidth
    let lastHeight = window.innerHeight
    const throttledResize = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      const widthDelta = Math.abs(w - lastWidth)
      const heightDelta = Math.abs(h - lastHeight)
      // 如果 width 没变但 height 变了很多，大概率是输入法弹出/收起，忽略
      if (widthDelta < 50 && heightDelta > 100) {
        lastWidth = w
        lastHeight = h
        return
      }
      lastWidth = w
      lastHeight = h
      handleResize()
    }
    window.addEventListener('resize', throttledResize)
    return () => window.removeEventListener('resize', throttledResize)
  }, [])

  const handleSelectPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleHostChange = useCallback(
    (id: string) => {
      setSelectedId(id)
      setCurrentPath(null)
    },
    [setSelectedId],
  )

  // ── 无连接时的占位 UI ──
  if (!connectionId && !connecting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
        <ScrollText size={48} className="text-slate-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">
            {hasHosts ? '选择主机以连接' : '未找到可用主机'}
          </p>
          <p className="mt-1 text-xs">
            {hasHosts
              ? '从下拉框选择主机，将自动建立连接'
              : '请先在 SSH 页面添加连接，或配置环境变量测试主机'}
          </p>
        </div>
        {hosts.length > 0 && (
          <div className="relative">
            <select
              value={selectedId || ''}
              onChange={(e) => handleHostChange(e.target.value)}
              className="appearance-none rounded-md border border-slate-700 bg-slate-800 px-3 py-2 pr-8 text-sm text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id} className="bg-slate-800">
                  {h.source === 'test-config' ? '⚡ ' : ''}
                  {h.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500"
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-700/50 bg-slate-900/80 px-3 py-2 sm:px-4">
        <ScrollText size={16} className="shrink-0 text-sky-400" />
        <h1 className="text-sm font-semibold text-slate-200">日志聚合</h1>

        {hosts.length > 0 && (
          <div className="relative">
            <select
              value={selectedId || ''}
              onChange={(e) => handleHostChange(e.target.value)}
              className="appearance-none rounded-md border border-slate-700 bg-slate-800 px-2 py-1 pr-6 text-xs text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {hosts.map((h) => (
                <option key={h.id} value={h.id} className="bg-slate-800">
                  {h.source === 'test-config' ? '⚡ ' : ''}
                  {h.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-slate-500"
            />
          </div>
        )}

        {connecting && <span className="animate-pulse text-xs text-yellow-400">连接中...</span>}

        {hostLabel && !connecting && (
          <span className="hidden rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">
            {hostLabel}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSourcePanelOpen(!sourcePanelOpen)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            {sourcePanelOpen ? '收起' : '展开'} 日志源
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* 始终渲染 SourceConfig，用 CSS 隐藏，避免重建丢失状态 */}
        <div
          className={`shrink-0 overflow-y-auto bg-slate-900/50 transition-all ${
            isMobile && sourcePanelOpen
              ? 'absolute inset-0 z-20 w-full border-r border-slate-700/50'
              : 'border-r border-slate-700/50'
          }`}
          style={{
            width: isMobile && sourcePanelOpen ? '100%' : sourcePanelOpen ? 224 : 0,
            overflow: 'hidden',
          }}
        >
          <SourceConfig
            scanKey={scanKey}
            connectionId={connectionId}
            onSelectPath={(path) => {
              handleSelectPath(path)
              // 移动端选择日志后自动关闭面板
              if (isMobile) setSourcePanelOpen(false)
            }}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {currentPath ? (
            <LogViewer
              connectionId={connectionId}
              logPath={currentPath}
              onClose={() => setCurrentPath(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-500">
              <p className="text-xs">← 选择一个日志文件开始查看</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
