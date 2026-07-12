import { useState, useEffect, useRef, useCallback, useReducer, memo } from 'react'
import { Download, Search, X, ArrowUpDown, Radio, Activity, AlertTriangle } from 'lucide-react'
import { authedFetch, buildWsUrl } from '../../services/auth'

/** 将常见 SSH/系统错误转为友好提示 */
function friendlyError(raw: string, path: string): { title: string; hint: string } | null {
  const lower = raw.toLowerCase()
  if (lower.includes('permission denied')) {
    return {
      title: '权限不足，无法读取日志文件',
      hint: `文件 ${path} 需要 root 权限才能读取。请确认 SSH 用户具有 sudo 权限，或切换到有权限的日志源。`,
    }
  }
  if (lower.includes('no such file')) {
    return {
      title: '日志文件不存在',
      hint: `文件 ${path} 在目标服务器上不存在，请检查路径是否正确。`,
    }
  }
  return null
}

interface LogViewerProps {
  connectionId: string | null
  logPath: string
  onClose?: () => void
}

function LogViewerInner({ connectionId, logPath, onClose }: LogViewerProps) {
  type LogsFetchState = {
    status: 'loading' | 'idle' | 'error'
    data: string
    errorMsg: string | null
  }
  const [{ status, data: content, errorMsg }, dispatch] = useReducer(
    (s: LogsFetchState, a: Partial<LogsFetchState>) => ({ ...s, ...a }),
    { status: 'loading', data: '', errorMsg: null } as LogsFetchState,
  )
  const [lineCount, setLineCount] = useState(200)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResult, setSearchResult] = useState<string>('')
  const [searching, setSearching] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [followMode, setFollowMode] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const requestIdRef = useRef<string | undefined>(undefined)
  const contentRef = useRef(content)
  useEffect(() => {
    contentRef.current = content
  }, [content])

  useEffect(() => {
    requestIdRef.current = `logtail-${Date.now()}`
  }, [])

  // ─── 获取初始日志（REST） ───
  const fetchLogs = useCallback(async () => {
    dispatch({ status: 'loading' })
    try {
      
      const res = await authedFetch('/api/logs/tail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, path: logPath, lines: lineCount }),
      })
      const json = await res.json()
      if (json.success) {
        // 后端返回 { content, path, lines, total_lines } 对象
        const logData = json.data
        const text =
          typeof logData === 'string' ? logData : (logData?.content ?? JSON.stringify(logData))
        dispatch({ status: 'idle', data: text, errorMsg: null })
      } else {
        dispatch({ status: 'error', errorMsg: json.error || '获取日志失败' })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      dispatch({ status: 'error', errorMsg: msg })
    }
  }, [connectionId, logPath, lineCount])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // ─── 自动滚动 ───
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, autoScroll])

  // ─── WebSocket 实时跟踪 ───
  const startFollow = useCallback(async () => {
    dispatch({ errorMsg: null })
    try {
      
      const wsUrl = await buildWsUrl('/ws')
      const ws = new WebSocket(wsUrl)
      const reqId = requestIdRef.current
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'logtail_start',
            connectionId,
            requestId: reqId,
            logPath,
            lines: lineCount,
          }),
        )
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'logtail_started') {
            setFollowMode(true)
          } else if (msg.type === 'logtail_data' && msg.lines) {
            const prev = contentRef.current
            const combined = prev + (prev.endsWith('\n') ? '' : '\n') + msg.lines.join('\n')
            const lineArr = combined.split('\n')
            const newData =
              lineArr.length > 50000 ? lineArr.slice(lineArr.length - 50000).join('\n') : combined
            dispatch({ data: newData })
          } else if (msg.type === 'logtail_stopped') {
            setFollowMode(false)
          } else if (msg.type === 'error') {
            dispatch({ errorMsg: msg.message })
            setFollowMode(false)
          }
        } catch {
          /* ignore parse errors */
        }
      }

      ws.onerror = () => {
        dispatch({ errorMsg: 'WebSocket 连接失败' })
        setFollowMode(false)
      }

      ws.onclose = () => {
        setFollowMode(false)
        wsRef.current = null
      }
    } catch (err) {
      dispatch({ errorMsg: err instanceof Error ? err.message : '无法获取认证令牌' })
    }
  }, [connectionId, logPath, lineCount])

  // 停止跟踪
  const stopFollow = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'logtail_stop',
          connectionId,
          requestId: requestIdRef.current,
          logPath,
        }),
      )
      wsRef.current.close()
    }
    wsRef.current = null
    setFollowMode(false)
  }, [connectionId, logPath])

  // 切换跟踪
  const toggleFollow = useCallback(() => {
    if (followMode) {
      stopFollow()
    } else {
      startFollow()
    }
  }, [followMode, startFollow, stopFollow])

  // 组件卸载时停止跟踪
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.send(
            JSON.stringify({
              type: 'logtail_stop',
              connectionId,
              logPath,
            }),
          )
        } catch {}
        wsRef.current.close()
      }
    }
  }, [connectionId, logPath])

  // ─── 搜索 ───
  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) return
    setSearching(true)
    setSearchResult('')
    try {
      
      const res = await authedFetch('/api/logs/grep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, path: logPath, pattern: searchTerm, context: 2 }),
      })
      const json = await res.json()
      if (json.success) {
        // 后端返回 { content, pattern, path } 对象
        const grepData = json.data
        const text =
          typeof grepData === 'string' ? grepData : (grepData?.content ?? JSON.stringify(grepData))
        setSearchResult(text.trim() || '未找到匹配内容')
      } else {
        setSearchResult(`搜索错误: ${json.error}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setSearchResult(`请求失败: ${msg}`)
    } finally {
      setSearching(false)
    }
  }, [connectionId, logPath, searchTerm])

  // ─── 下载 ───
  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const fileName = logPath.replace(/^.*[/\\]/, '') || `log-${Date.now()}.log`
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }, [content, logPath])

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-3 py-1.5 text-xs">
        <span className="text-slate-400">📄</span>
        <span className="font-mono text-slate-300">{logPath}</span>

        {/* 行数选择（仅非跟踪模式可用） */}
        {!followMode && (
          <select
            value={lineCount}
            onChange={(e) => setLineCount(Number(e.target.value))}
            className="ml-auto rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300"
          >
            <option value={50}>50行</option>
            <option value={200}>200行</option>
            <option value={500}>500行</option>
            <option value={1000}>1000行</option>
            <option value={5000}>5000行</option>
          </select>
        )}

        <button
          onClick={fetchLogs}
          disabled={status === 'loading' || followMode}
          className="rounded px-2 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
        >
          {status === 'loading' ? '加载中...' : '刷新'}
        </button>

        {/* 实时跟踪按钮 */}
        <button
          onClick={toggleFollow}
          className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
            followMode
              ? 'bg-emerald-600/20 text-emerald-400'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title={followMode ? '停止实时跟踪' : '实时跟踪 (tail -f)'}
        >
          {followMode ? <Activity size={14} /> : <Radio size={14} />}
          {followMode ? '跟踪中' : '跟踪'}
        </button>

        {/* 搜索按钮 */}
        <button
          onClick={() => setSearchResult((prev) => (prev ? '' : ' '))}
          className={`rounded px-2 py-0.5 transition-colors ${
            searchResult
              ? 'bg-wrench-600/20 text-wrench-400'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="搜索"
        >
          <Search size={14} />
        </button>

        {/* 自动滚动 */}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`rounded px-1.5 py-0.5 transition-colors ${
            autoScroll ? 'text-wrench-400' : 'text-slate-500 hover:text-slate-300'
          }`}
          title="自动滚动"
        >
          <ArrowUpDown size={14} />
        </button>

        <button
          onClick={handleDownload}
          className="rounded px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          title="下载"
        >
          <Download size={14} />
        </button>

        <button
          onClick={() => onClose?.()}
          className="rounded px-1.5 py-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <X size={14} />
        </button>
      </div>

      {/* 搜索面板 */}
      {searchResult !== '' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/30 bg-slate-900/60 px-3 py-1.5">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索关键词..."
            className="focus:border-wrench-500 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchTerm.trim()}
            className="bg-wrench-600/80 hover:bg-wrench-500 rounded px-2 py-1 text-xs text-white transition-colors disabled:opacity-50"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
          <button
            onClick={() => {
              setSearchResult('')
              setSearchTerm('')
            }}
            className="rounded px-1.5 py-1 text-xs text-slate-500 hover:text-slate-300"
          >
            关闭
          </button>
        </div>
      )}

      {/* 搜索结果 */}
      {searchResult && !searching && (
        <div className="max-h-40 shrink-0 overflow-auto border-b border-slate-700/30 bg-slate-900/40 p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
            <Search size={12} />
            <span>搜索结果</span>
          </div>
          <pre className="text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
            {searchResult}
          </pre>
        </div>
      )}

      {/* 错误提示 */}
      {errorMsg &&
        (() => {
          const friendly = friendlyError(errorMsg, logPath)
          return (
            <div className="shrink-0 border-b border-red-900/30 bg-red-950/20 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 text-red-400">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="font-medium">{friendly ? friendly.title : errorMsg}</span>
              </div>
              {friendly && <p className="mt-1 pl-5 text-[11px] text-red-400/70">{friendly.hint}</p>}
            </div>
          )
        })()}

      {/* 日志内容 */}
      <div ref={scrollRef} className="flex-1 overflow-auto bg-slate-950/80">
        {status === 'loading' && !content ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          </div>
        ) : (
          <pre className="min-h-full p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-300">
            {content || '(空)'}
          </pre>
        )}
      </div>

      {/* 跟踪模式指示条 */}
      {followMode && (
        <div className="flex shrink-0 items-center gap-2 border-t border-emerald-800/40 bg-emerald-950/30 px-3 py-1">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-[10px] text-emerald-400">实时跟踪中 — 新行将自动追加</span>
        </div>
      )}
    </div>
  )
}

export default memo(LogViewerInner)
