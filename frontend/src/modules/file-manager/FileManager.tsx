/**
 * FileManager.tsx - 完整文件管理页面
 *
 * 功能：
 * - 左侧：SSH 连接选择 + SFTP 树形目录浏览
 * - 右侧：CodeMirror 编辑器（打开远程文件编辑）
 * - 支持：新建文件/文件夹、删除、重命名、上传/下载
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Server,
  FileCode2,
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  Image,
  ArrowUp,
  Home,
  RefreshCw,
  Upload,
  Download,
  Trash2,
  Edit3,
  Copy,
  FilePlus,
  FolderPlus,
  X,
  Check,
  Loader2,
  PanelLeftClose,
  PanelLeft,
  Terminal,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useFileStore } from '../../stores/file-store'
import { getWsClient } from '../../services/websocket'
import CodeMirrorEditor from '../../components/CodeMirrorEditor'
import type { SftpEntry, SshConnection } from '../../types/ssh'
import type { FileTab } from '../../types/file'
import type { WsClient } from '../../services/websocket'

// ─── 工具函数 ───

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <File size={16} className="text-slate-500" />
  switch (ext) {
    case 'js': case 'ts': case 'tsx': case 'jsx': case 'py': case 'go': case 'rs':
    case 'java': case 'c': case 'cpp': case 'rb': case 'php': case 'sh': case 'bash':
      return <FileCode size={16} className="text-sky-400" />
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml':
      return <FileJson size={16} className="text-amber-400" />
    case 'md': case 'txt': case 'log': case 'cfg': case 'conf': case 'env':
      return <FileText size={16} className="text-slate-400" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': case 'webp':
      return <Image size={16} className="text-purple-400" />
    default:
      return <File size={16} className="text-slate-500" />
  }
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    css: 'css', scss: 'scss', less: 'less',
    html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', txt: 'text', log: 'text',
    sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
    php: 'php', rb: 'ruby', pl: 'perl', lua: 'lua',
    dockerfile: 'dockerfile', docker: 'dockerfile',
    env: 'dotenv', conf: 'nginx', cfg: 'ini',
  }
  return map[ext] || 'text'
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(1)} ${units[i]}`
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatPerms(mode: number): string {
  const s = mode.toString(8).slice(-3)
  const p = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return s.split('').map(c => p[parseInt(c)] || '---').join('')
}

// ─── 主要组件 ───

export default function FileManager() {
  const connections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)
  const addSession = useSshStore((s) => s.addSession)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [sftpSessionId, setSftpSessionId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const wsClient = getWsClient()
  const fileStore = useFileStore()

  // 连接并打开 SFTP
  const connectingRef = useRef(false)
  const connectAndSftp = useCallback(async (connId: string) => {
    const conn = connections.find(c => c.id === connId)
    if (!conn || connectingRef.current) return

    connectingRef.current = true
    setConnecting(true)
    setActiveConnId(connId)

    // 🔥 清除该连接的所有已有 session
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
    } catch (err) {
      console.error('SFTP 连接失败:', err)
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }, [connections, wsClient, addSession])

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧 SFTP 浏览器 */}
      {sidebarOpen && (
        <SftpBrowser
          sessionId={sftpSessionId}
          connections={connections}
          activeConnId={activeConnId}
          onConnect={connectAndSftp}
          onClose={() => setSidebarOpen(false)}
          connecting={connecting}
          wsClient={wsClient}
        />
      )}

      {/* 右侧编辑器 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 border-b border-slate-700/50 bg-slate-900/50 px-3 py-1.5">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="btn-icon text-slate-500 hover:text-slate-300"
            title={sidebarOpen ? '隐藏文件浏览器' : '显示文件浏览器'}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>

          {/* 连接选择 */}
          <select
            value={activeConnId || ''}
            onChange={(e) => e.target.value && connectAndSftp(e.target.value)}
            className="max-w-[180px] truncate rounded bg-transparent px-2 py-1 text-xs text-slate-400 outline-none hover:text-slate-300"
          >
            <option value="">选择 SSH 连接...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
            ))}
          </select>

          {connecting && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Loader2 size={12} className="animate-spin" /> 连接中...
            </span>
          )}

          {!sftpSessionId && !connecting && (
            <span className="text-xs text-slate-600">请选择 SSH 连接以浏览远程文件</span>
          )}

          {/* 已打开标签 */}
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
                  {sftpSessionId ? '在左侧文件浏览器中选择要编辑的文件' : '请先连接 SSH 服务器'}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  支持双击文件在新标签页中打开编辑
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SFTP 文件浏览器 ───

