import { useState, useEffect, useCallback, useRef } from 'react'
import { Server, PanelRightClose, PanelRightOpen, Menu, PlugZap, X, Terminal } from 'lucide-react'
import { useAppStore, type SplitDef } from '../../stores/app-store'
import { useSshStore, decryptConnection } from '../../stores/ssh-store'
import {
  sessionCredentials,
  setSessionCredentials,
  deleteSessionCredentials,
  resolveSessionCredentials,
} from '../../services/session-credentials'
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
  const [connectError, setConnectError] = useState<string | null>(null)

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
        // 🔐 解密存储的密码/私钥，存到 credentialsMap 供 Terminal 使用
        const decryptedConn = await decryptConnection(conn)

        setConnectError(null) // 清除之前的错误

        // 存储解密凭据（Terminal 组件会使用它建立独立 WS 连接）
        setSessionCredentials(sessionId, {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: decryptedConn.password,
          privateKey: decryptedConn.privateKey,
          sudoPassword: decryptedConn.sudoPassword || decryptedConn.password,
        })

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
        }
        // 移动端连接成功后关闭侧边栏
        setSidebarOpen(false)
        return sessionId
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : '连接失败'
        console.error('SSH 连接失败:', err)
        setConnectError(errorMsg)
        // 移动端连接失败后也关闭侧边栏，让用户看到错误提示
        setSidebarOpen(false)
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

  // ─── 批量并行连接多个 SSH 主机（限制并发数） ───
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleBatchConnect = useCallback(
    async (connectionIds: string[]) => {
      if (connectionIds.length === 0) return

      setConnecting(true)

      // 限制并发连接数为 3，避免后端过载导致超时
      const MAX_CONCURRENT = 3
      const results: (string | null)[] = []

      // 分批处理连接
      for (let i = 0; i < connectionIds.length; i += MAX_CONCURRENT) {
        const batch = connectionIds.slice(i, i + MAX_CONCURRENT)
        const batchResults = await Promise.allSettled(batch.map((connId) => handleConnect(connId)))

        // 收集本批次的结果
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            results.push(result.value)
          } else {
            results.push(null)
          }
        }
      }

      // 返回成功连接的 sessionId 列表
      const successIds = results.filter((id): id is string => id !== null)

      if (successIds.length > 0) {
        setSplits([])
      }
      return successIds
    },
    [handleConnect, setSplits],
  )

  // ─── 断开连接（通过 REST API 而非共享 WS） ───

  const handleDisconnect = useCallback(
    (sessionId: string) => {
      // 清理凭据
      deleteSessionCredentials(sessionId)
      // 通过 REST API 断开后端连接
      fetch('/api/ssh/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: sessionId }),
      }).catch(() => {
        // 忽略断开连接的错误 — 连接可能已断开
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
  // TODO: 分屏命令同步需要每个终端的 WS 引用，当前暂不实现。
  // 每个 Terminal 创建独立 WS，父组件无法直接访问它们的 WS client。
  // 替代方案：通过 BroadcastChannel 或后端 relay 实现。

  const handleTerminalData = useCallback((_sessionId: string, _data: string) => {
    // 命令同步功能暂未实现（每个终端使用独立 WS 连接）
  }, [])

  // ─── 渲染 ───

  const activeSession = sessions.find(
    (s) => s.id === selectedConnectionId && s.status === 'connected',
  )

  // ─── 兜底：页面刷新后内存 Map 为空时自动解密凭据 ───
  const [resolvedCreds, setResolvedCreds] = useState<Record<
    string,
    import('./Terminal').SshCredentials
  > | null>(null)
  const activeSessionId = activeSession?.id
  useEffect(() => {
    if (!activeSessionId) return
    // 同步检查 Map 是否已有凭据
    if (sessionCredentials.has(activeSessionId)) return
    // 异步解密兜底
    let cancelled = false
    resolveSessionCredentials(activeSessionId).then((creds) => {
      if (!cancelled && creds) {
        // 使用 setTimeout 将 setState 移出 effect 同步执行
        setTimeout(() => {
          setResolvedCreds((prev) => ({ ...prev, [activeSessionId]: creds }))
        }, 0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeSessionId, sessions])

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden lg:h-auto lg:flex-1">
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
            <span className="text-[11px] text-slate-500">连接列表</span>
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
            {/* 连接错误提示 */}
            {connectError && (
              <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2">
                <span className="text-xs text-red-400">{connectError}</span>
                <button
                  onClick={() => setConnectError(null)}
                  className="ml-auto text-xs text-red-500 underline hover:text-red-400"
                >
                  关闭
                </button>
              </div>
            )}
            {/* 标签栏 */}
            <div className="flex items-center border-b border-slate-700/50 bg-slate-900/50">
              <button
                onClick={() => setSidebarOpen(true)}
                className="btn-icon text-slate-500 hover:text-slate-300 md:hidden"
                title="打开连接列表"
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
                    title={aiOpen ? '关闭 AI' : 'AI 助手'}
                  >
                    <PlugZap size={14} />
                    <span className="hidden md:inline">AI</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    if (!activeSession && connections.length > 0) {
                      selectConnection(connections[0]!.id)
                    } else if (activeSession) {
                      // 已有连接时，聚焦终端输入区域
                      const termEl = document.querySelector(
                        '.xterm-helper-textarea',
                      ) as HTMLElement | null
                      termEl?.focus()
                    }
                  }}
                  className="flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
                  title="终端"
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
                  credentialsMap={sessionCredentials}
                  resolvedCredentials={resolvedCreds}
                />
              ) : activeSession ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <TerminalView
                    connectionId={activeSession.id}
                    sessionId={activeSession.id}
                    className="flex-1"
                    credentials={
                      sessionCredentials.get(activeSession.id) || resolvedCreds?.[activeSession.id]
                    }
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
              {aiOpen && (
                <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 md:static md:z-auto md:shrink-0 md:border-l md:border-slate-700/50">
                  {activeSession ? (
                    <AiSidebar
                      sessionId={activeSession.id}
                      connectionId={activeSession.id}
                      onClose={() => setAiOpen(false)}
                    />
                  ) : (
                    <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                      <PlugZap size={32} className="mb-3 text-slate-600" />
                      <p className="text-sm text-slate-400">请先连接服务器</p>
                      <p className="mt-1 text-xs text-slate-600">AI Agent 需要 SSH 连接才能使用</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="max-w-full px-4 text-center">
              <Server size={48} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500">选择一个连接或新建连接</p>
              {/* 显示 SSH 连接错误信息 */}
              {connectError && (
                <div className="mx-auto mt-3 max-w-sm rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                  <p className="text-xs text-red-400">{connectError}</p>
                  <button
                    onClick={() => setConnectError(null)}
                    className="mt-1 text-xs text-red-500 underline hover:text-red-400"
                  >
                    关闭
                  </button>
                </div>
              )}
              <button
                onClick={() => setSidebarOpen(true)}
                className="btn btn-primary mt-4 min-h-[44px] px-4 md:hidden"
              >
                <Menu size={16} />
                <span>打开连接列表</span>
              </button>
              {/* 桌面端：直接显示快速连接选项 */}
              {connections.length > 0 && (
                <div className="mt-4 hidden md:block">
                  <p className="mb-2 text-xs text-slate-600">快速连接</p>
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => handleDirectConnect(conn.id)}
                      className="mb-1 block w-full rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-700/50"
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
