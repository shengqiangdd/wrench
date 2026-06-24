/**
 * SftpBrowser.tsx — 通用 SFTP 文件浏览器组件
 *
 * 被 FileManager.tsx 和 SftpSidebar.tsx 共用。
 * 功能：
 * - 树形目录浏览 + 面包屑导航
 * - 新建文件/文件夹（工具栏 + 右键空白处）
 * - 删除、重命名、复制路径、下载
 * - 单击查看（模态框）、双击打开到 CodeMirror 编辑器
 * - 文件列表按名称排序（目录在前、字母序）
 * - sftp-ready 事件监听保障首次加载
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  Image,
  ArrowUp,
  Home,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Edit3,
  Copy,
  FilePlus,
  FolderPlus,
  Server,
  X,
  Check,
  Loader2,
  Eye,
  Save,
  ExternalLink,
} from 'lucide-react'
import { useFileStore } from '../../stores/file-store'
import { getWsClient } from '../../services/websocket'
import type { SftpEntry } from '../../types/ssh'
import type { WsClient } from '../../services/websocket'

interface SftpBrowserProps {
  sessionId: string | null
  /** 可选：用于在 FileManager 中选中连接 */
  activeConnId?: string | null
  /** 连接列表（可选，用于下拉选择） */
  connectionOptions?: { id: string; name: string; host: string }[]
  /** 连接回调（可选） */
  onConnect?: (connId: string) => void
  /** 连接中状态 */
  connecting?: boolean
  /** 是否显示连接选择器（FileManager 顶部有，这里默认不显示） */
  showConnector?: boolean
  /** 文件双击回调 — 默认发送到 fileStore.openFile */
  onFileDoubleClick?: (entry: SftpEntry) => void
  /** 宽度类名 */
  widthClass?: string
  /** wsClient 外部传入或自动获取 */
  wsClient?: WsClient
}

// ─── 工具函数 ───

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <File size={14} className="text-slate-500" />
  switch (ext) {
    case 'js': case 'ts': case 'tsx': case 'jsx': case 'py': case 'go': case 'rs':
    case 'java': case 'c': case 'cpp': case 'rb': case 'php': case 'sh': case 'bash':
      return <FileCode size={14} className="text-sky-400" />
    case 'json': case 'yaml': case 'yml': case 'toml': case 'xml':
      return <FileJson size={14} className="text-amber-400" />
    case 'md': case 'txt': case 'log': case 'cfg': case 'conf': case 'env':
      return <FileText size={14} className="text-slate-400" />
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'ico': case 'webp':
      return <Image size={14} className="text-purple-400" />
    default:
      return <File size={14} className="text-slate-500" />
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++ }
  return `${size.toFixed(1)} ${units[i]}`
}

function formatPerms(mode: number): string {
  const s = mode.toString(8).slice(-3)
  const p = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return s.split('').map(c => p[parseInt(c)] || '---').join('')
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

/** 兜底的复制方案：当 navigator.clipboard 不可用时使用 */
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch {}
  document.body.removeChild(ta)
}