interface SftpBrowserProps {
  sessionId: string | null
  connections: SshConnection[]
  activeConnId: string | null
  onConnect: (connId: string) => void
  onClose: () => void
  connecting: boolean
  wsClient: WsClient
}

function SftpBrowser({
  sessionId,
  connections,
  activeConnId,
  onConnect,
  onClose,
  connecting,
  wsClient,
}: SftpBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: SftpEntry | null } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingDir, setCreatingDir] = useState(false)
  const [createName, setCreateName] = useState('')
  const fileStore = useFileStore()
  const notifyRef = useRef<HTMLDivElement>(null)

  // 读取目录 — 用 ref 避免 wsClient 引用变动导致 useCallback 失效
  const wsClientRef = useRef(wsClient)
  wsClientRef.current = wsClient

  const listDir = useCallback(async (dirPath: string) => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const resp = await wsClientRef.current.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'list',
        path: dirPath,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'list') {
        setCurrentPath(dirPath)
        setEntries(resp.files as SftpEntry[])
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // 初始化 — sessionId 变化时自动加载根目录
  useEffect(() => {
    if (sessionId) {
      setCurrentPath('/')
      setEntries([])
      setError(null)
      const timer = setTimeout(() => listDir('/'), 0)
      return () => clearTimeout(timer)
    } else {
      setEntries([])
      setCurrentPath('/')
    }
  }, [sessionId])

  // 关闭右键菜单
  useEffect(() => {
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  const navigateTo = (p: string) => listDir(p)
  const goUp = () => {
    const parent = currentPath === '/' ? '/' : currentPath.split('/').slice(0, -1).join('/') || '/'
    listDir(parent)
  }
  const goHome = () => listDir('/')
  const refresh = () => listDir(currentPath)

  // 删除文件/目录
  const handleDelete = async (entry: SftpEntry) => {
    if (!sessionId) return
    try {
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: entry.type === 'directory' ? 'rmdir' : 'unlink',
        path: entry.path,
      })
      refresh()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
    setContextMenu(null)
  }

  // 重命名
  const handleRename = async (entry: SftpEntry, newName: string) => {
    if (!sessionId || !newName.trim()) return
    const parentPath = entry.path.includes('/')
      ? entry.path.substring(0, entry.path.lastIndexOf('/'))
      : ''
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    try {
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'rename',
        fromPath: entry.path,
        toPath: newPath,
      })
      setRenaming(null)
      refresh()
    } catch (err) {
      alert('重命名失败: ' + (err as Error).message)
    }
    setContextMenu(null)
  }

  // 新建文件/文件夹
  const handleCreate = async (type: 'file' | 'directory') => {
    if (!sessionId || !createName.trim()) return
    const fullPath = currentPath === '/' ? `/${createName}` : `${currentPath}/${createName}`
    try {
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: type === 'directory' ? 'mkdir' : 'writefile',
        path: fullPath,
        content: type === 'file' ? btoa('') : undefined,
      })
      setCreatingFile(false)
      setCreatingDir(false)
      setCreateName('')
      refresh()
    } catch (err) {
      alert('创建失败: ' + (err as Error).message)
    }
  }

  // 在编辑器中打开文件
  const openInEditor = async (entry: SftpEntry) => {
    if (!sessionId || entry.type === 'directory') return

    const tabId = `sftp_${sessionId}_${entry.path}`
    // 检查是否已打开
    if (fileStore.openTabs.some(t => t.id === tabId)) {
      fileStore.setActiveTab(tabId)
      return
    }

    try {
      const resp = await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'readfile',
        path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        const decoded = atob(resp.data as string)
        const tab: FileTab = {
          id: tabId,
          name: entry.name,
          path: entry.path,
          source: 'sftp',
          language: detectLanguage(entry.name),
          content: decoded,
          originalContent: decoded,
          isDirty: false,
          sessionId,
        }
        fileStore.openFile(tab)
        // 移动端自动展开编辑器
        setContextMenu(null)
      }
    } catch (err) {
      alert('打开文件失败: ' + (err as Error).message)
    }
  }

  // 下载文件
  const handleDownload = async (entry: SftpEntry) => {
    if (!sessionId || entry.type === 'directory') return
    try {
      const resp = await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'readfile',
        path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        const blob = new Blob([Uint8Array.from(atob(resp.data as string), c => c.charCodeAt(0))])
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = entry.name
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      alert('下载失败: ' + (err as Error).message)
    }
    setContextMenu(null)
  }

  // 右键菜单（文件/目录上）
  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  // 空白处右键
  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry: null })
  }

  const pathParts = currentPath.split('/').filter(Boolean)
  const dirs = entries.filter(e => e.type === 'directory')
  const files = entries.filter(e => e.type !== 'directory')

  const connSelectValue = activeConnId || ''
  const currentConnect = connections.find(c => c.id === activeConnId)

  return (
    <div className="flex w-72 flex-col border-r border-slate-700/50 bg-slate-950 md:w-80">
      {/* 连接选择头部 */}
      <div className="border-b border-slate-700/50 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <select
            value={connSelectValue}
            onChange={(e) => e.target.value && onConnect(e.target.value)}
            className="flex-1 truncate rounded bg-transparent text-xs text-slate-300 outline-none"
          >
            <option value="">选择连接...</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.username}@{c.host})
              </option>
            ))}
          </select>
          {connecting && <Loader2 size={14} className="animate-spin text-amber-400" />}
          {sessionId && <span className="h-2 w-2 rounded-full bg-emerald-500" title="已连接" />}
        </div>
        {currentConnect && !sessionId && (
          <button
            onClick={() => onConnect(currentConnect.id)}
            className="mt-1 w-full rounded bg-smartbox-600/20 px-2 py-1 text-[11px] text-smartbox-400 hover:bg-smartbox-600/30"
          >
            <Terminal size={12} className="inline mr-1" />
            点击连接 SSH
          </button>
        )}
      </div>

      {/* 工具栏 */}
      {sessionId && (
        <>
          <div className="flex items-center gap-0.5 border-b border-slate-700/30 px-2 py-1">
            <button onClick={goHome} className="btn-icon text-slate-500 hover:text-slate-300" title="根目录">
              <Home size={14} />
            </button>
            <button onClick={goUp} className="btn-icon text-slate-500 hover:text-slate-300" title="上级目录">
              <ArrowUp size={14} />
            </button>
            <button onClick={refresh} className="btn-icon text-slate-500 hover:text-slate-300" title="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <div className="mx-1 h-4 w-px bg-slate-700/50" />
            <button
              onClick={() => { setCreatingFile(true); setCreatingDir(false); setCreateName('') }}
              className="btn-icon text-slate-500 hover:text-slate-300" title="新建文件"
            >
              <FilePlus size={14} />
            </button>
            <button
              onClick={() => { setCreatingDir(true); setCreatingFile(false); setCreateName('') }}
              className="btn-icon text-slate-500 hover:text-slate-300" title="新建文件夹"
            >
              <FolderPlus size={14} />
            </button>
            <div className="mx-1 h-4 w-px bg-slate-700/50" />
            <div className="ml-auto flex items-center gap-1">
              <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300 md:hidden">
                <X size={14} />
              </button>
            </div>
          </div>

          {/* 面包屑 */}
          <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-700/30 px-2 py-1 text-xs">
            <button onClick={goHome} className="shrink-0 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300">
              /
            </button>
            {pathParts.map((part, i) => {
              const fullPath = '/' + pathParts.slice(0, i + 1).join('/')
              return (
                <span key={fullPath} className="flex items-center gap-0.5">
                  <span className="text-slate-600">/</span>
                  <button
                    onClick={() => navigateTo(fullPath)}
                    className="rounded px-1 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    {part}
                  </button>
                </span>
              )
            })}
            {loading && <span className="ml-2 text-[10px] text-slate-600">加载中...</span>}
          </div>

          {/* 新建输入 */}
          {(creatingFile || creatingDir) && (
            <div className="flex items-center gap-1 border-b border-slate-700/30 px-2 py-1.5">
              {creatingFile ? <FilePlus size={14} className="text-sky-400 shrink-0" /> : <FolderPlus size={14} className="text-amber-400 shrink-0" />}
              <input
                autoFocus
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate(creatingFile ? 'file' : 'directory')
                  if (e.key === 'Escape') { setCreatingFile(false); setCreatingDir(false) }
                }}
                placeholder={creatingFile ? '文件名' : '文件夹名'}
                className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none"
              />
              <button onClick={() => handleCreate(creatingFile ? 'file' : 'directory')} className="btn-icon text-emerald-400 hover:text-emerald-300">
                <Check size={14} />
              </button>
              <button onClick={() => { setCreatingFile(false); setCreatingDir(false) }} className="btn-icon text-slate-500 hover:text-slate-300">
                <X size={14} />
              </button>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div ref={notifyRef} className="mx-2 mt-1 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
              {error}
            </div>
          )}

          {/* 文件列表 */}
          <div className="flex-1 overflow-y-auto" onContextMenu={handleEmptyContextMenu}>
            {/* 目录 */}
            {dirs.map((dir) => (
              <div key={dir.path}>
                <div
                  className={`group flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-slate-800/50 ${
                    selectedEntry === dir.path ? 'bg-slate-800/30' : ''
                  }`}
                  onClick={() => navigateTo(dir.path)}
                  onContextMenu={(e) => handleContextMenu(e, dir)}
                >
                  <Folder size={14} className="shrink-0 text-amber-400" />
                  <span className="truncate text-slate-300">{dir.name}</span>
                  <span className="ml-auto text-[10px] text-slate-600 opacity-0 group-hover:opacity-100">
                    {formatPerms(parseInt(dir.permissions, 8))}
                  </span>
                </div>
              </div>
            ))}

            {/* 文件 */}
            {files.map((file) => (
              <div
                key={file.path}
                className={`group flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-800/50 ${
                  selectedEntry === file.path ? 'bg-slate-800/30' : ''
                }`}
                onDoubleClick={() => openInEditor(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                {getFileIcon(file.name)}
                <span className="truncate text-slate-300 flex-1">{file.name}</span>
                <span className="text-[10px] text-slate-600 shrink-0">{formatSize(file.size)}</span>
              </div>
            ))}

            {/* 空状态 */}
            {!loading && entries.length === 0 && (
              <div className="flex flex-col items-center py-8 text-slate-600">
                <Folder size={24} />
                <p className="mt-1 text-xs">空目录</p>
              </div>
            )}
          </div>

          {/* 状态栏 */}
          <div className="border-t border-slate-700/30 px-2 py-1 text-[10px] text-slate-600 flex items-center justify-between">
            <span>{entries.length} 项</span>
            <span className="truncate ml-2">{currentPath}</span>
          </div>
        </>
      )}

      {/* 未连接时的提示 */}
      {!sessionId && !connecting && (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center">
            <Server size={32} className="mx-auto mb-2 text-slate-600" />
            <p className="text-xs text-slate-500">选择 SSH 连接以浏览远程文件</p>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[150px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry ? (
            <>
              {contextMenu.entry.type === 'file' && (
                <>
                  <button
                    onClick={() => openInEditor(contextMenu.entry!)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <FileCode2 size={12} /> 编辑
                  </button>
                  <button
                    onClick={() => handleDownload(contextMenu.entry!)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <Download size={12} /> 下载
                  </button>
                </>
              )}
              {contextMenu.entry.type === 'directory' && (
                <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                  <Upload size={12} /> 上传到此（WIP）
                </button>
              )}
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  setRenaming(contextMenu.entry!.path)
                  setRenameValue(contextMenu.entry!.name)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Edit3 size={12} /> 重命名
              </button>
              <button
                onClick={() => handleDelete(contextMenu.entry!)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700"
              >
                <Trash2 size={12} /> 删除
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.entry!.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Copy size={12} /> 复制路径
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setCreatingFile(true); setCreatingDir(false); setCreateName(''); setContextMenu(null) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <FilePlus size={12} /> 新建文件
              </button>
              <button
                onClick={() => { setCreatingDir(true); setCreatingFile(false); setCreateName(''); setContextMenu(null) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <FolderPlus size={12} /> 新建文件夹
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => { refresh(); setContextMenu(null) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <RefreshCw size={12} /> 刷新
              </button>
            </>
          )}
        </div>
      )}

      {/* 重命名输入框 */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4 shadow-xl">
            <p className="mb-2 text-xs text-slate-400">重命名</p>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const entry = entries.find(en => en.path === renaming)
                  if (entry) handleRename(entry, renameValue)
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              className="input min-w-[200px]"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setRenaming(null)} className="btn-ghost text-xs">取消</button>
              <button
                onClick={() => {
                  const entry = entries.find(en => en.path === renaming)
                  if (entry) handleRename(entry, renameValue)
                }}
                className="btn-primary text-xs"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
