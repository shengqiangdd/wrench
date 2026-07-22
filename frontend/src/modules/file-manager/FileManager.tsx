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
 * - 使用 SshSessionManager 统一管理会话，支持智能复用
 * - mount effect 不再只用 [] 依赖，同时监听 sessions 变化自动重试
 * - 新建连接后等待 sftp-ready 事件再返回，避免 SFTP_NOT_READY
 * - 支持 persist 异步恢复后自动重连
 * - clipboard 兜底方案（fallbackCopy）
 * - 🔧 修复：支持同时连接多个主机，不再冲突
 */

import { useEffect, useCallback, useRef, useReducer, useState, useMemo, memo } from 'react'
import { authedFetch } from '../../services/auth'
import { FileCode2, X, PanelLeftClose, PanelLeft, Loader2, ChevronDown } from 'lucide-react'
import { useSshStore, decryptConnection } from '../../stores/ssh-store'
import { useAppStore } from '../../stores/app-store'
import { useFileStore } from '../../stores/file-store'
import { getWsClientSync, WsClient } from '../../services/websocket'
import { sshSessionManager } from '../../services/ssh-session-manager'
import { setSessionCredentials } from '../../services/session-credentials'
import SftpBrowser from '../ssh/SftpBrowser'
import CodeMirrorEditor from '../../components/CodeMirrorEditor'
import { ConfirmModal } from '../../components/ConfirmModal'
import ResizablePanel from '../../components/ResizablePanel'

/** 检测是否为移动端视口 */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])
  return isMobile
}

// ─── 工具函数 ───

function getFileIcon(name: string, type?: string) {
  if (type === 'symlink') {
    return <FileCode2 size={14} className="text-cyan-400" />
  }
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <FileCode2 size={14} className="text-slate-500" />
  switch (ext) {
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'rb':
    case 'php':
    case 'sh':
    case 'bash':
    case 'vue':
    case 'svelte':
      return <FileCode2 size={14} className="text-sky-400" />
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
    case 'ini':
    case 'cfg':
    case 'conf':
      return <FileCode2 size={14} className="text-amber-400" />
    case 'md':
    case 'txt':
    case 'log':
    case 'csv':
    case 'pdf':
    case 'doc':
    case 'docx':
      return <FileCode2 size={14} className="text-slate-400" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'bmp':
    case 'ico':
    case 'avif':
      return <FileCode2 size={14} className="text-purple-400" />
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'webm':
      return <FileCode2 size={14} className="text-red-400" />
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'ogg':
    case 'aac':
      return <FileCode2 size={14} className="text-rose-400" />
    case 'zip':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'xz':
    case 'rar':
    case '7z':
    case 'deb':
    case 'rpm':
      return <FileCode2 size={14} className="text-yellow-400" />
    case 'so':
    case 'dll':
    case 'dylib':
    case 'exe':
    case 'bin':
    case 'wasm':
    case 'class':
    case 'pyc':
      return <FileCode2 size={14} className="text-amber-300" />
    default:
      return <FileCode2 size={14} className="text-slate-500" />
  }
}

/** 等待 sftp-ready 事件，最多等 8 秒 — 内部辅助，暂未启用 */
const _waitForSftpReady = (
  wsClient: WsClient,
  sessionId: string,
  timeout = 8000,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeout)
    const unsub = wsClient.on('sftp-ready', (data: Record<string, unknown>) => {
      if ((data as Record<string, unknown>)['connectionId'] === sessionId) {
        clearTimeout(timer)
        unsub()
        resolve(true)
      }
    })
  })
}

/** 等待 sftp-ready 事件，最多等 8 秒 */

/**
 * 尝试复用已有的 SSH session 来获取 SFTP 能力。
 * 新建连接后等待 sftp-ready 事件再返回，确保 SFTP 已就绪。
 *
 * 🔧 修复：使用 SshSessionManager 智能管理会话，支持多连接
 */
async function ensureSftpSession(
  connId: string,
  existingSessions: ReturnType<typeof useSshStore.getState>['sessions'],
  addSession: ReturnType<typeof useSshStore.getState>['addSession'],
  wsClient: WsClient,
  onStatus: (msg: string) => void,
): Promise<string | null> {
  // 🔧 使用 SshSessionManager 智能管理会话
  return sshSessionManager.getOrCreateSftpSession(connId, { onStatus })
}

