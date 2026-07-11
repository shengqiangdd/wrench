import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ScrollText, ChevronDown } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { ensureSshConnection } from '../../services/ssh-ensure'
import LogViewer from './LogViewer'
import SourceConfig from './SourceConfig'

export default function LogsPage() {
  const connections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)

  const [currentConnId, setCurrentConnId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  // 可选主机列表：从 connections 取（不需要先 SSH 连接）
  const availableHosts = useMemo(
    () =>
      connections.map((conn) => ({
        id: conn.id,
        name: conn.name || conn.host,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        privateKey: conn.privateKey,
      })),
    [connections],
  )

  // 选中的主机 — 从 connections 初始化
  const [selectedId, setSelectedId] = useState<string | null>(() => connections[0]?.id ?? null)

  // 确保 SSH 连接
  useEffect(() => {
    if (!selectedId) return
    const host = availableHosts.find((h) => h.id === selectedId)
    if (!host) return

    let cancelled = false
    const run = async () => {
      // 检查是否已有活跃 session 关联该 connectionId
      const existingSession = sessions.find((s) => s.connectionId === selectedId)
      if (existingSession) {
        if (!cancelled) setCurrentConnId(existingSession.id)
        return
      }

      setConnecting(true)
      try {
        const connId = await ensureSshConnection({
          host: host.host,
          port: host.port,
          username: host.username,
          password: host.password,
          privateKey: host.privateKey,
        })
        if (!cancelled) setCurrentConnId(connId)
      } catch {
        if (!cancelled) setCurrentConnId(null)
      } finally {
        if (!cancelled) setConnecting(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [selectedId, availableHosts, sessions])

  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(true)

  // 追踪 connectionId 变化，通知 SourceConfig 重新扫描
  const [scanKey, setScanKey] = useState(0)
  const prevConnIdRef = useRef(currentConnId)
  useEffect(() => {
    if (currentConnId !== prevConnIdRef.current) {
      prevConnIdRef.current = currentConnId
      setCurrentPath(null)
      setScanKey((k) => k + 1)
    }
  }, [currentConnId])

  const handleSelectPath = useCallback((path: string) => {
    setCurrentPath(path)
  }, [])

  const handleSessionChange = useCallback((id: string) => {
    setSelectedId(id)
    setCurrentPath(null)
  }, [])

  if (!currentConnId && !connecting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-500">
        <ScrollText size={48} className="text-slate-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">
            {availableHosts.length === 0 ? '未添加任何主机' : '选择主机以连接'}
          </p>
          <p className="mt-1 text-xs">
            {availableHosts.length === 0
              ? '请先在设置中添加 SSH 连接配置'
              : '从下拉框选择主机，将自动建立连接'}
          </p>
        </div>
      </div>
    )
  }

  const currentHostLabel = availableHosts.find((h) => h.id === selectedId)?.name || selectedId || ''

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <ScrollText size={18} className="text-sky-400" />
        <h1 className="text-sm font-semibold text-slate-200">日志聚合</h1>

        {availableHosts.length > 0 && (
          <div className="relative">
            <select
              value={selectedId || ''}
              onChange={(e) => handleSessionChange(e.target.value)}
              className="ml-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:ring-1 focus:ring-sky-500 focus:outline-none"
            >
              {availableHosts.map((h) => (
                <option key={h.id} value={h.id} className="bg-slate-800">
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

        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
          {currentHostLabel}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setSourcePanelOpen(!sourcePanelOpen)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            {sourcePanelOpen ? '收起' : '展开'} 日志源
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 始终渲染 SourceConfig，用 CSS 隐藏，避免重建丢失状态 */}
        <div
          className="shrink-0 overflow-y-auto border-r border-slate-700/50 bg-slate-900/50 transition-all"
          style={{ width: sourcePanelOpen ? 224 : 0, overflow: 'hidden' }}
        >
          <SourceConfig
            scanKey={scanKey}
            connectionId={currentConnId}
            onSelectPath={handleSelectPath}
          />
        </div>
        <div className="min-w-0 flex-1 overflow-hidden">
          {currentPath ? (
            <LogViewer
              connectionId={currentConnId}
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