/** 按名称排序：目录在前，文件在后，字母序 */
function sortEntries(entries: SftpEntry[]) {
  return {
    dirs: entries.filter(e => e.type === 'directory').sort((a, b) => a.name.localeCompare(b.name)),
    files: entries.filter(e => e.type !== 'directory').sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ─── 文件查看/编辑模态框 ───

function FilePreviewModal({
  entry, sessionId, onClose, onSaved, onOpenInEditor,
}: {
  entry: SftpEntry
  sessionId: string
  onClose: () => void
  onSaved: () => void
  onOpenInEditor?: (entry: SftpEntry) => void
}) {
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const wsClient = getWsClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { loadFile() }, [entry.path])

  const loadFile = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'readfile',
        path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        const decoded = atob(resp.data as string)
        setContent(decoded)
        setOriginalContent(decoded)
      }
    } catch (err) {
      setError('读取失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const encoded = btoa(content)
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'writefile',
        path: entry.path,
        content: encoded,
      })
      setOriginalContent(content)
      setSaveMsg('✅ 已保存')
      setTimeout(() => setSaveMsg(null), 2000)
      onSaved()
    } catch (err) {
      setSaveMsg('❌ 保存失败: ' + (err as Error).message)
      setTimeout(() => setSaveMsg(null), 3000)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = content !== originalContent

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="mx-4 flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            {getFileIcon(entry.name)}
            <span className="text-sm font-medium text-slate-200">{entry.name}</span>
            <span className="text-[10px] text-slate-500">
              {formatSize(entry.size)} · {entry.path}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onOpenInEditor && (
              <button
                onClick={() => { onOpenInEditor(entry); onClose() }}
                className="btn-icon text-slate-500 hover:text-emerald-400"
                title="在编辑器中打开"
              >
                <ExternalLink size={14} />
              </button>
            )}
            {!editMode && (
              <button
                onClick={() => setEditMode(true)}
                className="btn-icon text-slate-500 hover:text-sky-400"
                title="编辑"
              >
                <Edit3 size={14} />
              </button>
            )}
            <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin text-slate-500" />
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-red-400">{error}</div>
          ) : editMode ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-[50vh] w-full resize-none border-0 bg-transparent p-4 font-mono text-sm text-slate-200 outline-none"
              spellCheck={false}
            />
          ) : (
            <pre className="h-[50vh] w-full overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-sm text-slate-300">
              {content}
            </pre>
          )}
        </div>

        {/* 底部工具栏 */}
        <div className="flex items-center justify-between border-t border-slate-700/50 px-4 py-2">
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                onClick={() => setEditMode(false)}
                className="btn-ghost text-xs text-slate-400 hover:text-slate-300"
              >
                取消编辑
              </button>
            )}
            {saveMsg && (
              <span className={`text-xs ${saveMsg.includes('❌') ? 'text-red-400' : 'text-emerald-400'}`}>
                {saveMsg}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!editMode && (
              <span className="text-[10px] text-slate-600">
                点击 ✏️ 编辑{onOpenInEditor ? ' 或 📎 在编辑器中打开' : ''}
              </span>
            )}
            {editMode && (
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className={`btn-primary flex items-center gap-1 px-3 py-1.5 text-xs ${!isDirty ? 'opacity-50' : ''}`}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                保存
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── 主组件 ───

export default function SftpBrowser({
  sessionId,
  activeConnId,
  connectionOptions,
  onConnect,
  connecting: externalConnecting,
  showConnector = false,
  onFileDoubleClick,
  widthClass,
}: SftpBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<SftpEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; entry: SftpEntry | null
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingDir, setCreatingDir] = useState(false)
  const [createName, setCreateName] = useState('')
  const [previewEntry, setPreviewEntry] = useState<SftpEntry | null>(null)
  const [sftpReady, setSftpReady] = useState(false)

  const wsClient = getWsClient()
  const wsRef = useRef(wsClient)
  wsRef.current = wsClient
  const retryCountRef = useRef(0)
  const fileStore = useFileStore()
  const notifyRef = useRef<HTMLDivElement>(null)

  // 监听 sftp-ready 事件
  useEffect(() => {
    if (!sessionId) { setSftpReady(false); return }
    setSftpReady(false)
    const unsub = wsClient.on('sftp-ready', (data) => {
      if (data.connectionId === sessionId) setSftpReady(true)
    })
    return () => unsub()
  }, [sessionId, wsClient])

  // 读取目录
  const listDir = useCallback(async (dirPath: string, retryOnNotReady = true) => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const resp = await wsRef.current.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'list',
        path: dirPath,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'list') {
        setCurrentPath(dirPath)
        setEntries(resp.files as SftpEntry[])
        retryCountRef.current = 0
      }
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('SFTP_NOT_READY') && retryOnNotReady && retryCountRef.current < 5) {
        retryCountRef.current++
        setTimeout(() => listDir(dirPath, true), 1000)
        return
      }
      // 如果连接已断开，在文件列表区显示提示
      if (msg.includes('SSH 未连接') || msg.includes('未连接') || msg.includes('NOT_CONNECTED')) {
        setError('SSH 连接已断开，请在连接列表中选择重新连接')
      } else {
        setError(msg)
      }
      retryCountRef.current = 0
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // sessionId 变化时加载
  useEffect(() => {
    if (sessionId) {
      setCurrentPath('/')
      setEntries([])
      setError(null)
      setSftpReady(false)
      retryCountRef.current = 0
      const timer = setTimeout(() => listDir('/', true), 300)
      return () => clearTimeout(timer)
    } else {
      setEntries([])
      setCurrentPath('/')
      setSftpReady(false)
    }
  }, [sessionId])

  // sftp-ready 后自动刷新
  useEffect(() => {
    if (sftpReady && sessionId) {
      retryCountRef.current = 0
      listDir(currentPath, false)
    }
  }, [sftpReady])

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

  // ─── 操作处理 ───

  const handleDelete = async (entry: SftpEntry) => {
    if (!sessionId) return
    if (!confirm(`确定删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？`)) return
    try {
      await wsRef.current.request({
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

  const handleRename = async (entry: SftpEntry, newName: string) => {
    if (!sessionId || !newName.trim()) return
    const parentPath = entry.path.includes('/')
      ? entry.path.substring(0, entry.path.lastIndexOf('/'))
      : ''
    const newPath = parentPath ? `${parentPath}/${newName}` : newName
    try {
      await wsRef.current.request({
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

  const handleCreate = async (type: 'file' | 'directory') => {
    if (!sessionId || !createName.trim()) return
    const fullPath = currentPath === '/' ? `/${createName}` : `${currentPath}/${createName}`
    // 重试最多3次，应对 SFTP_NOT_READY
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const req: Record<string, unknown> = {
          type: 'sftp',
          connectionId: sessionId,
          operation: type === 'directory' ? 'mkdir' : 'writefile',
          path: fullPath,
        }
        if (type === 'file') req.content = btoa('')
        await wsRef.current.request(req, 10000)
        setCreatingFile(false)
        setCreatingDir(false)
        setCreateName('')
        refresh()
        return
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('SFTP_NOT_READY') && attempt < 2) {
          // SFTP 未就绪，等待500ms重试
          console.log(`[SftpBrowser] SFTP not ready, retrying create (${attempt + 1}/3)...`)
          await new Promise(r => setTimeout(r, 500))
          continue
        }
        alert('创建失败: ' + msg)
        return
      }
    }
  }

  const openForView = (entry: SftpEntry) => {
    if (entry.type === 'directory') return
    setPreviewEntry(entry)
  }

  /** 在 CodeMirror 编辑器中打开 */
  const openInEditor = async (entry: SftpEntry) => {
    if (!sessionId || entry.type === 'directory') return
    const tabId = `sftp_${sessionId}_${entry.path}`
    const lang = detectLanguage(entry.name)

    // 先尝试读取文件内容
    try {
      const resp = await wsRef.current.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'readfile',
        path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        const content = atob(resp.data as string)
        fileStore.openFile({
          id: tabId,
          name: entry.name,
          path: entry.path,
          source: 'sftp',
          language: lang,
          content,
          originalContent: content,
          isDirty: false,
          sessionId,
        })
      }
    } catch (err) {
      alert('打开失败: ' + (err as Error).message)
    }
  }

  /** 双击文件处理 */
  const handleFileDoubleClick = (entry: SftpEntry) => {
    if (entry.type === 'directory') { navigateTo(entry.path); return }
    if (onFileDoubleClick) {
      onFileDoubleClick(entry)
    } else {
      openInEditor(entry)
    }
  }

  const handleDownload = async (entry: SftpEntry) => {
    if (!sessionId || entry.type === 'directory') return
    try {
      const resp = await wsRef.current.request({
        type: 'sftp', connectionId: sessionId, operation: 'readfile', path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        // 用 data URL 替代 blob URL，避免 CSP 阻止
        const bytes = Uint8Array.from(atob(resp.data as string), c => c.charCodeAt(0))
        const dataUrl = `data:application/octet-stream;base64,${resp.data}`
        const a = document.createElement('a')
        a.href = dataUrl; a.download = entry.name; a.click()
      }
    } catch (err) {
      alert('下载失败: ' + (err as Error).message)
    }
    setContextMenu(null)
  }

  // ─── 右键事件 ───

  const handleEntryContextMenu = (e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault(); e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    if (e.type !== 'contextmenu') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry: null })
  }

  const pathParts = currentPath.split('/').filter(Boolean)
  const { dirs, files } = sortEntries(entries)

  return (
    <div className={`flex h-full flex-col bg-slate-950 ${widthClass || ''}`}>
      {/* 可选的连接选择器 */}
      {showConnector && (
        <div className="flex items-center gap-1 border-b border-slate-700/50 px-2 py-1.5">
          <Server size={14} className="shrink-0 text-slate-500" />
          <select
            value={activeConnId || ''}
            onChange={(e) => e.target.value && onConnect?.(e.target.value)}
            className="flex-1 truncate rounded bg-transparent px-1 py-0.5 text-xs text-slate-400 outline-none hover:text-slate-300"
          >
            <option value="">选择 SSH 连接...</option>
            {connectionOptions?.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.host})</option>
            ))}
          </select>
          {externalConnecting && (
            <Loader2 size={12} className="animate-spin text-amber-400" />
          )}
        </div>
      )}

      {/* 工具栏 */}
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

      {/* 新建输入框 */}
      {(creatingFile || creatingDir) && (
        <div className="flex items-center gap-1 border-b border-slate-700/30 px-2 py-1.5">
          {creatingFile
            ? <FilePlus size={14} className="text-sky-400 shrink-0" />
            : <FolderPlus size={14} className="text-amber-400 shrink-0" />}
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
      <div
        className="flex-1 overflow-y-auto"
        onContextMenu={handleEmptyContextMenu}
      >
        {/* 目录 */}
        {dirs.map((dir) => (
          <div key={dir.path}>
            <div
              className="group flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-slate-800/50"
              onClick={() => navigateTo(dir.path)}
              onContextMenu={(e) => handleEntryContextMenu(e, dir)}
            >
              <Folder size={14} className="shrink-0 text-amber-400" />
              <span className="flex-1 truncate text-slate-300">{dir.name}</span>
              <span className="text-[10px] text-slate-600 opacity-0 group-hover:opacity-100">
                {formatPerms(parseInt(dir.permissions, 8))}
              </span>
            </div>
          </div>
        ))}

        {/* 文件 — 单击查看，双击编辑 */}
        {files.map((file) => (
          <div
            key={file.path}
            className="group flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-800/50"
            onClick={() => openForView(file)}
            onDoubleClick={() => handleFileDoubleClick(file)}
            onContextMenu={(e) => handleEntryContextMenu(e, file)}
          >
            {getFileIcon(file.name)}
            <span className="flex-1 truncate text-slate-300">{file.name}</span>
            <span className="shrink-0 text-[10px] text-slate-600">{formatSize(file.size)}</span>
          </div>
        ))}

        {/* 空状态 */}
        {!loading && entries.length === 0 && (
          <div className="flex flex-col items-center py-8 text-slate-600" onContextMenu={handleEmptyContextMenu}>
            <Folder size={24} />
            <p className="mt-1 text-xs">空目录</p>
            <p className="mt-2 text-[10px] text-slate-600">右键空白处新建文件或文件夹</p>
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="flex items-center justify-between border-t border-slate-700/30 px-2 py-1 text-[10px] text-slate-600">
        <span>{entries.length} 项</span>
        <span className="ml-2 truncate">{currentPath}</span>
      </div>

      {/* ── 右键菜单 ── */}
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
                    onClick={() => { openForView(contextMenu.entry!); setContextMenu(null) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <Eye size={12} /> 查看
                  </button>
                  <button
                    onClick={() => { handleFileDoubleClick(contextMenu.entry!); setContextMenu(null) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <ExternalLink size={12} /> 在编辑器中打开
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
                <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700" disabled>
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
                  const path = contextMenu.entry!.path
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(path).catch(() => fallbackCopy(path))
                  } else {
                    fallbackCopy(path)
                  }
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

      {/* ── 重命名对话框 ── */}
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

      {/* ── 文件预览模态框 ── */}
      {previewEntry && (
        <FilePreviewModal
          entry={previewEntry}
          sessionId={sessionId!}
          onClose={() => setPreviewEntry(null)}
          onSaved={() => refresh()}
          onOpenInEditor={openInEditor}
        />
      )}
    </div>
  )
}
