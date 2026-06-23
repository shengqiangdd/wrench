import { useState, useEffect } from 'react'
import {
  Terminal,
  PanelRightClose,
  PanelRightOpen,
  Server,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useAppStore } from '../../stores/app-store'
import { getWsClient, type WsStatus } from '../../services/websocket'
import ConnectionList from './ConnectionList'
import TerminalView from './Terminal'
import SftpSidebar from './SftpSidebar'
import type { SshSession } from '../../types/ssh'

export default function SshPlaceholder() {
  const connections = useSshStore((s) => s.connections)
  const selectedConnectionId = useSshStore((s) => s.selectedConnectionId)
  const selectConnection = useSshStore((s) => s.selectConnection)
  const sessions = useSshStore((s) => s.sessions)
  const addSession = useSshStore((s) => s.addSession)
  const removeSession = useSshStore((s) => s.removeSession)
  const addSshSession = useAppStore((s) => s.addSshSession)
  const removeSshSession = useAppStore((s) => s.removeSshSession)

  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected')
  const [connecting, setConnecting] = useState(false)
  const [sftpOpen, setSftpOpen] = useState(true)

  const wsClient = getWsClient()

  // 监听 WebSocket 状态
  useEffect(() => {
    const unsub = wsClient.onStatus((status) => {
      setWsStatus(status)
    })
    wsClient.connect()
    return () => {
      unsub()
    }
  }, [])

  const handleConnect = async (connectionId: string) => {
    const conn = connections.find((c) => c.id === connectionId)
    if (!conn || connecting) return

    setConnecting(true)
    const sessionId = `sess_${connectionId}_${Date.now()}`

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

      const session: SshSession = {
        id: sessionId,
        connectionId,
        connectionName: conn.name,
        host: conn.host,
        status: 'connected',
        terminalCols: 80,
        terminalRows: 24,
      }
      addSession(session)
      addSshSession(sessionId)
      selectConnection(sessionId)
    } catch (err) {
      console.error('SSH 连接失败:', err)
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = (sessionId: string) => {
    wsClient.send({
      type: 'disconnect',
      connectionId: sessionId,
    })
    removeSession(sessionId)
    removeSshSession(sessionId)
    selectConnection(null)
  }

  const activeSession = sessions.find(
    (s) => s.id === selectedConnectionId && s.status === 'connected',
  )
  const allSessions = sessions.filter((s) => s.status === 'connected')

  return (
    <div className="flex h-full">
      {/* 左侧连接列表 */}
      <div className="flex w-64 shrink-0 flex-col border-r border-slate-700/50 md:w-72">
        <div className="flex items-center gap-2 border-b border-slate-700/50 px-3 py-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
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
          <button
            onClick={() => wsClient.connect()}
            className="ml-auto text-[10px] text-slate-600 hover:text-slate-400"
          >
            {wsStatus === 'disconnected' ? '重连' : ''}
          </button>
        </div>
        <ConnectionList />
      </div>

      {/* 中间终端区域 */}
      <div className="flex flex-1 flex-col">
        {activeSession ? (
          <>
            {/* 标签栏 */}
            <div className="flex items-center border-b border-slate-700/50 bg-slate-900/50">
              {allSessions.map((sess) => (
                <button
                  key={sess.id}
                  onClick={() => selectConnection(sess.id)}
                  className={`flex items-center gap-1.5 border-r border-slate-700/50 px-3 py-2 text-xs transition-colors ${
                    sess.id === activeSession.id
                      ? 'bg-slate-800 text-slate-200'
                      : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {sess.connectionName}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDisconnect(sess.id)
                    }}
                    className="ml-1 text-slate-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                </button>
              ))}

              {/* SFTP 切换按钮 */}
              <button
                onClick={() => setSftpOpen(!sftpOpen)}
                className="ml-auto flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-300"
                title={sftpOpen ? '关闭文件面板' : '打开文件面板'}
              >
                {sftpOpen ? (
                  <PanelRightClose size={14} />
                ) : (
                  <PanelRightOpen size={14} />
                )}
                <span className="hidden md:inline">文件</span>
              </button>
            </div>

            {/* 终端 + SFTP 侧边栏 */}
            <div className="flex flex-1 overflow-hidden">
              <TerminalView
                connectionId={activeSession.id}
                sessionId={activeSession.id}
                className="flex-1"
              />
              {sftpOpen && (
                <div className="w-64 shrink-0 border-l border-slate-700/50 md:w-72">
                  <SftpSidebar sessionId={activeSession.id} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Server size={48} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm text-slate-500">
                {wsStatus === 'connected'
                  ? '选择一个连接或新建连接'
                  : 'WebSocket 未连接，请稍候...'}
              </p>
              {connections.length > 0 && (
                <div className="mt-4 space-y-1">
                  {connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => handleConnect(conn.id)}
                      disabled={connecting}
                      className="btn-ghost mx-auto block w-64 text-left"
                    >
                      <span className="text-sm">{conn.name}</span>
                      <span className="ml-2 text-xs text-slate-600">
                        {conn.username}@{conn.host}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {connecting && (
                <p className="mt-3 text-xs text-slate-600">连接中...</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
