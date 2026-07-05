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

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import VirtualList from '../../components/VirtualList'
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
  Search,
  ChevronDown,
} from 'lucide-react'
import { useFileStore } from '../../stores/file-store'
import { useAppStore } from '../../stores/app-store'
import { getWsClientSync } from '../../services/websocket'
import { sniffLanguage } from '../../utils/content-sniff'
import { AlertModal, ConfirmModal } from '../../components/ConfirmModal'
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
      return <FileCode size={14} className="text-sky-400" />
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'xml':
      return <FileJson size={14} className="text-amber-400" />
    case 'md':
    case 'txt':
    case 'log':
    case 'cfg':
    case 'conf':
    case 'env':
      return <FileText size={14} className="text-slate-400" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
    case 'webp':
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
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

function formatPerms(mode: number): string {
  const s = mode.toString(8).slice(-3)
  const p = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return s
    .split('')
    .map((c) => p[parseInt(c)] || '---')
    .join('')
}

/** 文件扩展名 → CodeMirror 语言标识映射 */
const LANGUAGE_MAP: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  // Python
  py: 'python',
  pyw: 'python',
  pyx: 'python',
  // Go
  go: 'go',
  // Rust
  rs: 'rust',
  rlib: 'rust',
  // Java
  java: 'java',
  class: 'java',
  jar: 'java',
  // C / C++
  c: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  // CSS / 预处理器
  css: 'css',
  scss: 'scss',
  less: 'less',
  sass: 'scss',
  // HTML / 模板
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'vue',
  // XML
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  // 数据格式
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  csv: 'text',
  tsv: 'text',
  // Markdown / 文档
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  diff: 'text',
  patch: 'text',
  // 数据库
  sql: 'sql',
  pgsql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  // PHP
  php: 'php',
  phtml: 'php',
  php3: 'php',
  php4: 'php',
  php5: 'php',
  php7: 'php',
  php8: 'php',
  // Ruby
  rb: 'ruby',
  rbs: 'ruby',
  gemfile: 'ruby',
  rake: 'ruby',
  // Perl
  pl: 'perl',
  pm: 'perl',
  t: 'perl',
  // Lua
  lua: 'lua',
  // WebAssembly
  wast: 'wast',
  wat: 'wast',
  // Liquid 模板
  liquid: 'liquid',
  // Kubernetes / DevOps
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  env: 'dotenv',
  conf: 'nginx',
  cfg: 'ini',
  ini: 'ini',
  makefile: 'makefile',
  mk: 'makefile',
  terraform: 'hcl',
  tf: 'hcl',
  tfvars: 'hcl',
  // 没有后缀或未知
  '': 'text',
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANGUAGE_MAP[ext] || 'text'
}

/** 兜底的复制方案：当 navigator.clipboard 不可用时使用 */
function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {}
  document.body.removeChild(ta)
}

