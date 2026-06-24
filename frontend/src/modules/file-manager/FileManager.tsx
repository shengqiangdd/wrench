/**
 * FileManager.tsx - 完整文件管理页面
 *
 * 功能：
 * - 左侧：SSH 连接选择 + SFTP 树形目录浏览（通过 SftpBrowser 组件）
 * - 右侧：CodeMirror 编辑器（打开远程文件编辑）
 * - 文件双击 → 自动加载到 CodeMirror 编辑器标签页
 * - 标签栏：多标签编辑，状态持久化
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
import { useFileStore } from '../../stores/file-store'
import { getWsClient } from '../../services/websocket'
import SftpBrowser from '../ssh/SftpBrowser'
import CodeMirrorEditor from '../../components/CodeMirrorEditor'
import type { SftpEntry } from '../../types/ssh'

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

// ─── 主组件 ───

export default function FileManager() {
  const connections = useSshStore((s) => s.connections)
  const addSession = useSshStore((s) => s.addSession)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const wsClient = getWsClient()
  const fileStore = useFileStore()
  const connectingRef = useRef(false)

  // 状态持久化路径缓存
  const [connPathCache] = useState(() => new Map<string, string>())

  // 连接并打开 SFTP
  const connectAndSftp = useCallback(async (connId: string) => {
    const conn = connections.find(c => c.id === connId)
    if (!conn || connectingRef.current) return

    connectingRef.current = true
    setConnecting(true)
    setActiveConnId(connId)

    // 清除已有 session
    const store = useSshStore.getState()
    const existing = store.sessions.filter(s => s.connectionId === connId)
    for (const sess of existing) {
      wsClient.send({ type: 'disconnect', connectionId: sess.id })
      store.removeSession(sess.id)
    }

    const sessionId = `sftp_${connId}_${Date.now()}`

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
      setSftpSessionId(sessionId)
      addSession({
        id: sessionId,
        connectionId: connId,
        connectionName: conn.name,
        host: conn.host,
        status: 'connected',
        terminalCols: 80,
        terminalRows: 24,
      })
      // 恢复上次路径
      return connPathCache.get(connId) || '/'
    } catch (err) {
      console.error('SFTP 连接失败:', err)
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }, [connections, wsClient, addSession, connPathCache])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧文件浏览器 */}
      {sidebarOpen && (
        <div className="flex w-64 shrink-0 flex-col border-r border-slate-700/50 md:w-72">
          <div className="flex items-center justify-between border-b border-slate-700/30 px-2 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">文件</span>
            <button
              onClick={() => setSidebarOpen(false)}
              className="btn-icon text-slate-500 hover:text-slate-300"
              title="隐藏文件浏览器"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          <SftpBrowser
            sessionId={sftpSessionId}
            activeConnId={activeConnId}
            connectionOptions={connections.map(c => ({ id: c.id, name: c.name, host: c.host }))}
            onConnect={connectAndSftp}
            connecting={connecting}
            showConnector={true}
          />
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
              <Loader2 size={12} className="animate-spin" /> 连接中...
            </span>
          )}
          {!sftpSessionId && !connecting && (
            <span className="text-xs text-slate-600">在左侧文件浏览器中选择 SSH 连接以浏览远程文件</span>
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
                    onClick={(e) => { e.stopPropagation(); fileStore.closeFile(tab.id) }}
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
                  {sftpSessionId ? '在左侧文件浏览器中双击文件打开编辑' : '请先连接 SSH 服务器'}
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
