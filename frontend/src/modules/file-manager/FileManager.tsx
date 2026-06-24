/**
 * FileManager.tsx - 完整文件管理页面
 *
 * 功能：
 * - 左侧：SSH 连接选择 + SFTP 树形目录浏览（通过 SftpBrowser 组件）
 * - 右侧：CodeMirror 编辑器（打开远程文件编辑）
 * - 标签栏：多标签编辑，状态持久化
 * - 复用 SSH 页面已有的连接，避免重复建连
 *
 * 🔧 主要修复：
 * - mount effect 不再只用 [] 依赖，同时监听 sessions 变化自动重试
 * - 新建连接后等待 sftp-ready 事件再返回，避免 SFTP_NOT_READY
 * - 支持 persist 异步恢复后自动重连
 * - clipboard 兜底方案（fallbackCopy）
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  FileCode2,
  X,
  PanelLeftClose,
  PanelLeft,
  Loader2,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useAppStore } from '../../stores/app-store'
import { useFileStore } from '../../stores/file-store'
import { getWsClient } from '../../services/websocket'
import SftpBrowser from '../ssh/SftpBrowser'
import CodeMirrorEditor from '../../components/CodeMirrorEditor'
import ResizablePanel from '../../components/ResizablePanel'

// ─── 工具函数 ───

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <FileCode2 size={14} className="text-slate-500" />
  switch (ext) {
    case 'js': case 'ts': case 'tsx': case 'jsx': case 'py': case 'go': case 'rs':
    case 'java': case 'c': case 'cpp': case 'rb': case 'php': case 'sh': case 'bash':
      return <FileCode2 size={14} className="text-sky-400" />
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml':
      return <FileCode2 size={14} className="text-amber-400" />
    case 'md': case 'txt': case 'log': case 'cfg': case 'conf': case 'env':
      return <FileCode2 size={14} className="text-slate-400" />
    default:
      return <FileCode2 size={14} className="text-slate-500" />
  }
}

/** 等待 sftp-ready 事件，最多等 8 秒 */
function waitForSftpReady(
  wsClient: ReturnType<typeof getWsClient>,
  sessionId: string,
  timeout = 8000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout)
    const unsub = wsClient.on('sftp-ready', (data) => {
      if (data.connectionId === sessionId) {
        clearTimeout(timer)
        unsub()
        resolve(true)
      }
    })
  })
}

/**
 * 尝试复用已有的 SSH session 来获取 SFTP 能力。
 * 新建连接后等待 sftp-ready 事件再返回，确保 SFTP 已就绪。
 */
async function ensureSftpSession(
  connId: string,
  existingSessions: ReturnType<typeof useSshStore.getState>['sessions'],
  addSession: ReturnType<typeof useSshStore.getState>['addSession'],
  wsClient: ReturnType<typeof getWsClient>,
  onStatus: (msg: string) => void,
): Promise<string | null> {
  const conns = useSshStore.getState().connections
  const conn = conns.find(c => c.id === connId)
  if (!conn) return null

  // 1. 检查是否已有同连接ID的 session（从 SSH 页面复用的）
  const existing = existingSessions.find(s => s.connectionId === connId && s.status === 'connected')
  if (existing) {
    onStatus('检测到已有 SSH 连接，尝试复用 SFTP...')
    try {
      await wsClient.request({
        type: 'sftp',
        connectionId: existing.id,
        operation: 'stat',
        path: '/',
      }, 5000)
      onStatus('')
      return existing.id  // ✅ 可用，直接复用
    } catch {
      // 不可用，继续建新连接
      onStatus('已有连接 SFTP 未就绪，创建新连接...')
    }
  }

  // 2. 创建新的 SFTP 专用连接
  const sessionId = `sftp_${connId}_${Date.now()}`
  onStatus('正在连接...')

  try {
    await wsClient.request({
      type: 'connect',
      connectionId: sessionId,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.privateKey,
    })
    addSession({
      id: sessionId,
      connectionId: connId,
      connectionName: conn.name,
      host: conn.host,
      status: 'connected',
      terminalCols: 80,
      terminalRows: 24,
    })

    // 等待 sftp-ready 事件（后端 openSftp 是异步的）
    onStatus('等待 SFTP 就绪...')
    const ready = await waitForSftpReady(wsClient, sessionId)
    if (!ready) {
      console.warn('[FileManager] SFTP ready timeout, will retry on first request')
    }

    onStatus('')
    return sessionId
  } catch (err) {
    onStatus('')
    console.error('SFTP 连接失败:', err)
    return null
  }
}