/** 按名称排序：目录在前，文件在后，字母序 */
function sortEntries(entries: SftpEntry[]) {
  return {
    dirs: entries
      .filter((e) => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: entries
      .filter((e) => e.type !== 'directory')
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

// ─── 文件查看/编辑模态框 ───

function FilePreviewModal({
  entry,
  sessionId,
  onClose,
  onSaved,
  onOpenInEditor,
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
  const wsClient = getWsClientSync()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadFile = useCallback(async () => {
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
  }, [sessionId, entry.path, wsClient])

  useEffect(() => {
    const t = setTimeout(() => loadFile(), 0)
    return () => clearTimeout(t)
  }, [entry.path, loadFile])

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
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
                onClick={() => {
                  onOpenInEditor(entry)
                  onClose()
                }}
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
            <pre className="h-[50vh] w-full overflow-auto p-4 font-mono text-sm break-all whitespace-pre-wrap text-slate-300">
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
                className="btn btn-ghost text-xs text-slate-400 hover:text-slate-300"
              >
                取消编辑
              </button>
            )}
            {saveMsg && (
              <span
                className={`text-xs ${saveMsg.includes('❌') ? 'text-red-400' : 'text-emerald-400'}`}
              >
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

// 分块上传常量
const CHUNK_SIZE = 5 * 1024 * 1024 // 每块 5MB
const CHUNK_THRESHOLD = 50 * 1024 * 1024 // 超过 50MB 才分块

function SftpBrowserInner({
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
    x: number
    y: number
    entry: SftpEntry | null
  } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creatingFile, setCreatingFile] = useState(false)
  const [creatingDir, setCreatingDir] = useState(false)
  const [createName, setCreateName] = useState('')
  const [previewEntry, setPreviewEntry] = useState<SftpEntry | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{
    current: number
    total: number
    name: string
    pct?: number
  } | null>(null)
  const [sftpReady, setSftpReady] = useState(false)
  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [_recursiveSearching, setRecursiveSearching] = useState(false)
  const [_allEntries, setAllEntries] = useState<SftpEntry[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 弹窗提示（替代 alert）
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null)
  // 确认模态框（替代 confirm）
  const [confirmModal, setConfirmModal] = useState<{
    title: string
    message: string
    variant?: 'danger' | 'default'
    confirmText?: string
    onConfirm: () => void
    onCancel: () => void
  } | null>(null)

  const wsClient = getWsClientSync()
  const wsRef = useRef(wsClient)
  useEffect(() => {
    wsRef.current = wsClient
  }, [wsClient])
  const retryCountRef = useRef(0)
  const fileStore = useFileStore()
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const notifyRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)

  // 监听 sftp-ready 事件
  useEffect(() => {
    if (!sessionId) {
      const t = setTimeout(() => setSftpReady(false), 0)
      return () => {
        clearTimeout(t)
      }
    }
    const t = setTimeout(() => setSftpReady(false), 0)
    const unsub = wsClient.on('sftp-ready', (data) => {
      if (data.connectionId === sessionId) setSftpReady(true)
    })
    return () => {
      clearTimeout(t)
      unsub()
    }
  }, [sessionId, wsClient])

  // 读取目录
  const listDir = useCallback(
    async function listDir(dirPath: string, retryOnNotReady = true) {
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
    },
    [sessionId],
  )

  // sessionId 变化时加载
  useEffect(() => {
    if (sessionId) {
      const t1 = setTimeout(() => {
        setCurrentPath('/')
        setEntries([])
        setError(null)
        setSftpReady(false)
      }, 0)
      retryCountRef.current = 0
      const t2 = setTimeout(() => listDir('/', true), 300)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
    const t3 = setTimeout(() => {
      setEntries([])
      setCurrentPath('/')
      setSftpReady(false)
    }, 0)
    return () => clearTimeout(t3)
  }, [sessionId, listDir])

  // sftp-ready 后自动刷新（故意限制 deps：只应在 sftpReady 翻转时触发）
  useEffect(() => {
    if (sftpReady && sessionId) {
      retryCountRef.current = 0
      const t = setTimeout(() => listDir(currentPath, false), 0)
      return () => clearTimeout(t)
    }
    return undefined
  }, [sftpReady]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── 递归搜索 ───

  const recursiveSearch = useCallback(
    async function recursiveSearch(
      dir: string,
      query: string,
      depth: number = 0,
    ): Promise<SftpEntry[]> {
      if (!sessionId) return []
      // 限制最大递归深度为 5 层，防止遍历整个文件系统
      if (depth > 5) return []
      const results: SftpEntry[] = []
      const q = query.toLowerCase()
      try {
        const resp = await wsRef.current.request(
          {
            type: 'sftp',
            connectionId: sessionId,
            operation: 'list',
            path: dir,
          },
          15000,
        )
        if (resp.type === 'sftp-result' && resp.operation === 'list') {
          const items = resp.files as SftpEntry[]
          for (const item of items) {
            if (item.name.toLowerCase().includes(q)) {
              results.push({ ...item, path: dir === '/' ? `/${item.name}` : `${dir}/${item.name}` })
            }
            if (item.type === 'directory') {
              const subDir = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`
              const sub = await recursiveSearch(subDir, q, depth + 1)
              results.push(...sub)
            }
          }
        }
      } catch {
        // 无权限目录就跳过
      }
      return results
    },
    [sessionId],
  )

  const doRecursiveSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || !sessionId) return
      setRecursiveSearching(true)
      setAllEntries([])
      try {
        const results = await recursiveSearch(currentPath, query.trim())
        setAllEntries(results)
        setShowSearch(false)
        setSearchQuery('')
      } catch (err) {
        setAlertModal({ title: '搜索失败', message: (err as Error).message })
      } finally {
        setRecursiveSearching(false)
      }
    },
    [sessionId, currentPath, recursiveSearch],
  )

  // ─── 操作处理 ───

  const handleDelete = async (entry: SftpEntry) => {
    if (!sessionId) return
    // 先用确认模态框
    setConfirmModal({
      title: '确认删除',
      message: `确定删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？`,
      variant: 'danger',
      confirmText: '删除',
      onConfirm: async () => {
        setConfirmModal(null)
        try {
          await wsRef.current.request({
            type: 'sftp',
            connectionId: sessionId,
            operation: entry.type === 'directory' ? 'rmdir' : 'unlink',
            path: entry.path,
          })
          refresh()
        } catch (err) {
          setAlertModal({ title: '删除失败', message: (err as Error).message })
        }
        setContextMenu(null)
      },
      onCancel: () => {
        setConfirmModal(null)
        setContextMenu(null)
      },
    })
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
      setAlertModal({ title: '重命名失败', message: (err as Error).message })
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
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        setAlertModal({ title: '创建失败', message: msg })
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
    const ext = entry.name.split('.').pop()?.toLowerCase() || ''
    const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']

    // 图片文件 → 用 base64 data URL 显示
    if (IMAGE_EXTS.includes(ext)) {
      try {
        const resp = await wsRef.current.request({
          type: 'sftp',
          connectionId: sessionId,
          operation: 'readfile',
          path: entry.path,
        })
        if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
          const mime: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            svg: 'image/svg+xml',
            webp: 'image/webp',
            ico: 'image/x-icon',
            bmp: 'image/bmp',
          }
          fileStore.openFile({
            id: tabId,
            name: entry.name,
            path: entry.path,
            source: 'sftp',
            language: 'image',
            content: `data:${mime[ext] || 'image/png'};base64,${resp.data}`,
            originalContent: resp.data as string,
            isDirty: false,
            sessionId,
          })
          setActiveNav('files')
        }
      } catch (err) {
        setAlertModal({ title: '打开失败', message: (err as Error).message })
      }
      return
    }

    let lang = detectLanguage(entry.name)

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
        // 扩展名未识别时，用内容嗅探提升准确度
        if (lang === 'text' && content) {
          const sniffed = sniffLanguage(entry.name, content)
          lang = sniffed.language
        }
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
        // 切换到文件管理页面以显示编辑器
        setActiveNav('files')
      }
    } catch (err) {
      setAlertModal({ title: '打开失败', message: (err as Error).message })
    }
  }

  /** 双击文件处理 */
  const handleFileDoubleClick = (entry: SftpEntry) => {
    if (entry.type === 'directory') {
      navigateTo(entry.path)
      return
    }
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
        type: 'sftp',
        connectionId: sessionId,
        operation: 'readfile',
        path: entry.path,
      })
      if (resp.type === 'sftp-result' && resp.operation === 'readfile') {
        // 用 data URL 替代 blob URL，避免 CSP 阻止
        const dataUrl = `data:application/octet-stream;base64,${resp.data}`
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = entry.name
        a.click()
      }
    } catch (err) {
      setAlertModal({ title: '下载失败', message: (err as Error).message })
    }
    setContextMenu(null)
  }

  // ─── 右键事件 ───

  const handleEntryContextMenu = (e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    if (e.type !== 'contextmenu') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry: null })
  }

  // ─── 拖拽上传 ───

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        const comma = result.indexOf(',')
        resolve(comma > -1 ? result.slice(comma + 1) : result)
      }
      reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
      reader.readAsDataURL(file)
    })
  }

  const uploadSmallFile = useCallback(
    async (file: File, targetDir: string) => {
      const data = await readFileAsBase64(file)
      const remotePath = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'writefile',
        path: remotePath,
        content: data,
      })
    },
    [sessionId, wsClient],
  )

  const uploadLargeFile = useCallback(
    async (file: File, targetDir: string, onChunkProgress?: (pct: number) => void) => {
      const remotePath = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`

      // 1. chunk_start
      const startResult = await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'chunk_start',
        path: remotePath,
      })
      if (!startResult.success)
        throw new Error((startResult.error as string) || '分块上传初始化失败')
      const { chunkId } = startResult

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      let offset = 0
      const fileReader = new FileReader()

      for (let i = 0; i < totalChunks; i++) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE)
        const b64 = await new Promise<string>((resolve, reject) => {
          fileReader.onload = () => {
            const result = fileReader.result as string
            const comma = result.indexOf(',')
            resolve(comma > -1 ? result.slice(comma + 1) : result)
          }
          fileReader.onerror = () => reject(new Error(`读取分块 ${i + 1}/${totalChunks} 失败`))
          fileReader.readAsDataURL(chunk)
        })

        await wsClient.request({
          type: 'sftp',
          connectionId: sessionId,
          operation: 'chunk_append',
          chunkId,
          content: b64,
        })

        offset += CHUNK_SIZE
        onChunkProgress?.(Math.round(((i + 1) / totalChunks) * 100))
      }

      // 3. chunk_finish
      await wsClient.request({
        type: 'sftp',
        connectionId: sessionId,
        operation: 'chunk_finish',
        chunkId,
        targetPath: remotePath,
      })
    },
    [sessionId, wsClient],
  )

  const uploadFile = useCallback(
    async (file: File, targetDir: string, onChunkProgress?: (pct: number) => void) => {
      if (file.size >= CHUNK_THRESHOLD) {
        await uploadLargeFile(file, targetDir, onChunkProgress)
      } else {
        await uploadSmallFile(file, targetDir)
        onChunkProgress?.(100)
      }
    },
    [uploadSmallFile, uploadLargeFile],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setDragOver(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const doUpload = useCallback(
    async (files: File[], targetDir: string) => {
      const firstFile = files[0]
      if (!firstFile) return

      // 单文件且 >= 50MB -> 分块进度模式
      if (files.length === 1 && firstFile.size >= CHUNK_THRESHOLD) {
        const file = firstFile
        setUploadProgress({ current: 0, total: 100, name: file.name, pct: 0 })
        try {
          await uploadFile(file, targetDir, (pct: number) => {
            setUploadProgress({ current: pct, total: 100, name: file.name, pct })
          })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : '上传失败'
          setUploadProgress(null)
          setAlertModal({ title: '上传失败', message: msg })
          return
        }
        setUploadProgress(null)
        listDir(currentPath)
        setAlertModal({
          title: '上传完成',
          message: `成功上传 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) 到 ${targetDir}`,
        })
        return
      }

      // 普通进度：文件列表
      setUploadProgress({ current: 0, total: files.length, name: firstFile.name })
      let successCount = 0
      let errorCount = 0
      const errors: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!
        setUploadProgress({ current: i + 1, total: files.length, name: file.name })
        try {
          await uploadFile(file, targetDir)
          successCount++
        } catch (err: unknown) {
          errorCount++
          const msg = err instanceof Error ? err.message : '未知错误'
          errors.push(msg)
        }
      }
      setUploadProgress(null)
      listDir(currentPath)
      const title = errorCount === 0 ? '上传完成' : '上传完成（有错误）'
      const msg =
        errorCount === 0
          ? `成功上传 ${successCount} 个文件到 ${targetDir}`
          : `成功 ${successCount}，失败 ${errorCount}
${errors.slice(0, 3).join('\n')}${errors.length > 3 ? `\n...还有 ${errors.length - 3} 个错误` : ''}`
      setAlertModal({ title, message: msg })
    },
    [uploadFile, listDir, currentPath],
  )

  // 检查是否有同名文件，弹出确认
  const confirmOverwrite = useCallback(
    (files: File[], _targetDir: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const existingNames = new Set(entries.map((e) => e.name))
        const conflicts = files.filter((f) => existingNames.has(f.name))
        if (conflicts.length === 0) {
          resolve(true)
          return
        }
        const names = conflicts
          .map((f) => f.name)
          .slice(0, 5)
          .join(', ')
        const suffix = conflicts.length > 5 ? ` 等 ${conflicts.length} 个文件` : ''
        setConfirmModal({
          title: '文件已存在',
          message: `目标目录中已存在同名文件：${names}${suffix}。是否覆盖？`,
          confirmText: '覆盖',
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
    },
    [entries, setConfirmModal],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOver(false)
      dragCounterRef.current = 0
      const files = Array.from(e.dataTransfer.files)
      if (files.length === 0) return
      if (!sessionId) {
        setAlertModal({ title: '无法上传', message: '请先连接到 SSH 服务器' })
        return
      }
      const confirmed = await confirmOverwrite(files, currentPath)
      if (confirmed) doUpload(files, currentPath)
    },
    [sessionId, currentPath, doUpload, confirmOverwrite],
  )

  const handleUploadToDir = useCallback(
    async (targetDir: string) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = true
      input.onchange = async () => {
        const files = input.files
        if (!files || files.length === 0) return
        if (!sessionId) {
          setAlertModal({ title: '无法上传', message: '请先连接到 SSH 服务器' })
          return
        }
        const confirmed = await confirmOverwrite(Array.from(files), targetDir)
        if (confirmed) doUpload(Array.from(files), targetDir)
      }
      input.click()
    },
    [sessionId, doUpload, confirmOverwrite],
  )

  const pathParts = currentPath.split('/').filter(Boolean)
  const { dirs, files } = useMemo(() => sortEntries(entries), [entries])
  // 合并为扁平列表用于虚拟滚动
  const flatEntries = useMemo(() => {
    if (entries.length === 0) return []
    const dirItems = dirs.map((d) => ({ ...d, _isDir: true as const }))
    const fileItems = files.map((f) => ({ ...f, _isDir: false as const }))
    return [...dirItems, ...fileItems]
  }, [dirs, files, entries.length])

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
              <option key={c.id} value={c.id}>
                {c.name} ({c.host})
              </option>
            ))}
          </select>
          {externalConnecting && <Loader2 size={12} className="animate-spin text-amber-400" />}
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 border-b border-slate-700/30 px-2 py-1">
        <button
          onClick={goHome}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="根目录"
        >
          <Home size={14} />
        </button>
        <button
          onClick={goUp}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="上级目录"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={refresh}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="mx-1 h-4 w-px bg-slate-700/50" />
        <button
          onClick={() => {
            setCreatingFile(true)
            setCreatingDir(false)
            setCreateName('')
          }}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="新建文件"
        >
          <FilePlus size={14} />
        </button>
        <button
          onClick={() => {
            setCreatingDir(true)
            setCreatingFile(false)
            setCreateName('')
          }}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="新建文件夹"
        >
          <FolderPlus size={14} />
        </button>
        <div className="mx-1 h-4 w-px bg-slate-700/50" />
        <button
          onClick={() => handleUploadToDir(currentPath)}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="上传文件"
        >
          <Upload size={14} />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            setShowSearch((s) => !s)
            if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50)
          }}
          className={`btn-icon ${showSearch ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
          title="搜索文件"
        >
          <Search size={14} />
        </button>
      </div>

      {/* 搜索栏 */}
      {showSearch && (
        <div className="flex items-center gap-1 border-b border-slate-700/30 px-2 py-1">
          <Search size={13} className="shrink-0 text-slate-500" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.ctrlKey || e.metaKey) {
                  doRecursiveSearch(searchQuery)
                } else {
                  // Enter → 本地过滤
                }
              }
              if (e.key === 'Escape') {
                setShowSearch(false)
                setSearchQuery('')
              }
            }}
            placeholder={`在当前目录搜索... (Ctrl+Enter 递归搜索)`}
            className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none placeholder:text-slate-600"
            autoFocus
          />
          <button
            onClick={() => doRecursiveSearch(searchQuery)}
            disabled={!searchQuery.trim() || !sessionId}
            className="btn-ghost flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 disabled:opacity-40"
            title="递归搜索子目录（Ctrl+Enter）"
          >
            <ChevronDown size={11} />
            递归
          </button>
          <button
            onClick={() => {
              setShowSearch(false)
              setSearchQuery('')
            }}
            className="btn-icon text-slate-500 hover:text-slate-300"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 面包屑 */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-700/30 px-2 py-1 text-xs">
        <button
          onClick={goHome}
          className="shrink-0 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
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
          {creatingFile ? (
            <FilePlus size={14} className="shrink-0 text-sky-400" />
          ) : (
            <FolderPlus size={14} className="shrink-0 text-amber-400" />
          )}
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate(creatingFile ? 'file' : 'directory')
              if (e.key === 'Escape') {
                setCreatingFile(false)
                setCreatingDir(false)
              }
            }}
            placeholder={creatingFile ? '文件名' : '文件夹名'}
            className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none"
          />
          <button
            onClick={() => handleCreate(creatingFile ? 'file' : 'directory')}
            className="btn-icon text-emerald-400 hover:text-emerald-300"
          >
            <Check size={14} />
          </button>
          <button
            onClick={() => {
              setCreatingFile(false)
              setCreatingDir(false)
            }}
            className="btn-icon text-slate-500 hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div
          ref={notifyRef}
          className="mx-2 mt-1 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400"
        >
          {error}
        </div>
      )}

      {/* 上传进度条 */}
      {uploadProgress && (
        <div className="mx-2 mt-1 flex items-center gap-2 rounded bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">
          <Loader2 size={12} className="shrink-0 animate-spin" />
          <span className="flex-1 truncate">
            上传 {uploadProgress.current}/{uploadProgress.total}: {uploadProgress.name}
          </span>
          <span className="shrink-0 text-blue-400">
            {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%
          </span>
        </div>
      )}

      {/* 拖拽悬浮遮罩 */}
      {dragOver && sftpReady && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center"
          style={{ pointerEvents: 'none' }}
        >
          <div className="rounded-xl border-2 border-dashed border-blue-500/40 bg-blue-500/5 px-8 py-6 text-center">
            <Upload size={32} className="mx-auto text-blue-400" />
            <p className="mt-2 text-sm font-medium text-blue-300">拖拽上传到当前目录</p>
            <p className="mt-1 text-xs text-blue-400/60">{currentPath}</p>
          </div>
        </div>
      )}

      {/* 文件列表 */}
      <div
        className="mobile-scroll relative flex-1"
        onContextMenu={handleEmptyContextMenu}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {!loading && entries.length === 0 ? (
          <div
            className="flex flex-col items-center pt-8 text-slate-600"
            onContextMenu={handleEmptyContextMenu}
          >
            <Folder size={24} />
            <p className="mt-1 text-xs">空目录</p>
            <p className="mt-2 text-[10px] text-slate-600">右键空白处新建文件或文件夹</p>
          </div>
        ) : (
          <VirtualList
            items={flatEntries}
            itemHeight={24}
            className="h-full"
            virtualizeThreshold={100}
            getKey={(item) => item.path}
            paddingBottom={0}
            renderItem={(item) =>
              item._isDir ? (
                <div
                  className="group flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-slate-800/50"
                  onClick={() => navigateTo(item.path)}
                  onContextMenu={(e) => handleEntryContextMenu(e, item)}
                >
                  <Folder size={14} className="shrink-0 text-amber-400" />
                  <span className="flex-1 truncate text-slate-300">{item.name}</span>
                  <span className="text-[10px] text-slate-600 opacity-0 group-hover:opacity-100">
                    {formatPerms(parseInt(item.permissions, 8))}
                  </span>
                </div>
              ) : (
                <div
                  className="group flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-800/50"
                  onClick={() => openForView(item)}
                  onDoubleClick={() => handleFileDoubleClick(item)}
                  onContextMenu={(e) => handleEntryContextMenu(e, item)}
                >
                  {getFileIcon(item.name)}
                  <span className="flex-1 truncate text-slate-300">{item.name}</span>
                  <span className="shrink-0 text-[10px] text-slate-600">
                    {formatSize(item.size)}
                  </span>
                </div>
              )
            }
          />
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
                    onClick={() => {
                      openForView(contextMenu.entry!)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <Eye size={12} /> 查看
                  </button>
                  <button
                    onClick={() => {
                      handleFileDoubleClick(contextMenu.entry!)
                      setContextMenu(null)
                    }}
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
                <button
                  onClick={() => {
                    handleUploadToDir(contextMenu.entry!.path)
                    setContextMenu(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Upload size={12} /> 上传到此
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
                onClick={() => {
                  setCreatingFile(true)
                  setCreatingDir(false)
                  setCreateName('')
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <FilePlus size={12} /> 新建文件
              </button>
              <button
                onClick={() => {
                  setCreatingDir(true)
                  setCreatingFile(false)
                  setCreateName('')
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <FolderPlus size={12} /> 新建文件夹
              </button>
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  refresh()
                  setContextMenu(null)
                }}
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
                  const entry = entries.find((en) => en.path === renaming)
                  if (entry) handleRename(entry, renameValue)
                }
                if (e.key === 'Escape') setRenaming(null)
              }}
              className="input min-w-[200px]"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button onClick={() => setRenaming(null)} className="btn btn-ghost text-xs">
                取消
              </button>
              <button
                onClick={() => {
                  const entry = entries.find((en) => en.path === renaming)
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

      {/* ── Alert 弹窗 ── */}
      <AlertModal
        open={!!alertModal}
        title={alertModal?.title || ''}
        message={alertModal?.message || ''}
        onClose={() => setAlertModal(null)}
      />

      {/* ── Confirm 弹窗 ── */}
      {confirmModal && (
        <ConfirmModal
          open={!!confirmModal}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText={confirmModal.confirmText}
          cancelText="取消"
          variant={confirmModal.variant || 'default'}
          onConfirm={confirmModal.onConfirm}
          onCancel={confirmModal.onCancel}
        />
      )}
    </div>
  )
}

export default memo(SftpBrowserInner)