// ─── 主组件 ───

function FileManagerInner() {
  const connections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)
  const addSession = useSshStore((s) => s.addSession)
  const removeSession = useSshStore((s) => s.removeSession)
  const [{ connecting, statusMsg }, dispatch] = useReducer(
    (
      state: { connecting: boolean; statusMsg: string },
      action: Partial<{ connecting: boolean; statusMsg: string }>,
    ) => ({ ...state, ...action }),
    { connecting: false, statusMsg: '' },
  )
  const fileStore = useFileStore()
  const connectingRef = useRef(false)
  const mountedRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ─── 持久化状态 ───
  const sidebarOpen = useAppStore((s) => s.fmSidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setFmSidebarOpen)
  const fmState = useAppStore((s) => s.fmSftpState)
  const setFmState = useAppStore((s) => s.setFmSftpState)
  const [confirmCloseTabId, setConfirmCloseTabId] = useState<string | null>(null)
  const [selectedHostId, setSelectedHostId] = useState<string>('')
  const wsClientRef = useRef<WsClient | null>(null)
  const [wsReady, setWsReady] = useState(false)
  const isMobile = useIsMobile()

  // 使用 getWsClientSync() 获取 WS 客户端（AuthGate 已完成初始化，避免重复异步等待）
  useEffect(() => {
    const client = getWsClientSync()
    wsClientRef.current = client
    // 🔧 初始化 session 管理器
    sshSessionManager.setWsClient(client)
    // 使用 queueMicrotask 避免在 effect 中同步调用 setState
    queueMicrotask(() => setWsReady(true))
  }, [])

  /** 持久化 SFTP 浏览路径（用 useCallback 包装，避免 re-render 时重建回调） */
  const handlePathChange = useCallback(
    (path: string) => {
      const currentCache = useAppStore.getState().fmSftpState.pathCache
      const connId = useAppStore.getState().fmSftpState.connId
      setFmState({
        ...useAppStore.getState().fmSftpState,
        currentPath: path,
        pathCache: connId ? { ...currentCache, [connId]: path } : currentCache,
      })
    },
    [setFmState],
  )

  /** 核心：尝试从缓存恢复 SFTP session */
  const tryRestoreSession = useCallback(async (): Promise<boolean> => {
    const cached = useAppStore.getState().fmSftpState
    console.log(`[FileManager] tryRestoreSession called, cached:`, cached)
    if (!cached.connId || connectingRef.current) {
      console.log(`[FileManager] tryRestoreSession early return: connId=${cached.connId}, connecting=${connectingRef.current}`)
      return false
    }

    // 等待 WsClient 就绪（token 可能还没加载完）
    const client = wsClientRef.current
    if (!client) {
      console.log(`[FileManager] tryRestoreSession: no wsClient`)
      return false
    }

    const connArr = useSshStore.getState().connections
    const conn = connArr.find((c) => c.id === cached.connId)
    if (!conn) {
      console.log(`[FileManager] tryRestoreSession: connection ${cached.connId} not found`)
      setFmState({ connId: null, sessionId: null, pathCache: cached.pathCache })
      return false
    }

    // 🔧 使用 SshSessionManager 智能复用会话
    const sessArr = useSshStore.getState().sessions
    console.log(`[FileManager] tryRestoreSession: sessions =`, sessArr.map(s => `${s.id} (connId: ${s.connectionId}, status: ${s.status})`))

    // 优先查找已有的 SSH session（功能更完整）
    const existingSshSession = sessArr.find(
      (s) => s.connectionId === cached.connId && 
             s.status === 'connected' && 
             !s.id.startsWith('sftp_'),
    )

    if (existingSshSession) {
      // 直接复用 SSH 页面的 session，无需重新连接
      console.log('[FileManager] Found existing SSH session, reusing:', existingSshSession.id)
      setFmState({
        connId: cached.connId,
        sessionId: existingSshSession.id,
        pathCache: cached.pathCache,
      })
      return true
    }

    // 尝试新建连接
    connectingRef.current = true
    dispatch({ connecting: true })

    // 🔧 修复：只清理同一主机的旧 sftp session（重连场景），
    // 不再断开其他主机的 session — 支持多主机并存
    for (const sess of sessArr) {
      if (sess.connectionId === cached.connId && sess.id.startsWith('sftp_')) {
        console.log(`[FileManager] Disconnecting old SFTP session: ${sess.id}`)
        client.send({ type: 'disconnect', connectionId: sess.id })
        removeSession(sess.id)
      }
    }

    const sid = await ensureSftpSession(cached.connId, sessArr, addSession, client, (msg) => {
      if (msg) dispatch({ statusMsg: msg })
    })
    
    console.log(`[FileManager] tryRestoreSession: ensureSftpSession returned sid: ${sid}`)

    if (sid) {
      setFmState({
        connId: cached.connId,
        sessionId: sid,
        pathCache: cached.pathCache,
      })
      connectingRef.current = false
      dispatch({ connecting: false, statusMsg: '' })
      return true
    }

    setFmState({ connId: null, sessionId: null, pathCache: cached.pathCache })
    connectingRef.current = false
    dispatch({ connecting: false, statusMsg: '' })
    return false
  }, [addSession, removeSession, setFmState])

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
  }, [tryRestoreSession, wsReady])

  // 当 sessions 变化且当前 session 无效时自动重试
  // 解决 Zustand persist 异步恢复的问题
  useEffect(() => {
    console.log(`[FileManager] sessions useEffect triggered, fmState:`, fmState, `sessions:`, sessions.map(s => s.id))
    
    // 🔧 修复：如果正在连接中，不干预（避免 connectAndSftp 的竞态覆盖）
    if (connectingRef.current) {
      console.log(`[FileManager] sessions useEffect: connecting in progress, skipping`)
      return
    }

    // 如果已有有效 session，不做任何事
    if (
      fmState.sessionId &&
      sessions.some((s) => s.id === fmState.sessionId && s.status === 'connected')
    ) {
      console.log(`[FileManager] sessions useEffect: valid session exists, skipping`)
      return
    }

    // 🔧 修复：如果 fmState.connId 为空（被 reset 过），不再尝试恢复
    // 只有当 connId 有效且 sessions 已恢复时才重建
    if (fmState.connId && sessions.length > 0 && wsClientRef.current) {
      // 🔧 修复：检查是否有可复用的 SSH session（从 SSH 页面已连接的）
      const existingSshSession = sessions.find(
        (s) => s.connectionId === fmState.connId && s.status === 'connected' && !s.id.startsWith('sftp_'),
      )

      if (existingSshSession) {
        // 直接复用 SSH 页面的 session，无需重新连接
        console.log('[FileManager] Found existing SSH session, reusing:', existingSshSession.id)
        setFmState({
          ...fmState,
          sessionId: existingSshSession.id,
        })
        return
      }

      // 🔧 修复：如果当前 fmState 已有有效的 sftp session 在 sessions 中，
      // 不再重试（避免 sessions 变化导致的无意义重连）
      const hasValidSftpSession = sessions.some(
        (s) => s.connectionId === fmState.connId && s.status === 'connected' && s.id.startsWith('sftp_'),
      )
      if (hasValidSftpSession) {
        console.log(`[FileManager] sessions useEffect: has valid SFTP session, skipping`)
        return
      }

      // 没有可复用的 session，尝试重建 SFTP 连接
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !connectingRef.current) tryRestoreSession()
      }, 800)
    }
  }, [sessions, fmState.sessionId, fmState.connId, tryRestoreSession, wsReady])

  // 无任何已知连接（首次打开，且有主机）时自动连接第一个
  const connectAndSftpRef = useRef<((connId: string) => Promise<string | undefined>) | null>(null)
  useEffect(() => {
    if (
      !fmState.connId &&
      !fmState.sessionId &&
      !connectingRef.current &&
      connections.length >= 1 &&
      connectAndSftpRef.current
    ) {
      // 自动选中第一个主机并连接
      setSelectedHostId(connections[0]!.id)
      void connectAndSftpRef.current(connections[0]!.id)
    }
  }, [connections, fmState.connId, fmState.sessionId, wsReady])

  /* eslint-disable react-hooks/set-state-in-effect */
  // 当 fmState.connId 变化时，同步下拉框选中状态
  useEffect(() => {
    if (fmState.connId) {
      setSelectedHostId(fmState.connId)
    }
  }, [fmState.connId])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 当有活动编辑器 tab 时，移动端首次自动折叠侧边栏
  const activeTabId = useFileStore((s) => s.activeTabId)
  const hasAutoCollapsedRef2 = useRef(false)
  useEffect(() => {
    if (activeTabId && isMobile && !hasAutoCollapsedRef2.current) {
      hasAutoCollapsedRef2.current = true
      useAppStore.getState().setFmSidebarOpen(false)
    }
    if (!activeTabId) {
      hasAutoCollapsedRef2.current = false
    }
  }, [activeTabId, isMobile])

  // 连接并打开 SFTP
  const connectAndSftp = useCallback(
    async (connId: string) => {
      // 使用 getState() 获取最新状态，避免闭包快照问题
      const conn = useSshStore.getState().connections.find((c) => c.id === connId)
      const client = wsClientRef.current
      const currentSessions = useSshStore.getState().sessions  // 🔧 实时获取 sessions
      console.log(`[FileManager] connectAndSftp called for connId: ${connId}`)
      console.log(`[FileManager] Current sessions:`, currentSessions.map(s => `${s.id} (connId: ${s.connectionId})`))
      console.log(`[FileManager] Current fmState:`, useAppStore.getState().fmSftpState)
      
      if (!conn || !client || connectingRef.current) {
        console.log(`[FileManager] connectAndSftp early return: conn=${!!conn}, client=${!!client}, connecting=${connectingRef.current}`)
        return
      }

      connectingRef.current = true
      dispatch({ connecting: true })

      // 🔧 修复：只清理同一主机的旧 session（重连场景），
      // 不再断开其他主机的 session — 支持多主机并存
      for (const sess of currentSessions) {
        if (sess.connectionId === connId) {
          console.log(`[FileManager] Disconnecting old session: ${sess.id}`)
          client.send({ type: 'disconnect', connectionId: sess.id })
          removeSession(sess.id)
        }
      }

      // 🔧 使用实时获取的 sessions
      const sid = await ensureSftpSession(connId, currentSessions, addSession, client, (msg) => {
        if (msg) dispatch({ statusMsg: msg })
      })
      
      console.log(`[FileManager] ensureSftpSession returned sid: ${sid}`)

      if (sid) {
        const currentCache = useAppStore.getState().fmSftpState.pathCache
        console.log(`[FileManager] Setting fmState to connId=${connId}, sessionId=${sid}`)
        setFmState({
          connId,
          sessionId: sid,
          pathCache: currentCache,
        })
        connectingRef.current = false
        dispatch({ connecting: false })
        return currentCache[connId] || '/'
      }

      console.log(`[FileManager] ensureSftpSession failed, not setting fmState`)
      connectingRef.current = false
      dispatch({ connecting: false })
      return
    },
    [addSession, removeSession, setFmState],  // 🔧 移除 sessions 依赖
  )

  // 同步 ref 供 useEffect 使用（避免 hook 顺序问题）
  // eslint-disable-next-line react-hooks/refs
  connectAndSftpRef.current = connectAndSftp

  // 移动端：首次打开编辑器时自动折叠侧边栏（仅折叠一次，不阻止用户手动展开）
  const hasAutoCollapsedRef = useRef(false)
  useEffect(() => {
    if (fileStore.activeTabId && isMobile && !hasAutoCollapsedRef.current) {
      hasAutoCollapsedRef.current = true
      setSidebarOpen(false)
    }
    if (!fileStore.activeTabId) {
      hasAutoCollapsedRef.current = false
    }
  }, [fileStore.activeTabId, setSidebarOpen, isMobile])

  // 当前 session 是否有效
  const isConnected =
    fmState.sessionId !== null &&
    sessions.some((s) => s.id === fmState.sessionId && s.status === 'connected')

  // 移动端侧边栏宽度
  const sidebarWidth = useMemo(
    () => (isMobile ? Math.min(260, window.innerWidth - 40) : 260),
    [isMobile],
  )

  // 无连接时显示可选连接列表
  if (!isConnected && !connecting) {
    return (
      <div className="pb-nav flex h-full flex-col items-center justify-center gap-4 p-4 text-slate-500">
        <FileCode2 size={48} className="text-slate-600" />
        <div className="text-center">
          <p className="text-sm font-medium text-slate-400">未连接到任何 SSH</p>
          <p className="mt-1 text-xs text-slate-600">选择一个已保存的连接来浏览文件</p>
        </div>
        {connections.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[10px] text-slate-600">选择主机连接</p>
            <div className="relative">
              <select
                value={selectedHostId || connections[0]?.id || ''}
                onChange={(e) => {
                  setSelectedHostId(e.target.value)
                  connectAndSftp(e.target.value)
                }}
                className="appearance-none rounded-lg border border-slate-700/50 bg-slate-800/80 px-4 py-2 pr-8 text-xs text-slate-300 focus:ring-1 focus:ring-sky-500 focus:outline-none"
              >
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.id} className="bg-slate-800">
                    {conn.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500"
              />
            </div>
          </div>
        )}
        <button
          onClick={() => useAppStore.getState().setActiveNav('ssh')}
          className="bg-wrench-600 hover:bg-wrench-500 mt-2 rounded-md px-4 py-2 text-xs text-white transition-colors"
        >
          前往 SSH 页面
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ─── 移动端 overlay 侧边栏 ─── */}
      {isMobile && sidebarOpen && (
        <>
          {/* 遮罩层 — z-[35] 低于预览模态框 z-50，避免点击预览模态框时误触关闭 */}
          <div
            className="fixed inset-0 z-[35] bg-black/50 backdrop-blur-sm transition-opacity"
            onClick={() => setSidebarOpen(false)}
          />
          {/* 滑出面板 */}
          <div
            className="fixed top-0 left-0 z-40 flex h-full flex-col border-r border-slate-700/50 bg-slate-950"
            style={{ width: sidebarWidth }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-700/30 px-2 py-1.5">
              <span className="text-[11px] font-medium tracking-wider text-slate-500 uppercase">
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
            <div className="flex min-h-0 flex-1 flex-col">
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
                initialPath={
                  fmState.currentPath || fmState.pathCache[fmState.connId || ''] || undefined
                }
                onPathChange={handlePathChange}
              />
            </div>
          </div>
        </>
      )}

      {/* ─── 桌面端内联侧边栏 ─── */}
      {!isMobile && sidebarOpen && (
        <div className="flex h-full min-h-0 flex-col border-r border-slate-700/50">
          <ResizablePanel
            side="right"
            defaultSize={260}
            minSize={200}
            maxSize={500}
            className="h-full"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-700/30 px-2 py-1.5">
                <span className="text-[11px] font-medium tracking-wider text-slate-500 uppercase">
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
              <div className="flex min-h-0 flex-1 flex-col">
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
                  initialPath={
                    fmState.currentPath || fmState.pathCache[fmState.connId || ''] || undefined
                  }
                  onPathChange={handlePathChange}
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
              <Loader2 size={12} className="animate-spin" /> {statusMsg || '连接中...'}
            </span>
          )}
          {!isConnected && !connecting && (
            <span className="text-xs text-slate-600">
              在左侧文件浏览器中选择 SSH 连接以浏览远程文件
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {fileStore.openTabs.length > 0 && (
              <span className="text-[10px] text-slate-600">{fileStore.openTabs.length} 个标签</span>
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
                  {tab.isDirty && <span className="text-[10px] text-amber-400">●</span>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (tab.isDirty) {
                        setConfirmCloseTabId(tab.id)
                      } else {
                        fileStore.closeFile(tab.id)
                      }
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
                <FileCode2 size={48} className="mx-auto mb-3 text-slate-600" />
                <p className="text-sm text-slate-500">
                  {isConnected ? '在左侧文件浏览器中双击文件打开编辑' : '请先连接 SSH 服务器'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  支持双击文件、右键「在编辑器中打开」、拖拽调整面板宽度
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 关闭未保存标签确认弹窗 */}
      {confirmCloseTabId && (
        <ConfirmModal
          open={true}
          title="关闭未保存的文件"
          message="此文件有未保存的更改，确定要关闭吗？"
          confirmText="关闭"
          cancelText="取消"
          variant="danger"
          onConfirm={() => {
            fileStore.closeFile(confirmCloseTabId)
            setConfirmCloseTabId(null)
          }}
          onCancel={() => setConfirmCloseTabId(null)}
        />
      )}
    </div>
  )
}

export default memo(FileManagerInner)
