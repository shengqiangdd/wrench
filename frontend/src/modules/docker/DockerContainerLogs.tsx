import { useReducer, useRef, useCallback, useState, useEffect } from 'react'
import { X, Loader2, Download } from 'lucide-react'
import { authedFetch } from '../../services/auth'

interface Props {
  connectionId: string
  containerName: string
  onClose: () => void
}

type LogsState = {
  status: 'loading' | 'idle' | 'error'
  data: string
  error: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

function logsReducer(_s: LogsState, a: LogsState): LogsState {
  return a
}

export default function DockerContainerLogs({ connectionId, containerName, onClose }: Props) {
  const [logsState, dispatch] = useReducer(logsReducer, {
    status: 'loading',
    data: '',
    error: null,
  } as LogsState)
  const [tail, setTail] = useState(200)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(
    async (n: number) => {
      dispatch({ status: 'loading', data: '', error: null })
      try {
        const res = await authedFetch('/api/docker/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id: containerName, tail: n }),
        })
        const json = (await res.json()) as ApiResponse
        if (json.success) {
          const output = (json.data?.data ?? json.data ?? '').toString()
          dispatch({ status: 'idle', data: output || '(无日志输出)', error: null })
        } else {
          dispatch({
            status: 'error',
            data: '',
            error: json.error || json.msg || '获取日志失败',
          })
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '请求失败'
        dispatch({ status: 'error', data: '', error: msg })
      }
    },
    [connectionId, containerName],
  )

  useEffect(() => {
    fetchLogs(tail)
  }, [connectionId, containerName, tail, fetchLogs])

  // 自动滚到底部
  useEffect(() => {
    if (scrollRef.current && logsState.data) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logsState.data])

  const handleDownload = () => {
    const blob = new Blob([logsState.data], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${containerName}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 flex h-[80vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">日志 — {containerName}</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              title="下载日志"
            >
              <Download size={14} />
              下载
            </button>
            <button
              onClick={() => fetchLogs(tail)}
              disabled={logsState.status === 'loading'}
              className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
            >
              刷新
            </button>
            <select
              value={tail}
              onChange={(e) => setTail(Number(e.target.value))}
              className="rounded-md border border-slate-700/50 bg-slate-800 px-2 py-1 text-xs text-slate-400 outline-none"
            >
              <option value={50}>最近 50 行</option>
              <option value={200}>最近 200 行</option>
              <option value={500}>最近 500 行</option>
              <option value={2000}>最近 2000 行</option>
              <option value={10000}>全部</option>
            </select>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 日志内容 */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed"
        >
          {logsState.status === 'loading' ? (
            <div className="flex h-full items-center justify-center gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              加载中...
            </div>
          ) : logsState.error ? (
            <div className="flex h-full items-center justify-center text-red-400">
              {logsState.error}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap text-slate-300">
              {logsState.data || '(无日志输出)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
