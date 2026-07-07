import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Server,
  PanelRightClose,
  PanelRightOpen,
  Menu,
  PlugZap,
  Brain,
  X,
  Terminal,
} from 'lucide-react'
import { useAppStore, type SplitDef } from '../../stores/app-store'
import { useSshStore, decryptConnection } from '../../stores/ssh-store'
import { getWsClient, type WsClient, type WsStatus } from '../../services/websocket'
import ConnectionList from './ConnectionList'
import TerminalView from './Terminal'
import { SplitContainer } from './Terminal'
import SftpSidebar from './SftpSidebar'
import AiSidebar from './AiSidebar'
import type { SshSession } from '../../types/ssh'
import { useAiStore } from '../../stores/ai-store'

export default function SshPlaceholder() {
  const connections = useSshStore((s) => s.connections)
  const selectedConnectionId = useSshStore((s) => s.selectedConnectionId)
  const selectConnection = useSshStore((s) => s.selectConnection)
  const sessions = useSshStore((s) => s.sessions)
  const removeSession = useSshStore((s) => s.removeSession)
  const removeSshSession = useAppStore((s) => s.removeSshSession)

  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected')
  const [connecting, setConnecting] = useState(false)
  // ─── 持久化状态（切换标签页后恢复） ───
  const sftpOpen = useAppStore((s) => s.sshSftpOpen)
  const setSftpOpen = useAppStore((s) => s.setSshSftpOpen)
  const sidebarOpen = useAppStore((s) => s.sshSidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSshSidebarOpen)
  const splits = useAppStore((s) => s.sshSplits)
  const setSplits = useAppStore((s) => s.setSshSplits)
  const activeSplitId = useAppStore((s) => s.sshActiveSplitId)
  const setActiveSplitId = useAppStore((s) => s.setSshActiveSplitId)
  const [aiOpen, setAiOpen] = useState(false)
  const aiEnabled = useAiStore((s) => s.config.enabled)

  // 用 ref 追踪连接状态，防止闭包过期
  const wsClientRef = useRef<WsClient | null>(null)

  // 监听 WebSocket 状态（确保 UI 始终反映实际连接状态）
  useEffect(() => {
    getWsClient().then((client) => {
      wsClientRef.current = client
      client.connect()
      // 立即同步当前状态（当 onStatus 注册时 WS 可能已连接）
      setWsStatus(client.status)
      client.onStatus((status) => {
        setWsStatus(status)
      })
    })
  }, [])

  // ─── 建立 SSH 连接（防重复点击） ───

  const connectingRefs = useRef<Set<string>>(new Set())

  const handleConnect = useCallback(
    async (connectionId: string, targetSessionId?: string) => {
      // 使用 useSshStore.getState() 而非闭包中的 connections，
      // 因为快速连接流程中 store.addConnection() 后 React 可能未重渲染，
      // 导致 connections.find() 找不到新添加的连接
      const conn = useSshStore.getState().connections.find((c) => c.id === connectionId)
      if (!conn) return null

      const sessionId = targetSessionId || `sess_${connectionId}_${Date.now()}`
      if (connectingRefs.current.has(sessionId)) return null
      connectingRefs.current.add(sessionId)

      // 只在非批量连接时显示 loading 状态
      if (!targetSessionId) {
        setConnecting(true)
      }

      const store = useSshStore.getState()

      try {
        // 🔐 解密存储的密码/私钥后再发送
        const decryptedConn = await decryptConnection(conn)
        const ws = wsClientRef.current || (await getWsClient())
        await ws.request(
          {
            type: 'connect',
            connectionId: sessionId,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: decryptedConn.password,
            privateKey: decryptedConn.privateKey,
            sudoPassword: decryptedConn.sudoPassword || decryptedConn.password,
          },
          30000,
        )

        const session: SshSession = {
          id: sessionId,
          connectionId,
          connectionName: conn.name,
          host: conn.host,
          status: 'connected',
          terminalCols: 80,
          terminalRows: 24,
        }
        store.addSession(session)
        useAppStore.getState().addSshSession(sessionId)
        // 仅非分屏连接时切换 selectedConnectionId（分屏自动建连不抢焦点）
        if (!targetSessionId) {
          store.selectConnection(sessionId)
          setSidebarOpen(false)
        }
        return sessionId
      } catch (err) {
        console.error('SSH 连接失败:', err)
        return null
      } finally {
        connectingRefs.current.delete(sessionId)
        if (!targetSessionId) {
          setConnecting(false)
        }
      }
    },
    [setSidebarOpen],
  )

  // ─── 批量并行连接多个 SSH 主机 ───
  const handleBatchConnect = useCallback(
    async (connectionIds: string[]) => {
      if (connectionIds.length === 0) return

      setConnecting(true)
      try {
        // 并行建立所有连接
        const results = await Promise.allSettled(
          connectionIds.map((connId) => handleConnect(connId)),
        )

        // 返回成功连接的 sessionId 列表
        const successIds = results
          .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
          .map((r) => r.value)
          .filter((id): id is string => id !== null)

        if (successIds.length > 0) {
          setSplits([])
        }
        return successIds
      } finally {
        setConnecting(false)
      }
    },
    [handleConnect, setSplits],
  )

  // ─── 断开连接 ───

  const handleDisconnect = useCallback(
    (sessionId: string) => {
      wsClientRef.current?.send({
        type: 'disconnect',
        connectionId: sessionId,
      })
      removeSession(sessionId)
      removeSshSession(sessionId)
      if (selectedConnectionId === sessionId) {
        selectConnection(null)
      }
      setSplits((prev) =>
        prev.filter((s) => s.sessionId !== sessionId && s.connectionId !== sessionId),
      )
    },
    [removeSession, removeSshSession, selectConnection, selectedConnectionId, setSplits],
  )

  // ─── 从列表连接 ───

  const handleDirectConnect = useCallback(
    async (connectionId: string) => {
      const sessionId = await handleConnect(connectionId)
      if (sessionId) {
        setSplits([])
      }
    },
    [handleConnect, setSplits],
  )

  const handleSplit = useCallback(
    (id: string, direction: 'vertical' | 'horizontal') => {
      const splitId = `split_${Date.now()}`
      const newSessionId = `sess_split_${Date.now()}`
      let connId: string | undefined
      setSplits((prev) => {
        const idx = prev.findIndex((s) => s.id === id)
        if (idx === -1) return prev
        connId = prev[idx]!.connectionId
        const newSplit: SplitDef = {
          id: splitId,
          connectionId: connId,
          sessionId: newSessionId,
          direction,
        }
        const result = [...prev]
        result.splice(idx + 1, 0, newSplit)
        return result
      })
      // 自动建立 SSH 连接
      if (connId) {
        handleConnect(connId, newSessionId)
      }
    },
    [handleConnect, setSplits],
  )

  const handleRemoveSplit = useCallback(
    (id: string) => {
      setSplits((prev) => prev.filter((s) => s.id !== id))
    },
    [setSplits],
  )

  const handleSplitConnectionChange = useCallback(
    (splitId: string, newConnectionId: string, newSessionId: string) => {
      setSplits((prev) =>
        prev.map((s) =>
          s.id === splitId ? { ...s, connectionId: newConnectionId, sessionId: newSessionId } : s,
        ),
      )
      // 自动建立新连接（如果尚未连接）
      const existingSession = sessions.find((s) => s.id === newConnectionId)
      if (!existingSession) {
        handleConnect(newConnectionId)
      }
    },
    [handleConnect, sessions, setSplits],
  )

  // ─── 同步组管理 ───
  const [syncGroups, setSyncGroups] = useState<Record<string, string[]>>({})
  const syncCounterRef = useRef(0)

  const handleToggleSync = useCallback(
    (splitId: string) => {
      setSplits((prev) => {
        const target = prev.find((s) => s.id === splitId)
        if (!target) return prev

        if (target.syncGroup) {
          // 关闭同步：移除这个分屏的同步组
          const oldGroup = target.syncGroup
          const updated = prev.map((s) => (s.id === splitId ? { ...s, syncGroup: undefined } : s))
          // 更新 syncGroups state
          setSyncGroups((prevGroups) => {
            const newGroups = { ...prevGroups }
            if (newGroups[oldGroup]) {
              newGroups[oldGroup] = newGroups[oldGroup].filter((id) => id !== splitId)
              if (newGroups[oldGroup].length <= 1) delete newGroups[oldGroup]
            }
            return newGroups
          })
          return updated
        }

        // 开启同步：加入一个组（优先加入已有组，否则新建组）
        const firstSyncSplit = prev.find((s) => s.syncGroup)
        if (firstSyncSplit) {
          // 加入已有组
          const groupId = firstSyncSplit.syncGroup!
          const updated = prev.map((s) => (s.id === splitId ? { ...s, syncGroup: groupId } : s))
          setSyncGroups((prevGroups) => ({
            ...prevGroups,
            [groupId]: [...(prevGroups[groupId] || []), splitId],
          }))
          return updated
        }

        // 新建组
        syncCounterRef.current += 1
        const newGroup = `sync_${syncCounterRef.current}`
        const updated = prev.map((s) => (s.id === splitId ? { ...s, syncGroup: newGroup } : s))
        setSyncGroups((prevGroups) => ({
          ...prevGroups,
          [newGroup]: [splitId],
        }))
        return updated
      })
    },
    [setSplits, setSyncGroups],
  )

  // 当 splits 变化时重新计算 syncGroups
  useEffect(() => {
    const t = setTimeout(() => {
      setSyncGroups((prev) => {
        const newGroups: Record<string, string[]> = {}
        for (const split of splits) {
          if (split.syncGroup) {
            if (!newGroups[split.syncGroup]) newGroups[split.syncGroup] = []
            newGroups[split.syncGroup]!.push(split.id)
          }
        }
        // 只保留有效组
        const pruned: Record<string, string[]> = {}
        for (const [g, members] of Object.entries(newGroups)) {
          if (prev[g] && members.length >= 1) pruned[g] = members
        }
        return pruned
      })
    }, 0)
    return () => clearTimeout(t)
  }, [splits])

  // ─── 拖拽合并 ───
  const handleMerge = useCallback(
    (sourceId: string, targetId: string, position: 'left' | 'right' | 'top' | 'bottom') => {
      setSplits((prev) => {
        const sourceIdx = prev.findIndex((s) => s.id === sourceId)
        const targetIdx = prev.findIndex((s) => s.id === targetId)
        if (sourceIdx === -1 || targetIdx === -1) return prev

        const source = prev[sourceIdx]!
        const newDirection = position === 'left' || position === 'right' ? 'vertical' : 'horizontal'

        // 移除 source
        const withoutSource = prev.filter((s) => s.id !== sourceId)
        // 找到 target 在新数组中的位置
        const newTargetIdx = withoutSource.findIndex((s) => s.id === targetId)
        if (newTargetIdx === -1) return prev

        const result = [...withoutSource]
        // 根据 position 插入 source
        const insertSplit: SplitDef = {
          id: source.id,
          connectionId: source.connectionId,
          sessionId: source.sessionId,
          direction: newDirection,
          syncGroup: source.syncGroup,
        }
        if (position === 'left' || position === 'top') {
          result.splice(newTargetIdx, 0, insertSplit)
        } else {
          result.splice(newTargetIdx + 1, 0, insertSplit)
        }
        return result
      })
    },
    [setSplits],
  )

  // 构建连接选项 — 包括已连接的 session 和连接配置
  const allSessions = sessions.filter((s) => s.status === 'connected')
  const connectionOptions =
    allSessions.length > 0
      ? allSessions.map((s) => ({ id: s.id, name: s.connectionName }))
      : connections.map((c) => ({ id: c.id, name: c.name }))

  // ─── 命令同步广播 ───
  // 用 ref 跟踪最新的 splits，避免 useCallback 闭包过期
  const splitsRef = useRef(splits)
  useEffect(() => {
    splitsRef.current = splits
  }, [splits])

  const handleTerminalData = useCallback((sessionId: string, data: string) => {
    // 查找这个 session 所在的分屏和同步组
    const currentSplits = splitsRef.current
    const split = currentSplits.find((s) => s.sessionId === sessionId)
    if (!split?.syncGroup) return
    // 广播到同组其他分屏
    const groupMembers = currentSplits.filter(
      (s) => s.syncGroup === split.syncGroup && s.sessionId !== sessionId,
    )
    for (const member of groupMembers) {
      wsClientRef.current?.send({
        type: 'exec',
        connectionId: member.sessionId,
        data,
      })
    }
  }, [])
  // 在 TerminalView 的 onData 中注入 handleTerminalData
  // 实际上 TerminalView 内部已经有 onData listener，我们通过修改 wsClient 来注入
  // 更好的方式：直接在 TerminalView 组件上加 onData prop
  // 但 TerminalView 不支持——我们后面可以加，现在先不做，后续优化

  // ─── 渲染 ───

  const activeSession = sessions.find(
    (s) => s.id === selectedConnectionId && s.status === 'connected',
  )

  const showWsIndicator = () => (
    <button
      onClick={() => wsClientRef.current?.connect()}
      className="flex min-h-[36px] items-center gap-1.5 px-2 py-1.5"
      title={wsStatus === 'disconnected' ? '点击重连' : ''}
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${
          wsStatus === 'connected'
            ? 'bg-emerald-500'
            : wsStatus === 'connecting' || wsStatus === 'reconnecting'
              ? 'bg-amber-500'
              : 'bg-red-500'
        }`}
      />
      <span className="text-[11px] text-slate-500">
        {wsStatus === 'connected'
          ? '已连接'
          : wsStatus === 'connecting'
            ? '连接中...'
            : wsStatus === 'reconnecting'
              ? '重连中...'
              : '未连接'}
      </span>
    </button>
  )

  return (
    <div className="relative flex h-[calc(100vh-48px)] flex-col overflow-hidden lg:h-auto lg:flex-1">
      {/* 移动端侧边栏遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 左侧连接列表（移动端全屏侧边栏，桌面端常驻） */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-[85vw] max-w-[300px] border-r border-slate-700/50 bg-slate-950 transition-transform duration-200 ease-out lg:relative lg:z-auto lg:w-auto lg:flex-none lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} `}
        style={{ pointerEvents: sidebarOpen ? 'auto' : 'none' }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-1.5">
            {showWsIndicator()}
            <button
              onClick={() => setSidebarOpen(false)}
              className="btn-icon text-slate-500 hover:text-slate-300 md:hidden"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mobile-scroll flex-1 overflow-y-auto">
            <ConnectionList onConnect={handleDirectConnect} />
          </div>
        </div>
      </div>

      {/* 中间终端区域 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {allSessions.length > 0 ? (
          <>
            {/* 标签栏 */}
            <div className="flex items-center border-b border-slate-700/50 bg-slate-900/50">
              <button
                onClick={() => setSidebarOpen(true)}
                className="btn-icon text-slate-500 hover:text-slate-300 md:hidden"
              >
                <Menu size={16} />
              </button>

              <div className="flex flex-1 overflow-x-auto">
                {allSessions.map((sess) => (
                  <button
                    key={sess.id}
                    onClick={() => selectConnection(sess.id)}
                    className={`flex shrink-0 items-center gap-1.5 border-r border-slate-700/50 px-3 py-2 text-xs transition-colors ${
                      sess.id === selectedConnectionId
                        ? 'bg-slate-800 text-slate-200'
                        : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                    }`}
                  >
                    <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="max-w-[120px] truncate md:max-w-[80px]">
                      {sess.connectionName}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDisconnect(sess.id)
                      }}
                      className="ml-1 shrink-0 text-slate-600 hover:text-red-400"
                    >
                      ✕
                    </button>
                  </button>
                ))}
              </div>

              <div className="ml-auto hidden items-center md:flex">{showWsIndicator()}</div>

              {/* 工具栏按钮组 */}
              <div className="flex shrink-0 items-center">
                <button
                  onClick={() => setSftpOpen(!sftpOpen)}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
                  title={sftpOpen ? '关闭文件面板' : '打开文件面板'}
                >
                  {sftpOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
                  <span className="hidden md:inline">文件</span>
                </button>

                {aiEnabled && (
                  <button
                    onClick={() => {
                      setAiOpen(!aiOpen)
                      if (aiOpen) setSftpOpen(true)
                    }}
                    className={`flex items-center gap-1 px-3 py-2 text-xs transition-colors ${
                      aiOpen
                        ? 'bg-wrench-600/20 text-wrench-400'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                    title={aiOpen ? '关闭 AI' : '打开 AI Agent'}
                  >
                    <Brain size={14} />
                    <span className="hidden md:inline">{aiOpen ? 'AI' : 'AI'}</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    if (!activeSession && connections.length > 0) {
                      selectConnection(connections[0]!.id)
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
                  title="打开终端"
                >
                  <Terminal size={14} />
                  <span className="hidden md:inline">终端</span>
                </button>
              </div>
            </div>

            {/* 中间终端区域 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {splits.length > 0 ? (
                <SplitContainer
                  splits={splits}
                  onSplit={handleSplit}
                  onRemove={handleRemoveSplit}
                  onConnectionChange={handleSplitConnectionChange}
                  connections={connectionOptions}
                  onToggleSync={handleToggleSync}
                  onMerge={handleMerge}
                  syncGroups={syncGroups}
                  activeSplitId={activeSplitId}
                  onSetActiveSplit={setActiveSplitId}
                  onTerminalData={handleTerminalData}
                />
              ) : activeSession ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <TerminalView
                    connectionId={activeSession.id}
                    sessionId={activeSession.id}
                    className="flex-1"
                  />
                </div>
              ) : null}

              {/* SFTP 侧边栏（桌面端侧栏，移动端隐藏） */}
              {sftpOpen && !aiOpen && activeSession && (
                <div className="hidden shrink-0 border-l border-slate-700/50 md:block">
                  <SftpSidebar sessionId={activeSession.id} />
                </div>
              )}

              {/* AI 侧边栏（桌面端侧栏，移动端全屏覆盖） */}
              {aiOpen && activeSession && (
                <div className="fixed inset-0 z-40 bg-slate-950 md:static md:z-auto md:shrink-0 md:border-l md:border-slate-700/50">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-slate-700/50 px-3 py-2 md:hidden">
                      <span className="text-xs font-medium text-slate-400">AI Agent</span>
                      <button
                        onClick={() => setAiOpen(false)}
                        className="btn-icon text-slate-500 hover:text-slate-300"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="mobile-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
                      <AiSidebar
                        sessionId={activeSession.id}
                        connectionId={activeSession.id}
                        onClose={() => setAiOpen(false)}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="max-w-full px-4 text-center">
              <Server size={48} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500">
                {wsStatus === 'connected'
                  ? '选择一个连接或新建连接'
                  : 'WebSocket 未连接，请稍候...'}
              </p>
              <button
                onClick={() => setSidebarOpen(true)}
                className="btn btn-primary mt-4 min-h-[44px] px-4 md:hidden"
              >
                <PlugZap size={16} />
                <span>查看连接列表</span>
              </button>
              {connections.length > 0 && (
                <div className="mt-4 hidden space-y-1 md:block">
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => handleDirectConnect(conn.id)}
                      disabled={connecting}
                      className="btn btn-ghost mx-auto block w-64 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{conn.name}</span>
                        <span className="ml-auto text-xs text-slate-600">
                          {conn.username}@{conn.host}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {connecting && <p className="mt-3 text-xs text-slate-600">连接中...</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