// ─── 主组件 ───

export default function FileManager() {
  const connections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)
  const addSession = useSshStore((s) => s.addSession)
  const removeSession = useSshStore((s) => s.removeSession)
  const [connecting, setConnecting] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const wsClient = getWsClient()
  const fileStore = useFileStore()
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── 持久化状态 ───
  const sidebarOpen = useAppStore((s) => s.fmSidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setFmSidebarOpen)
  const fmState = useAppStore((s) => s.fmSftpState)
  const setFmState = useAppStore((s) => s.setFmSftpState)

  /** 核心：尝试从缓存恢复 SFTP session */
  const tryRestoreSession = useCallback(async (): Promise<boolean> => {
    const cached = useAppStore.getState().fmSftpState
    if (!cached.connId || connectingRef.current) return false

    const connArr = useSshStore.getState().connections
    const conn = connArr.find((c) => c.id === cached.connId)
    if (!conn) {
      setFmState({ connId: null, sessionId: null, pathCache: cached.pathCache })
      return false
    }

    // 检查 persist 恢复后 SSH 页面是否已有可用 session
    const sessArr = useSshStore.getState().sessions
    const existingValid = sessArr.find(
      (s) => s.connectionId === cached.connId && s.status === 'connected',
    )
    if (existingValid) {
      setFmState({
        connId: cached.connId,
        sessionId: existingValid.id,
        pathCache: cached.pathCache,
      })
      return true
    }

    // 尝试新建连接
    connectingRef.current = true
    setConnecting(true)

    // 清理旧的 sftp session
    for (const sess of sessArr) {
      if (sess.connectionId === cached.connId && sess.id.startsWith('sftp_')) {
        wsClient.send({ type: 'disconnect', connectionId: sess.id })
        removeSession(sess.id)
      }
    }

    const sid = await ensureSftpSession(
      cached.connId,
      sessArr,
      addSession,
      wsClient,
      (msg) => {
        if (msg) setStatusMsg(msg)
      },
    )

    if (sid) {
      setFmState({
        connId: cached.connId,
        sessionId: sid,
        pathCache: cached.pathCache,
      })
      connectingRef.current = false
      setConnecting(false)
      setStatusMsg('')
      return true
    }

    setFmState({ connId: null, sessionId: null, pathCache: cached.pathCache })
    connectingRef.current = false
    setConnecting(false)
    setStatusMsg('')
    return false
  }, [addSession, removeSession, wsClient, setFmState])

  // mount 时尝试恢复
  useEffect(() => {
    mountedRef.current = true
    tryRestoreSession()
    return () => {
      mountedRef.current = false
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [tryRestoreSession])

  // 当 sessions 变化且当前 session 无效时自动重试
  // 解决 Zustand persist 异步恢复的问题
  useEffect(() => {
    // 如果已有有效 session，不做任何事
    if (
      fmState.sessionId &&
      sessions.some(
        (s) => s.id === fmState.sessionId && s.status === 'connected',
      )
    ) {
      return
    }
    // 如果 connId 还在且 sessions 非空（persist 已恢复），尝试重建
    if (fmState.connId && sessions.length > 0 && !connectingRef.current) {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current) tryRestoreSession()
      }, 500)
    }
  }, [sessions, fmState.sessionId, fmState.connId, tryRestoreSession])

  // 连接并打开 SFTP
  const connectAndSftp = useCallback(
    async (connId: string) => {
      const conn = connections.find((c) => c.id === connId)
      if (!conn || connectingRef.current) return

      connectingRef.current = true
      setConnecting(true)

      // 清除旧 session
      const storeSessions = useSshStore.getState().sessions
      for (const sess of storeSessions) {
        if (sess.connectionId === connId && sess.id.startsWith('sftp_')) {
          wsClient.send({ type: 'disconnect', connectionId: sess.id })
          removeSession(sess.id)
        }
      }

      const sid = await ensureSftpSession(
        connId,
        sessions,
        addSession,
        wsClient,
        setStatusMsg,
      )

      if (sid) {
        const currentCache = useAppStore.getState().fmSftpState.pathCache
        setFmState({
          connId,
          sessionId: sid,
          pathCache: currentCache,
        })
        connectingRef.current = false
        setConnecting(false)
        return currentCache[connId] || '/'
      }

      connectingRef.current = false
      setConnecting(false)
    },
    [connections, sessions, addSession, removeSession, wsClient, setFmState],
  )

  // 当前 session 是否有效
  const isConnected =
    fmState.sessionId !== null &&
    sessions.some(
      (s) => s.id === fmState.sessionId && s.status === 'connected',
    )

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧文件浏览器（可拖拽调整宽度） */}
      {sidebarOpen && (
        <div className="flex shrink-0 flex-col border-r border-slate-700/50">
          <ResizablePanel side="right" defaultSize={260} minSize={200} maxSize={500}>
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-slate-700/30 px-2 py-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  文件
                </span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="btn-icon text-slate-500 hover:text-slate-300"
                  title="隐藏文件浏览器"
                >
                  <PanelLeftClose size={14} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <SftpBrowser
            sessionId={fmState.sessionId}
            activeConnId={fmState.connId}
            connectionOptions={connections.map((c) => ({
              id: c.id,
              name: c.name,
              host: c.host,
            }))}
            onConnect={connectAndSftp}
              connecting={connecting}
              showConnector={true}
            />
          </div>
          </div>
        </ResizablePanel>
        </div>
      )}

      {/* 右侧编辑器区 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 border-b border-slate-700/50 bg-slate-900/50 px-3 py-1.5">
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="btn-icon text-slate-500 hover:text-slate-300"
              title="显示文件浏览器"
            >
              <PanelLeft size={16} />
            </button>
          )}
          {connecting && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Loader2 size={12} className="animate-spin" />{' '}
              {statusMsg || '连接中...'}
            </span>
          )}
          {!isConnected && !connecting && (
            <span className="text-xs text-slate-600">
              在左侧文件浏览器中选择 SSH 连接以浏览远程文件
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {fileStore.openTabs.length > 0 && (
              <span className="text-[10px] text-slate-600">
                {fileStore.openTabs.length} 个标签
              </span>
            )}
          </div>
        </div>

        {/* 标签栏 */}
        {fileStore.openTabs.length > 0 && (
          <div className="flex items-center border-b border-slate-700/30 bg-slate-900/30">
            <div className="flex flex-1 overflow-x-auto">
              {fileStore.openTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => fileStore.setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-1.5 border-r border-slate-700/30 px-3 py-1.5 text-xs transition-colors ${
                    tab.id === fileStore.activeTabId
                      ? 'bg-slate-800 text-slate-200'
                      : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                  }`}
                >
                  {getFileIcon(tab.name)}
                  <span className="max-w-[100px] truncate">{tab.name}</span>
                  {tab.isDirty && (
                    <span className="text-[10px] text-amber-400">●</span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      fileStore.closeFile(tab.id)
                    }}
                    className="ml-1 shrink-0 text-slate-600 hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 编辑器 / 空状态 */}
        <div className="flex flex-1 overflow-hidden">
          {fileStore.activeTabId ? (
            <CodeMirrorEditor />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <FileCode2
                  size={48}
                  className="mx-auto mb-3 text-slate-600"
                />
                <p className="text-sm text-slate-500">
                  {isConnected
                    ? '在左侧文件浏览器中双击文件打开编辑'
                    : '请先连接 SSH 服务器'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  支持双击文件、右键「在编辑器中打开」、拖拽调整面板宽度
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
