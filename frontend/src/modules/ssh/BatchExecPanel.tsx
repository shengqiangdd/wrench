import { useState, useCallback, useEffect } from 'react'
import { X, Play, Loader2, CheckCircle2, XCircle, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import type { SshConnection } from '../../types/ssh'

interface BatchResult {
  connId: string
  name: string
  host: string
  status: 'pending' | 'running' | 'success' | 'error'
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
  duration: number
}

type ResultFilter = 'all' | 'success' | 'error'

export default function BatchExecPanel({ onClose }: { onClose: () => void }) {
  const connections = useSshStore((s) => s.connections)
  const [command, setCommand] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<BatchResult[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')

  // 过滤掉快速连接和搜索
  const filteredConnections = connections.filter((c) => !c.id.startsWith('quick_'))

  // 接收从脚本模板库发送的命令
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail?.command) {
        setCommand(e.detail.command)
      }
    }
    window.addEventListener('smartbox:send-to-batch', handler as EventListener)
    return () => window.removeEventListener('smartbox:send-to-batch', handler as EventListener)
  }, [])

  const selectAll = () => {
    if (selectedIds.size === filteredConnections.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredConnections.map((c) => c.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBatch = useCallback(async () => {
    if (!command.trim() || selectedIds.size === 0) return

    setRunning(true)
    const selectedConns = filteredConnections.filter((c) => selectedIds.has(c.id))
    const initialResults: BatchResult[] = selectedConns.map((c) => ({
      connId: c.id,
      name: c.name,
      host: c.host,
      status: 'pending' as const,
      stdout: '',
      stderr: '',
      exitCode: null,
      duration: 0,
    }))
    setResults(initialResults)

    // 并发执行
    const promises = initialResults.map(async (r, idx) => {
      const start = Date.now()
      // 更新状态为 running
      setResults((prev) => {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], status: 'running' }
        return copy
      })

      try {
        const res = await fetch('/api/ssh/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: r.connId, command: command.trim() }),
        })
        const json = await res.json()
        const duration = Date.now() - start

        if (json.error) {
          setResults((prev) => {
            const copy = [...prev]
            copy[idx] = {
              ...copy[idx],
              status: 'error',
              error: json.error,
              stdout: json.stdout || '',
              stderr: json.stderr || '',
              exitCode: json.exitCode ?? null,
              duration,
            }
            return copy
          })
        } else {
          setResults((prev) => {
            const copy = [...prev]
            copy[idx] = {
              ...copy[idx],
              status: json.exitCode === 0 ? 'success' : 'error',
              stdout: json.stdout || '',
              stderr: json.stderr || '',
              exitCode: json.exitCode ?? null,
              duration,
              error: json.exitCode !== 0 ? `exit code: ${json.exitCode}` : undefined,
            }
            return copy
          })
        }
      } catch (err: any) {
        const duration = Date.now() - start
        setResults((prev) => {
          const copy = [...prev]
          copy[idx] = {
            ...copy[idx],
            status: 'error',
            error: err.message || '请求失败',
            stdout: '',
            stderr: '',
            exitCode: null,
            duration,
          }
          return copy
        })
      }
    })

    await Promise.allSettled(promises)
    setRunning(false)
  }, [command, selectedIds, filteredConnections])

  const toggleExpand = (connId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(connId)) next.delete(connId)
      else next.add(connId)
      return next
    })
  }

  // 过滤后的结果
  const filteredResults = results.filter((r) => {
    if (resultFilter === 'success') return r.status === 'success'
    if (resultFilter === 'error') return r.status === 'error'
    return true
  })

  const successCount = results.filter((r) => r.status === 'success').length
  const errorCount = results.filter((r) => r.status === 'error').length
  const pendingCount = results.filter((r) => r.status === 'pending' || r.status === 'running').length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-2 flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        {/* 标题 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-3">
          <Play size={16} className="mr-2 text-smartbox-400" />
          <h2 className="text-sm font-semibold text-slate-200">批量命令执行</h2>
          <button onClick={onClose} className="ml-auto rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：连接选择 */}
          <div className="flex w-64 shrink-0 flex-col border-r border-slate-700/50">
            <div className="flex items-center justify-between border-b border-slate-700/20 px-3 py-2">
              <span className="text-xs font-medium text-slate-400">
                选择服务器
              </span>
              <button
                onClick={selectAll}
                className="text-[10px] text-smartbox-400 hover:text-smartbox-300 transition-colors"
              >
                {selectedIds.size === filteredConnections.length ? '取消全选' : `全选 (${filteredConnections.length})`}
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              {filteredConnections.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                  没有可用的连接
                </div>
              ) : (
                filteredConnections.map((conn) => (
                  <label
                    key={conn.id}
                    className={`flex cursor-pointer items-center gap-2 border-b border-slate-800/30 px-3 py-2 transition-colors hover:bg-slate-800/40 ${
                      selectedIds.has(conn.id) ? 'bg-smartbox-500/5' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(conn.id)}
                      onChange={() => toggleSelect(conn.id)}
                      className="accent-smartbox-500 h-3.5 w-3.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-200">{conn.name}</div>
                      <div className="truncate text-[10px] text-slate-500">{conn.username}@{conn.host}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="border-t border-slate-700/20 px-3 py-1.5 text-right text-[10px] text-slate-600">
              已选 {selectedIds.size} / {filteredConnections.length}
            </div>
          </div>

          {/* 右侧：命令输入 + 结果 */}
          <div className="flex flex-1 flex-col">
            {/* 命令输入 */}
            <div className="border-b border-slate-700/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">命令</span>
                <span className="text-[10px] text-slate-600">支持换行多行命令</span>
              </div>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    runBatch()
                  }
                }}
                placeholder="输入要执行的命令... (Cmd/Ctrl + Enter 执行)"
                className="input min-h-[60px] w-full resize-y text-xs font-mono"
                rows={2}
                disabled={running}
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={runBatch}
                  disabled={!command.trim() || selectedIds.size === 0 || running}
                  className="btn btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {running ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  {running ? '执行中...' : `批量执行 (${selectedIds.size} 台)`}
                </button>

                {/* 结果统计 */}
                {results.length > 0 && (
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1 text-slate-500">
                      总计 <span className="font-medium text-slate-300">{results.length}</span>
                    </span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <CheckCircle2 size={12} />
                      {successCount}
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle size={12} />
                      {errorCount}
                    </span>
                    {pendingCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-400">
                        <Loader2 size={12} className="animate-spin" />
                        {pendingCount}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 结果列表 */}
            {results.length > 0 && (
              <div className="flex flex-1 flex-col overflow-hidden">
                {/* 结果过滤 */}
                <div className="flex items-center gap-1 border-b border-slate-700/20 px-3 py-1.5">
                  {(['all', 'success', 'error'] as ResultFilter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setResultFilter(f)}
                      className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                        resultFilter === f
                          ? 'bg-slate-700 text-slate-200'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {f === 'all' ? '全部' : f === 'success' ? '成功' : '失败'}
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] text-slate-600">
                    {filteredResults.length} 条结果
                  </span>
                </div>

                {/* 结果条目 */}
                <div className="flex-1 overflow-auto">
                  {filteredResults.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-xs text-slate-500">
                      没有匹配的结果
                    </div>
                  ) : (
                    filteredResults.map((r) => (
                      <div key={r.connId} className="border-b border-slate-800/30">
                        {/* 结果标题行 */}
                        <button
                          onClick={() => toggleExpand(r.connId)}
                          className="flex w-full items-center gap-2 px-3 py-2 transition-colors hover:bg-slate-800/30"
                        >
                          {r.status === 'running' ? (
                            <Loader2 size={14} className="shrink-0 animate-spin text-blue-400" />
                          ) : r.status === 'success' ? (
                            <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
                          ) : r.status === 'error' ? (
                            <XCircle size={14} className="shrink-0 text-red-400" />
                          ) : (
                            <AlertCircle size={14} className="shrink-0 text-slate-500" />
                          )}
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-xs font-medium text-slate-200">{r.name}</div>
                            <div className="truncate text-[10px] text-slate-500">{r.host}</div>
                          </div>
                          <span className="text-[10px] text-slate-600">{r.duration}ms</span>
                          {r.exitCode !== null && (
                            <span className={`text-[10px] ${r.exitCode === 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                              exit: {r.exitCode}
                            </span>
                          )}
                          {expanded.has(r.connId) ? (
                            <ChevronDown size={14} className="shrink-0 text-slate-500" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0 text-slate-500" />
                          )}
                        </button>

                        {/* 展开的输出 */}
                        {expanded.has(r.connId) && (
                          <div className="border-t border-slate-800/20 bg-slate-950/50 px-3 py-2">
                            {r.error && (
                              <div className="mb-1 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
                                {r.error}
                              </div>
                            )}
                            {r.stdout ? (
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[11px] leading-relaxed text-slate-300 font-mono">
                                {r.stdout}
                              </pre>
                            ) : (
                              <div className="text-[11px] text-slate-600 italic">(无 stdout 输出)</div>
                            )}
                            {r.stderr && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-[10px] text-amber-400/70">stderr</summary>
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[10px] leading-relaxed text-amber-300/70 font-mono">
                                  {r.stderr}
                                </pre>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* 底部汇总 */}
                <div className="border-t border-slate-700/20 px-3 py-1.5 text-[10px] text-slate-600">
                  总耗时: {results.reduce((acc, r) => Math.max(acc, r.duration), 0)}ms
                  {' · '}
                  成功 {successCount} / 失败 {errorCount}
                </div>
              </div>
            )}

            {/* 空状态 */}
            {results.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <div className="text-center">
                  <Play size={32} className="mx-auto mb-2 text-slate-600" />
                  <p className="text-sm text-slate-500">选择服务器并输入命令</p>
                  <p className="mt-1 text-xs text-slate-600">
                    批量执行将同时发送到多台服务器，汇总结果
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
