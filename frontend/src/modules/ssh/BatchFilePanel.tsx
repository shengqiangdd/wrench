import { useState, useCallback, useRef } from 'react'
import { authedFetch } from '../../services/auth'
import {
  X,
  Upload,
  Download,
  File,
  CheckCircle2,
  XCircle,
  Loader2,
  Server,
  Clock,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'

interface TransferTarget {
  connId: string
  name: string
  host: string
  path: string
  status: 'pending' | 'connecting' | 'transferring' | 'success' | 'error'
  progress: number // 0-100
  speed: string // 传输速度
  error?: string
  size: number // 已传输字节
}

type TransferMode = 'upload' | 'command'

export default function BatchFilePanel({ onClose }: { onClose: () => void }) {
  const sessions = useSshStore((s) => s.sessions)
  const [mode, setMode] = useState<TransferMode>('upload')

  // 目标选择
  const [targets, setTargets] = useState<TransferTarget[]>([])

  // 上传状态
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [destPath, setDestPath] = useState('/root/')

  // 远程命令模式
  const [remoteCommand, setRemoteCommand] = useState('')

  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addLog = (msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  // 初始化：加载当前已连接的 sessions
  const loadConnectedSessions = useCallback(() => {
    const available = sessions.map((sess) => {
      return {
        connId: sess.id,
        name: sess.connectionName || sess.id.slice(0, 8),
        host: sess.host || 'unknown',
        path: destPath,
        status: 'pending' as const,
        progress: 0,
        speed: '',
        size: 0,
      }
    })
    setTargets(available)
    if (available.length > 0) {
      addLog(`已加载 ${available.length} 个已连接的主机`)
    } else {
      addLog('⚠️ 没有已连接的 SSH 会话，请先建立连接')
    }
  }, [sessions, destPath])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const toggleTarget = (idx: number) => {
    setTargets((prev) => {
      const next = [...prev]
      const entry = next[idx]!
      next[idx] = { ...entry, status: entry.status === 'pending' ? 'pending' : entry.status }
      return next
    })
  }

  const setTargetPath = (idx: number, path: string) => {
    setTargets((prev) => {
      const next = [...prev]
      const entry = next[idx]!
      next[idx] = { ...entry, path }
      return next
    })
  }

  const setAllDestPath = (path: string) => {
    setDestPath(path)
    setTargets((prev) => prev.map((t) => ({ ...t, path })))
  }

  // 文件选择
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      addLog(`已选择文件: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
    }
  }

  // 通过 REST API 上传文件
  const uploadFileViaRest = async (
    connId: string,
    path: string,
    file: File,
    targetIdx: number,
  ): Promise<void> => {
    // 读取文件为 base64
    const arrayBuffer = await file.arrayBuffer()
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''),
    )

    setTargets((prev) => {
      const next = [...prev]
      next[targetIdx] = { ...next[targetIdx]!, progress: 40 }
      return next
    })

    const res = await authedFetch('/api/sftp/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: connId, path, data: base64 }),
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error')
      throw new Error(`HTTP ${res.status}: ${errorText}`)
    }

    const json = await res.json()

    if (!json.success) {
      throw new Error(String(json.error || '上传失败'))
    }

    setTargets((prev) => {
      const next = [...prev]
      next[targetIdx] = { ...next[targetIdx]!, progress: 100, size: file.size }
      return next
    })
  }

  // 执行上传
  const startUpload = useCallback(async () => {
    if (!selectedFile || targets.length === 0) return

    setRunning(true)
    const file = selectedFile

    // 对所有目标执行上传
    for (let i = 0; i < targets.length; i++) {
      const target: TransferTarget = targets[i]!
      if (target.status !== 'pending') continue

      setTargets((prev) => {
        const next = [...prev]
        const entry = next[i]!
        next[i] = { ...entry, status: 'connecting', progress: 0 }
        return next
      })

      try {
        const fullPath = `${target.path.replace(/\/$/, '')}/${file.name}`
        addLog(`📤 [${target.name}] 上传到 ${fullPath}`)

        setTargets((prev) => {
          const next = [...prev]
          const entry = next[i]!
          next[i] = { ...entry, status: 'transferring', progress: 10 }
          return next
        })

        // 统一通过 REST API 上传
        await uploadFileViaRest(target.connId as string, fullPath, file, i)

        setTargets((prev) => {
          const next = [...prev]
          const entry = next[i]!
          next[i] = { ...entry, status: 'success', progress: 100 }
          return next
        })
        addLog(`✅ [${target.name}] 上传完成 (${(file.size / 1024).toFixed(1)} KB)`)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '上传失败'
        setTargets((prev) => {
          const next = [...prev]
          const entry = next[i]!
          next[i] = { ...entry, status: 'error', error: msg }
          return next
        })
        addLog(`❌ [${target.name}] 上传失败: ${msg}`)
      }
    }

    setRunning(false)
    addLog('🏁 批量上传完成')
  }, [selectedFile, targets])

  // 执行远程命令
  const startCommand = useCallback(async () => {
    if (!remoteCommand.trim() || targets.length === 0) return

    setRunning(true)

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!
      if (target.status !== 'pending') continue

      setTargets((prev) => {
        const next = [...prev]
        const entry = next[i]!
        next[i] = { ...entry, status: 'connecting', progress: 0 }
        return next
      })

      try {
        addLog(`⚡ [${target.name}] 执行: ${remoteCommand}`)
        const startTime = Date.now()

        const res = await authedFetch('/api/ssh/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: target.connId, command: remoteCommand }),
        })
        const json = await res.json()
        const duration = Date.now() - startTime

        if (json.exitCode === 0) {
          setTargets((prev) => {
            const next = [...prev]
            const entry = next[i]!
            next[i] = { ...entry, status: 'success', progress: 100, speed: `${duration}ms` }
            return next
          })
          addLog(`✅ [${target.name}] 完成 (${duration}ms)`)
        } else {
          setTargets((prev) => {
            const next = [...prev]
            const entry = next[i]!
            next[i] = {
              ...entry,
              status: 'error',
              error: json.stderr?.slice(0, 200) || `退出码: ${json.exitCode}`,
            }
            return next
          })
          addLog(
            `❌ [${target.name}] 失败 (${json.exitCode}): ${(json.stderr || '').slice(0, 100)}`,
          )
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '请求失败'
        setTargets((prev) => {
          const next = [...prev]
          const entry = next[i]!
          next[i] = { ...entry, status: 'error', error: msg }
          return next
        })
        addLog(`❌ [${target.name}] 请求失败: ${msg}`)
      }
    }

    setRunning(false)
    addLog('🏁 批量命令执行完成')
  }, [remoteCommand, targets])

  const selectedCount = targets.filter((t) => t.status === 'pending').length
  const successCount = targets.filter((t) => t.status === 'success').length
  const errorCount = targets.filter((t) => t.status === 'error').length

  return (
    <div className="flex h-full flex-col bg-slate-900">
      {/* 头部 */}
      <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-2">
        <Upload size={16} className="text-wrench-400 mr-2" />
        <h2 className="text-sm font-semibold text-slate-200">批量文件分发</h2>
        <button
          onClick={onClose}
          className="ml-auto min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
        >
          <X size={14} />
        </button>
      </div>

      {/* 模式切换 */}
      <div className="flex shrink-0 border-b border-slate-700/30 px-4">
        <button
          onClick={() => setMode('upload')}
          className={`flex items-center gap-1 border-b-2 px-4 py-2 text-xs transition-colors ${
            mode === 'upload'
              ? 'border-wrench-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <Upload size={13} /> 上传文件
        </button>
        <button
          onClick={() => setMode('command')}
          className={`flex items-center gap-1 border-b-2 px-4 py-2 text-xs transition-colors ${
            mode === 'command'
              ? 'border-wrench-400 text-slate-200'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <Download size={13} /> 远程命令
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：配置区 */}
        <div className="flex w-2/5 flex-col overflow-hidden border-r border-slate-700/30">
          {/* 扫描连接 */}
          <div className="shrink-0 border-b border-slate-700/30 px-4 py-2">
            <button
              onClick={loadConnectedSessions}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-600/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <Server size={13} />
              扫描已连接的主机
            </button>
          </div>

          {/* 目标主机列表 */}
          <div className="flex-1 overflow-auto">
            {targets.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-500">
                点击上方按钮扫描已连接的 SSH 主机
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {targets.map((t, i) => (
                  <div key={i} className="px-3 py-2 transition-colors hover:bg-slate-800/30">
                    <div className="flex items-center gap-2">
                      {/* 状态指示 */}
                      <div
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          t.status === 'success'
                            ? 'bg-emerald-500'
                            : t.status === 'error'
                              ? 'bg-red-500'
                              : t.status === 'transferring' || t.status === 'connecting'
                                ? 'animate-pulse bg-blue-500'
                                : 'bg-slate-600'
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-300">
                        {t.name}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">{t.host}</span>
                    </div>

                    {/* 进度条 */}
                    {t.status === 'transferring' && (
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-700">
                        <div
                          className="bg-wrench-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${t.progress}%` }}
                        />
                      </div>
                    )}

                    {/* 目标路径输入 */}
                    {mode === 'upload' && (
                      <input
                        type="text"
                        value={t.path}
                        onChange={(e) => setTargetPath(i, e.target.value)}
                        placeholder="/root/"
                        className="focus:border-wrench-500/50 mt-1 w-full rounded border border-slate-700/50 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-400 outline-none"
                      />
                    )}

                    {/* 状态信息 */}
                    {t.status === 'error' && (
                      <div className="mt-1 truncate text-[10px] text-red-400">{t.error}</div>
                    )}
                    {t.status === 'success' && (
                      <div className="mt-1 text-[10px] text-emerald-500">完成</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：操作区 */}
        <div className="flex w-3/5 flex-col overflow-hidden">
          {mode === 'upload' ? (
            <>
              {/* 文件选择 */}
              <div className="shrink-0 border-b border-slate-700/30 px-4 py-3">
                <div className="mb-2 text-xs text-slate-400">选择文件</div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="hover:border-wrench-500/50 flex items-center gap-1.5 rounded-md border border-dashed border-slate-600 px-3 py-2 text-xs text-slate-400 transition-colors hover:text-slate-200"
                  >
                    <File size={14} />
                    {selectedFile ? selectedFile.name : '选择文件...'}
                  </button>
                  {selectedFile && (
                    <span className="text-[11px] text-slate-500">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </span>
                  )}
                </div>
              </div>

              {/* 目标路径 */}
              <div className="shrink-0 border-b border-slate-700/30 px-4 py-3">
                <div className="mb-1.5 text-xs text-slate-400">统一目标路径</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={destPath}
                    onChange={(e) => setAllDestPath(e.target.value)}
                    placeholder="/root/"
                    className="focus:border-wrench-500/50 flex-1 rounded-md border border-slate-700/50 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 outline-none"
                  />
                </div>
              </div>

              {/* 执行 */}
              <div className="shrink-0 border-b border-slate-700/30 px-4 py-3">
                <button
                  onClick={startUpload}
                  disabled={!selectedFile || targets.length === 0 || running}
                  className="bg-wrench-600 hover:bg-wrench-500 flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs text-white transition-colors disabled:opacity-50"
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {running
                    ? '上传中...'
                    : `开始上传到 ${successCount + errorCount + selectedCount} 台主机`}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* 命令输入 */}
              <div className="shrink-0 border-b border-slate-700/30 px-4 py-3">
                <div className="mb-1.5 text-xs text-slate-400">远程命令</div>
                <textarea
                  value={remoteCommand}
                  onChange={(e) => setRemoteCommand(e.target.value)}
                  placeholder="例如: rm -rf /tmp/cache/*"
                  rows={3}
                  className="focus:border-wrench-500/50 w-full resize-none rounded-md border border-slate-700/50 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-500 outline-none"
                />
              </div>

              {/* 执行 */}
              <div className="shrink-0 border-b border-slate-700/30 px-4 py-3">
                <button
                  onClick={startCommand}
                  disabled={!remoteCommand.trim() || targets.length === 0 || running}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 py-2 text-xs text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
                >
                  {running ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  {running
                    ? '执行中...'
                    : `批量执行命令到 ${successCount + errorCount + selectedCount} 台主机`}
                </button>
              </div>
            </>
          )}

          {/* 状态统计 */}
          {targets.length > 0 && (
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-700/30 px-4 py-1.5">
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <Server size={12} /> {targets.length} 台
              </div>
              <div className="flex items-center gap-1 text-[11px] text-emerald-500">
                <CheckCircle2 size={12} /> {successCount}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-red-400">
                <XCircle size={12} /> {errorCount}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <Clock size={12} /> {selectedCount} 待处理
              </div>
            </div>
          )}

          {/* 日志 */}
          <div className="flex-1 overflow-auto p-3">
            {log.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-600">
                操作日志将显示在这里
              </div>
            ) : (
              <div className="space-y-1">
                {log.map((entry, i) => (
                  <div key={i} className="font-mono text-[11px] leading-relaxed text-slate-400">
                    {entry}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
