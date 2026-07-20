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
 * - 通过 REST API（/api/sftp/*）执行所有 SFTP 操作，避免 WebSocket I/O 冲突
 */

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import {
  Folder,
  File,
  Music,
  ArrowUp,
  Home,
  RefreshCw,
  Upload,
  Trash2,
  Edit3,
  Copy,
  FilePlus,
  FolderPlus,
  Server,
  X,
  Check,
  CheckSquare,
  Loader2,
  Save,
  ExternalLink,
  Search,
} from 'lucide-react'
import { useFileStore } from '../../stores/file-store'
import { useAppStore } from '../../stores/app-store'
import { sniffLanguage, classifyFile } from '../../utils/content-sniff'
import { AlertModal, ConfirmModal } from '../../components/ConfirmModal'
import type { SftpEntry } from '../../types/ssh'
import { SftpContextMenu, FileInfoModal, DiskUsageModal, HashModal, ChmodModal, MoveModal } from './sftp-components'

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
  /** 宽度类名 */
  widthClass?: string
  /** 初始浏览路径（用于从持久化状态恢复） */
  initialPath?: string
  /** 路径变化回调（用于持久化当前浏览路径） */
  onPathChange?: (path: string) => void
}

// --- Base64 / Text encoding helpers (UTF-8 safe) ---

/** base64 -> string (correctly handles multibyte UTF-8 chars like CJK) */

// ─── Extracted utility functions ───
import {
  b64ToText, textToB64, inferMimeFromBase64,
  getMimeByName,
  getFileIcon,
  formatSize, formatPerms,
  detectLanguage, fallbackCopy, isDirLike, sortEntriesBy,
  isImageFile, isVideoFile, isAudioFile, isBinaryFile,
  isBinaryContent,
  sftpApi,
  type SortKey, type SortDir,
} from './sftp-utils'

// ─── 文件查看/编辑模态框 ───

const FilePreviewModal = memo(function FilePreviewModal({
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
  const [openingInEditor, setOpeningInEditor] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [binaryUrl, setBinaryUrl] = useState<string | null>(null)
  const [isImage, setIsImage] = useState(false)
  const [isVideo, setIsVideo] = useState(false)
  const [isAudio, setIsAudio] = useState(false)

  const loadFile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 无法预览目录或目录符号链接
      if (isDirLike(entry)) {
        setError('无法预览目录')
        setLoading(false)
        return
      }
      // Determine effective name for type detection (use linkTarget for symlinks)
      const effectiveName =
        entry.type === 'symlink' && entry.linkTarget
          ? entry.linkTarget.split('/').pop() || entry.name
          : entry.name

      // 第一步：扩展名检测（高置信度）
      const extByName = isImageFile(effectiveName)
        ? 'image'
        : isVideoFile(effectiveName)
          ? 'video'
          : isAudioFile(effectiveName)
            ? 'audio'
            : null

      // 如果扩展名未识别，但文件较小，先下载再嗅探
      // 如果已识别为媒体，也直接下载
      if (!extByName && entry.size > 50 * 1024 * 1024) {
        setError(`文件过大 (${formatSize(entry.size)})，无法预览。请下载后查看或在编辑器中打开。`)
        setLoading(false)
        return
      }

      const b64 = await sftpApi<string>('download', {
        connectionId: sessionId,
        path: entry.path,
      })

      // 第二步：如果扩展名没识别出来，用内容嗅探兜底
      // 这解决了 .face.icon、无扩展名图片、扩展名被改错的媒体文件等问题
      if (!extByName) {
        const ext = effectiveName.split('.').pop()?.toLowerCase() || ''
        // 先尝试 base64 解码为文本，看是否为 SVG
        const decoded = b64ToText(b64)
        const classification = classifyFile(effectiveName, ext, decoded, false)

        if (classification.category === 'svg') {
          // SVG 是文本格式，用 img 标签渲染
          setIsImage(true)
          setBinaryUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(decoded)}`)
          setLoading(false)
          return
        }
        if (classification.category === 'image') {
          // 通过 magic bytes 检测到的图片，尝试从 base64 推断 MIME
          const mimeFromBytes = inferMimeFromBase64(b64)
          setIsImage(true)
          setBinaryUrl(`data:${mimeFromBytes};base64,${b64}`)
          setLoading(false)
          return
        }
        if (classification.category === 'video') {
          const mimeFromBytes = inferMimeFromBase64(b64)
          setIsVideo(true)
          setBinaryUrl(`data:${mimeFromBytes};base64,${b64}`)
          setLoading(false)
          return
        }
        if (classification.category === 'audio') {
          const mimeFromBytes = inferMimeFromBase64(b64)
          setIsAudio(true)
          setBinaryUrl(`data:${mimeFromBytes};base64,${b64}`)
          setLoading(false)
          return
        }

        // 不是媒体，作为文本显示
        setContent(decoded)
        setOriginalContent(decoded)
        setLoading(false)
        return
      }

      // 第三步：扩展名已识别为媒体
      const mime = getMimeByName(effectiveName)
      if (extByName === 'image') {
        setIsImage(true)
        // SVG 文件特殊处理：data URI 用 UTF-8 编码而非 base64
        const lowerName = effectiveName.toLowerCase()
        if (lowerName.endsWith('.svg') || lowerName.endsWith('.svgz')) {
          const decoded = b64ToText(b64)
          setBinaryUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(decoded)}`)
        } else {
          setBinaryUrl(`data:${mime};base64,${b64}`)
        }
      } else if (extByName === 'video') {
        setIsVideo(true)
        setBinaryUrl(`data:${mime};base64,${b64}`)
      } else if (extByName === 'audio') {
        setIsAudio(true)
        setBinaryUrl(`data:${mime};base64,${b64}`)
      }
    } catch (err) {
      setError('读取失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, entry])

  useEffect(() => {
    const t = setTimeout(() => loadFile(), 0)
    return () => clearTimeout(t)
  }, [entry.path, loadFile])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const encoded = textToB64(content)
      await sftpApi('upload', {
        connectionId: sessionId,
        path: entry.path,
        data: encoded,
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
  }, [content, sessionId, entry.path, onSaved])

  const isDirty = content !== originalContent

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
          <Loader2 size={20} className="animate-spin text-sky-400" />
          <p className="mt-2 text-xs text-slate-400">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <div
        className="flex max-h-[85vh] w-[95vw] max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl sm:w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/50 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 shrink items-center gap-2 overflow-hidden text-sm text-slate-300">
            <span className="shrink-0">{getFileIcon(entry.name, entry.type, entry.targetType)}</span>
            <span className="min-w-0 truncate font-medium">{entry.name}</span>
            <span className="shrink-0 whitespace-nowrap text-[10px] text-slate-500">{formatSize(entry.size)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {error && <span className="max-w-[100px] truncate text-[10px] text-red-400" title={error}>{error}</span>}
            {saveMsg && <span className="text-[10px] text-emerald-400">{saveMsg}</span>}
            {!isImage && !isVideo && !isAudio && !editMode && content && (
              <button
                onClick={() => setEditMode(true)}
                className="btn-icon text-slate-500 hover:text-slate-300"
                title="编辑"
              >
                <Edit3 size={14} />
              </button>
            )}
            {onOpenInEditor && !isImage && !isVideo && !isAudio && (
              <button
                onClick={async () => {
                  if (openingInEditor) return
                  setOpeningInEditor(true)
                  try {
                    await onOpenInEditor(entry)
                    onClose()
                  } catch {
                    // openInEditor 内部已弹 alert，此处静默
                  } finally {
                    setOpeningInEditor(false)
                  }
                }}
                disabled={openingInEditor}
                className="btn-icon text-slate-500 hover:text-slate-300 disabled:opacity-50"
                title="在编辑器中打开"
              >
                {openingInEditor ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <ExternalLink size={14} />
                )}
              </button>
            )}
            <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
              <X size={14} />
            </button>
          </div>
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-3 sm:p-4">
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : isImage && binaryUrl ? (
            <div className="flex items-center justify-center">
              <img
                src={binaryUrl}
                alt={entry.name}
                className="max-h-[60vh] max-w-full rounded object-contain"
              />
            </div>
          ) : isVideo && binaryUrl ? (
            <div className="flex items-center justify-center">
              <video src={binaryUrl} controls className="max-h-[60vh] max-w-full rounded">
                您的浏览器不支持视频播放
              </video>
            </div>
          ) : isAudio && binaryUrl ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Music size={48} className="mb-4 text-slate-600" />
              <audio src={binaryUrl} controls className="w-full max-w-md" />
            </div>
          ) : editMode ? (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="h-full min-h-[400px] w-full resize-none rounded bg-slate-800 p-3 font-mono text-xs text-slate-200 outline-none"
              spellCheck={false}
            />
          ) : (
            <pre className="font-mono text-xs break-all whitespace-pre-wrap text-slate-300">
              {content}
            </pre>
          )}
        </div>
        {/* 底部操作栏 */}
        {!isImage && !isVideo && !isAudio && (
          <div className="flex items-center justify-between border-t border-slate-700/50 px-4 py-2">
            <div className="flex items-center gap-2">
              {!editMode && content && (
                <span className="hidden shrink-0 text-[10px] text-slate-600 sm:inline">
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
        )}
      </div>
    </div>
  )
})

// ─── 主组件 ───

// 上传限制
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024 // 200MB base64 传输上限（浏览器内存限制）

function SftpBrowserInner({
  sessionId,
  activeConnId: _activeConnId,
  connectionOptions,
  onConnect,
  connecting: externalConnecting,
  showConnector = false,
  widthClass,
  initialPath,
  onPathChange,
}: SftpBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
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
  // 搜索
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [recursiveSearching, setRecursiveSearching] = useState(false)
  const [allEntries, setAllEntries] = useState<SftpEntry[]>([])
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

  // ── 多选 ──
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  // ── 排序 ──
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  // ── 剪贴板（复制/剪切） ──
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'copy' | 'cut' } | null>(null)
  // ── 磁盘使用弹窗 ──
  const [diskUsageEntry, setDiskUsageEntry] = useState<SftpEntry | null>(null)
  const [diskUsageData, setDiskUsageData] = useState<{
    totalSize: number
    fileCount: number
    dirCount: number
    largestFile?: string
    largestSize: number
  } | null>(null)
  // ── 文件哈希弹窗 ──
  const [hashEntry, setHashEntry] = useState<SftpEntry | null>(null)
  const [hashData, setHashData] = useState<{
    md5: string
    sha1: string
    sha256: string
  } | null>(null)
  // ── 权限编辑弹窗 ──
  const [chmodEntry, setChmodEntry] = useState<SftpEntry | null>(null)
  const [chmodValue, setChmodValue] = useState('')
  // ── 移动弹窗 ──
  const [moveEntry, setMoveEntry] = useState<SftpEntry | null>(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [moveBusy, setMoveBusy] = useState(false)

  const retryCountRef = useRef(0)
  const fileStore = useFileStore()
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const notifyRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 检测是否为触摸设备（移动端禁用拖拽上传）
  const isTouchDevice = useMemo(() => {
    if (typeof window === 'undefined') return false
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }, [])

  // 读取目录（REST API）
  const listDir = useCallback(
    async function listDir(dirPath: string, retryOnNotReady = true) {
      if (!sessionId) return
      setLoading(true)
      setError(null)
      try {
        const files = await sftpApi<SftpEntry[]>('list', {
          connectionId: sessionId,
          path: dirPath,
        })
        setCurrentPath(dirPath)
        setEntries(files)
        retryCountRef.current = 0
      } catch (err) {
        const msg = (err as Error).message
        if (
          (msg.includes('SFTP_NOT_READY') || msg.includes('not ready')) &&
          retryOnNotReady &&
          retryCountRef.current < 5
        ) {
          retryCountRef.current++
          setTimeout(() => listDir(dirPath, true), 1000)
          return
        }
        // 如果连接已断开，在文件列表区显示提示
        if (
          msg.includes('SSH 未连接') ||
          msg.includes('未连接') ||
          msg.includes('NOT_CONNECTED') ||
          msg.includes('SSH not connected')
        ) {
          setError('SSH 连接已断开，请在左侧连接列表重新连接')
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
      const startPath = initialPath || '/'
      const t1 = setTimeout(() => {
        setCurrentPath(startPath)
        setEntries([])
        setError(null)
      }, 0)
      retryCountRef.current = 0
      const t2 = setTimeout(() => listDir(startPath, true), 300)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
    const t3 = setTimeout(() => {
      setEntries([])
      setCurrentPath('/')
    }, 0)
    return () => clearTimeout(t3)
  }, [sessionId, listDir, initialPath])

  // 路径变化时回调（用于持久化当前浏览路径）
  useEffect(() => {
    if (onPathChange && currentPath) {
      onPathChange(currentPath)
    }
  }, [currentPath, onPathChange])

  // 关闭右键菜单（点击外部区域或滚动时）
  useEffect(() => {
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    window.addEventListener('scroll', handler, true)
    return () => {
      window.removeEventListener('click', handler)
      window.removeEventListener('scroll', handler, true)
    }
  }, [])

  const navigateTo = useCallback((p: string) => listDir(p), [listDir])
  const goUp = useCallback(() => {
    const parent = currentPath === '/' ? '/' : currentPath.split('/').slice(0, -1).join('/') || '/'
    listDir(parent)
  }, [currentPath, listDir])
  const goHome = useCallback(() => listDir('/'), [listDir])
  const refresh = useCallback(() => listDir(currentPath), [currentPath, listDir])

  // ─── 递归搜索 ───

  const recursiveSearch = useCallback(
    async function recursiveSearch(
      dir: string,
      query: string,
      depth: number = 0,
      resultCount: { current: number } = { current: 0 },
    ): Promise<SftpEntry[]> {
      if (!sessionId) return []
      // 限制最大递归深度为 5 层，防止遍历整个文件系统
      if (depth > 5) return []
      // 限制最大结果数为 500 条，防止内存暴涨
      if (resultCount.current >= 500) return []
      const results: SftpEntry[] = []
      const q = query.toLowerCase()
      try {
        const items = await sftpApi<SftpEntry[]>(
          'list',
          {
            connectionId: sessionId,
            path: dir,
          },
          15000,
        )
        for (const item of items) {
          if (resultCount.current >= 500) break
          if (item.name.toLowerCase().includes(q)) {
            results.push({
              ...item,
              path: dir === '/' ? `/${item.name}` : `${dir}/${item.name}`,
            })
            resultCount.current++
          }
          if (item.type === 'directory' || item.type === 'symlink') {
            // 符号链接到目录也递归（targetType 在 list 结果中已解析）
            const isDirLink =
              item.type === 'symlink' &&
              (item.targetType === 'directory' || item.targetType === 'unknown')
            if (item.type === 'directory' || isDirLink) {
              const subDir = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`
              const sub = await recursiveSearch(subDir, q, depth + 1, resultCount)
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

  // 受保护的系统目录 — 禁止删除
  const PROTECTED_PATHS = useMemo(() => [
    '/bin', '/sbin', '/usr', '/lib', '/lib64', '/etc', '/var', '/sys',
    '/proc', '/dev', '/boot', '/root', '/run', '/snap', '/opt',
    '/usr/local', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/share',
    '/etc/ssh', '/etc/passwd', '/etc/shadow', '/etc/group',
  ], [])

  const isProtectedPath = useCallback((path: string): boolean => {
    const normalized = path.replace(/\/+$/, '') || '/'
    return PROTECTED_PATHS.some((p) => normalized === p || normalized.startsWith(p + '/'))
  }, [PROTECTED_PATHS])

  // 回收站路径
  const TRASH_DIR = '/tmp/.wrench-trash'

  const moveToTrash = useCallback(async (entryPath: string, entryName: string): Promise<void> => {
    if (!sessionId) return
    // 先确保回收站目录存在
    try {
      await sftpApi('mkdir', { connectionId: sessionId, path: TRASH_DIR })
    } catch {
      // 目录已存在或其他错误，忽略
    }
    // 带时间戳重命名移到回收站
    const ts = Date.now()
    const safeName = entryName.replace(/\//g, '_')
    const trashPath = `${TRASH_DIR}/${ts}_${safeName}`
    await sftpApi('rename', {
      connectionId: sessionId,
      from: entryPath,
      to: trashPath,
    })
  }, [sessionId])

  // 从回收站恢复文件（还原到原始位置）
  const restoreFromTrash = useCallback(async (entry: SftpEntry): Promise<void> => {
    if (!sessionId) return
    // 回收站文件名格式：{timestamp}_{originalName}
    const trashName = entry.name
    const underscoreIdx = trashName.indexOf('_')
    const originalName = underscoreIdx > 0 ? trashName.substring(underscoreIdx + 1) : trashName
    // 恢复到 /tmp/ 下（因为原始位置可能已不存在）
    const restorePath = `/tmp/${originalName}`
    try {
      await sftpApi('rename', {
        connectionId: sessionId,
        from: entry.path,
        to: restorePath,
      })
      refresh()
      setAlertModal({ title: '恢复成功', message: `已将 "${originalName}" 恢复到 /tmp/` })
    } catch (err) {
      setAlertModal({ title: '恢复失败', message: (err as Error).message })
    }
  }, [sessionId, refresh])

  const handleDelete = useCallback(
    (entry: SftpEntry) => {
      if (!sessionId) return

      // 检查是否为受保护路径
      if (isProtectedPath(entry.path)) {
        setAlertModal({
          title: '禁止删除',
          message: `"${entry.name}" 是系统关键目录/文件，禁止删除。`,
        })
        return
      }

      setConfirmModal({
        title: '确认删除',
        message: `确定删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？\n\n将移入回收站（可恢复），而非永久删除。`,
        variant: 'danger',
        confirmText: '移入回收站',
        onConfirm: async () => {
          setConfirmModal(null)
          try {
            await moveToTrash(entry.path, entry.name)
            refresh()
          } catch (err) {
            // 如果移动失败（如文件太大），回退到直接删除
            setConfirmModal({
              title: '回收站失败',
              message: `无法移入回收站（${(err as Error).message}）。\n是否永久删除？`,
              variant: 'danger',
              confirmText: '永久删除',
              onConfirm: async () => {
                setConfirmModal(null)
                try {
                  await sftpApi('delete', {
                    connectionId: sessionId,
                    path: entry.path,
                    recursive: entry.type === 'directory',
                  })
                  refresh()
                } catch (err2) {
                  setAlertModal({ title: '删除失败', message: (err2 as Error).message })
                }
              },
              onCancel: () => setConfirmModal(null),
            })
          }
          setContextMenu(null)
        },
        onCancel: () => {
          setConfirmModal(null)
          setContextMenu(null)
        },
      })
    },
    [sessionId, refresh, isProtectedPath, moveToTrash],
  )

  // ─── 剪贴板操作 ───

  const handleCopy = useCallback((entries: SftpEntry[]) => {
    setClipboard({ paths: entries.map((e) => e.path), mode: 'copy' })
    setContextMenu(null)
  }, [])

  const handleCut = useCallback((entries: SftpEntry[]) => {
    setClipboard({ paths: entries.map((e) => e.path), mode: 'cut' })
    setContextMenu(null)
  }, [])

  const handlePaste = useCallback(async () => {
    if (!sessionId || !clipboard) return
    try {
      if (clipboard.mode === 'cut') {
        // Move each file to current directory
        for (const srcPath of clipboard.paths) {
          const filename = srcPath.split('/').pop() || srcPath
          const destPath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`
          await sftpApi('rename', {
            connectionId: sessionId,
            from: srcPath,
            to: destPath,
          })
        }
        setClipboard(null)
      } else {
        // Copy: download + upload each file（并发最多 3 个）
        const CONCURRENCY = 3
        for (let i = 0; i < clipboard.paths.length; i += CONCURRENCY) {
          const batch = clipboard.paths.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(
            batch.map(async (srcPath) => {
              const filename = srcPath.split('/').pop() || srcPath
              const destPath = currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`
              const data = await sftpApi<string>('download', {
                connectionId: sessionId,
                path: srcPath,
              })
              await sftpApi('upload', {
                connectionId: sessionId,
                path: destPath,
                data,
              })
            }),
          )
          const failed = results.filter((r) => r.status === 'rejected')
          if (failed.length > 0) {
            const msg = (failed[0] as PromiseRejectedResult).reason?.message || '部分文件复制失败'
            setAlertModal({ title: '复制失败', message: msg })
          }
        }
        // Keep clipboard for potential multi-paste
      }
      refresh()
    } catch (err) {
      setAlertModal({ title: clipboard.mode === 'cut' ? '剪切失败' : '粘贴失败', message: (err as Error).message })
    }
  }, [sessionId, clipboard, currentPath, refresh])

  // ─── 排序切换 ───
  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return key
      }
      setSortDir('asc')
      return key
    })
  }, [])

  // ─── 磁盘使用 ───
  const handleDiskUsage = useCallback(async (entry: SftpEntry) => {
    if (!sessionId) return
    setDiskUsageEntry(entry)
    setDiskUsageData(null)
    try {
      const data = await sftpApi<{
        totalSize: number
        fileCount: number
        dirCount: number
        largestFile?: string
        largestSize: number
      }>('disk-usage', { connectionId: sessionId, path: entry.path })
      setDiskUsageData(data)
    } catch (err) {
      setAlertModal({ title: '获取磁盘使用失败', message: (err as Error).message })
      setDiskUsageEntry(null)
    }
  }, [sessionId])

  // ─── 文件哈希 ───
  const handleFileHash = useCallback(async (entry: SftpEntry) => {
    if (!sessionId) return
    setHashEntry(entry)
    setHashData(null)
    try {
      const data = await sftpApi<{
        md5: string
        sha1: string
        sha256: string
      }>('file-hash', { connectionId: sessionId, path: entry.path })
      setHashData(data)
    } catch (err) {
      setAlertModal({ title: '获取文件哈希失败', message: (err as Error).message })
      setHashEntry(null)
    }
  }, [sessionId])

  // ─── 批量操作 ───
  const batchMoveSelected = useCallback(async () => {
    if (!sessionId || selectedPaths.size === 0) return
    const target = prompt('目标目录路径:', currentPath)
    if (!target) return
    try {
      const paths = [...selectedPaths]
      await sftpApi('batch-move', {
        connectionId: sessionId,
        paths,
        targetDir: target,
      })
      setSelectedPaths(new Set())
      setIsSelectMode(false)
      refresh()
    } catch (err) {
      setAlertModal({ title: '批量移动失败', message: (err as Error).message })
    }
  }, [sessionId, selectedPaths, currentPath, refresh])

  const handleRename = useCallback(
    async (entry: SftpEntry, newName: string) => {
      if (!sessionId || !newName.trim()) return
      const parentPath = entry.path.includes('/')
        ? entry.path.substring(0, entry.path.lastIndexOf('/'))
        : ''
      const newPath = parentPath ? `${parentPath}/${newName}` : newName
      try {
        await sftpApi('rename', {
          connectionId: sessionId,
          from: entry.path,
          to: newPath,
        })
        setRenaming(null)
        refresh()
      } catch (err) {
        setAlertModal({ title: '重命名失败', message: (err as Error).message })
      }
      setContextMenu(null)
    },
    [sessionId, refresh],
  )

  const handleCreate = useCallback(
    async (type: 'file' | 'directory') => {
      if (!sessionId || !createName.trim()) return
      const fullPath = currentPath === '/' ? `/${createName}` : `${currentPath}/${createName}`
      // 重试最多3次，应对 SFTP_NOT_READY
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (type === 'directory') {
            await sftpApi('mkdir', { connectionId: sessionId, path: fullPath }, 10000)
          } else {
            // 创建空文件：上传空内容
            await sftpApi(
              'upload',
              { connectionId: sessionId, path: fullPath, data: textToB64('') },
              10000,
            )
          }
          setCreatingFile(false)
          setCreatingDir(false)
          setCreateName('')
          refresh()
          return
        } catch (err) {
          const msg = (err as Error).message
          if ((msg.includes('SFTP_NOT_READY') || msg.includes('not ready')) && attempt < 2) {
            console.log(`[SftpBrowser] SFTP not ready, retrying create (${attempt + 1}/3)...`)
            await new Promise((r) => setTimeout(r, 500))
            continue
          }
          setAlertModal({ title: '创建失败', message: msg })
          return
        }
      }
    },
    [sessionId, currentPath, createName, refresh],
  )

  const openInEditor = useCallback(
    async (entry: SftpEntry) => {
      if (!sessionId) return
      // 扩展名已知的二进制文件：直接拒绝
      if (isBinaryFile(entry.name)) {
        setAlertModal({ title: '无法打开', message: '无法在编辑器中打开二进制文件' })
        return
      }

      // 大文件警告：超过 5MB 不建议在浏览器编辑器中打开
      const MAX_EDITABLE_SIZE = 5 * 1024 * 1024 // 5 MB
      if (entry.size != null && entry.size > MAX_EDITABLE_SIZE) {
        const sizeMB = (entry.size / 1024 / 1024).toFixed(1)
        setAlertModal({
          title: '文件过大',
          message: `该文件 ${sizeMB} MB，浏览器编辑器可能卡顿或内存不足。\n建议使用 SSH 终端中的 vim/nano 编辑，或下载到本地处理。`,
        })
        return
      }

      // 对符号链接先 stat 解析实际类型，防止目录符号链接进入编辑器
      try {
        const st = await sftpApi<{ type: string; size?: number }>('stat', {
          connectionId: sessionId,
          path: entry.path,
        })
        if (st.type === 'directory') {
          navigateTo(entry.path)
          return
        }
        // 用 stat 返回的实际大小做二次检查
        if (st.size && st.size > MAX_EDITABLE_SIZE) {
          const sizeMB = (st.size / 1024 / 1024).toFixed(1)
          setAlertModal({
            title: '文件过大',
            message: `该文件 ${sizeMB} MB，浏览器编辑器可能卡顿或内存不足。`,
          })
          return
        }
      } catch {
        // stat 失败时继续尝试打开
      }

      let lang = detectLanguage(entry.name)
      const tabId = `sftp:${entry.path}`
      try {
        const b64 = await sftpApi<string>('download', {
          connectionId: sessionId,
          path: entry.path,
        })
        // 增加二次大小检查（下载后实际内容可能比 stat 大，比如文件在下载期间被写入）
        const estimatedBytes = Math.ceil(b64.length * 0.75) // base64 → raw bytes
        if (estimatedBytes > MAX_EDITABLE_SIZE * 1.5) {
          setAlertModal({
            title: '文件过大',
            message: `文件内容 ${(estimatedBytes / 1024 / 1024).toFixed(1)} MB，已超出浏览器编辑器的处理能力。`,
          })
          return
        }
        // 内容嗅探：检测是否为二进制（无扩展名文件可能漏过扩展名检查）
        if (isBinaryContent(b64)) {
          setAlertModal({
            title: '二进制文件',
            message: '该文件包含二进制内容，无法在文本编辑器中打开。',
          })
          return
        }
        const content = b64ToText(b64)
        // 扩展名未识别时，用内容嗅探提升准确度（只取前 8KB 用于嗅探）
        if (lang === 'text' && content) {
          const sniffSample = content.length > 8192 ? content.slice(0, 8192) : content
          const sniffed = sniffLanguage(entry.name, sniffSample)
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
      } catch (err) {
        setAlertModal({ title: '打开失败', message: (err as Error).message })
      }
    },
    [sessionId, fileStore, setActiveNav, navigateTo],
  )

  /** 点击文件/目录处理（移动端单击 = 此处） */
  const handleFileDoubleClick = useCallback(
    (entry: SftpEntry) => {
      // 目录（含 symlink to dir）：导航进入
      if (isDirLike(entry)) {
        navigateTo(entry.path)
        return
      }
      // 所有文件：打开预览模态框（自动识别图片/视频/音频/文本）
      setPreviewEntry(entry)
    },
    [navigateTo],
  )

  const handleDownload = useCallback(
    async (entry: SftpEntry) => {
      if (!sessionId || isDirLike(entry)) return
      // 大文件下载保护（>100MB 的 base64 传输会消耗 ~266MB 内存）
      const MAX_DOWNLOAD = 100 * 1024 * 1024
      if (entry.size != null && entry.size > MAX_DOWNLOAD) {
        setAlertModal({
          title: '文件过大',
          message: `文件 ${formatSize(entry.size)} 超过 100MB 下载限制。请使用 SCP/SFTP 客户端下载。`,
        })
        setContextMenu(null)
        return
      }
      try {
        const b64 = await sftpApi<string>('download', {
          connectionId: sessionId,
          path: entry.path,
        })
        // 用 data URL 替代 blob URL，避免 CSP 阻止
        const dataUrl = `data:application/octet-stream;base64,${b64}`
        const a = document.createElement('a')
        a.href = dataUrl
        a.download = entry.name
        a.click()
      } catch (err) {
        setAlertModal({ title: '下载失败', message: (err as Error).message })
      }
      setContextMenu(null)
    },
    [sessionId],
  )

  // ─── 权限编辑（chmod） ───

  const handleChmod = useCallback(
    async (entry: SftpEntry, octalStr: string) => {
      if (!sessionId) return
      // 解析八进制字符串为数字（如 "755" → 493）
      const num = parseInt(octalStr, 8)
      if (isNaN(num) || num < 0 || num > 0o7777) {
        setAlertModal({ title: '权限无效', message: '请输入有效的八进制权限值（如 755、644）' })
        return
      }
      try {
        await sftpApi('chmod', {
          connectionId: sessionId,
          path: entry.path,
          permissions: num,
        })
        setChmodEntry(null)
        refresh()
      } catch (err) {
        setAlertModal({ title: '修改权限失败', message: (err as Error).message })
      }
    },
    [sessionId, refresh],
  )

  // ─── 文件移动（基于 rename） ───

  const handleMove = useCallback(
    async (entry: SftpEntry, targetPath: string) => {
      if (!sessionId || !targetPath.trim()) return
      const target = targetPath.trim()
      // 如果目标是目录，把文件移到目录内部
      let destPath = target
      if (target.endsWith('/')) {
        destPath = `${target}${entry.name}`
      }
      setMoveBusy(true)
      try {
        await sftpApi('rename', {
          connectionId: sessionId,
          from: entry.path,
          to: destPath,
        })
        setMoveEntry(null)
        setMoveTarget('')
        refresh()
      } catch (err) {
        setAlertModal({ title: '移动失败', message: (err as Error).message })
      } finally {
        setMoveBusy(false)
      }
    },
    [sessionId, refresh],
  )

  // ─── 多选操作 ───

  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set())
    setIsSelectMode(false)
  }, [])

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(entries.map((e) => e.path)))
  }, [entries])

  const batchDelete = useCallback(async () => {
    if (!sessionId || selectedPaths.size === 0) return
    const paths = [...selectedPaths]
    // 过滤掉受保护的路径
    const protectedPaths = paths.filter((p) => isProtectedPath(p))
    const deletablePaths = paths.filter((p) => !isProtectedPath(p))

    if (protectedPaths.length > 0 && deletablePaths.length > 0) {
      setAlertModal({
        title: '部分文件受保护',
        message: `${protectedPaths.length} 个系统关键文件被跳过，将删除 ${deletablePaths.length} 个项目。`,
      })
    } else if (protectedPaths.length > 0) {
      setAlertModal({
        title: '全部受保护',
        message: `选中的 ${protectedPaths.length} 个项目均为系统关键文件，禁止删除。`,
      })
      return
    }

    setConfirmModal({
      title: `删除 ${deletablePaths.length} 个项目`,
      message: `确定将选中的 ${deletablePaths.length} 个项目移入回收站吗？`,
      variant: 'danger',
      confirmText: '移入回收站',
      onConfirm: async () => {
        setConfirmModal(null)
        const CONCURRENCY = 5
        let ok = 0
        let fail = 0
        for (let i = 0; i < deletablePaths.length; i += CONCURRENCY) {
          const batch = deletablePaths.slice(i, i + CONCURRENCY)
          const results = await Promise.allSettled(
            batch.map(async (p) => {
              const name = p.split('/').pop() || p
              await moveToTrash(p, name)
            }),
          )
          for (const r of results) {
            if (r.status === 'fulfilled') ok++
            else fail++
          }
        }
        clearSelection()
        refresh()
        setAlertModal({
          title: '批量删除完成',
          message: `成功移入回收站 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}`,
        })
      },
      onCancel: () => setConfirmModal(null),
    })
  }, [sessionId, selectedPaths, refresh, clearSelection, isProtectedPath, moveToTrash])

  // ─── 键盘快捷键 ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl/Cmd + C = 复制
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.shiftKey) {
        const sel = window.getSelection()?.toString()
        if (sel) return
        if (selectedPaths.size > 0) {
          const entriesToCopy = entries.filter((en) => selectedPaths.has(en.path))
          handleCopy(entriesToCopy)
        }
      }
      // Ctrl/Cmd + X = 剪切
      if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        const sel = window.getSelection()?.toString()
        if (sel) return
        if (selectedPaths.size > 0) {
          const entriesToCut = entries.filter((en) => selectedPaths.has(en.path))
          handleCut(entriesToCut)
        }
      }
      // Ctrl/Cmd + V = 粘贴
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        if (clipboard) {
          e.preventDefault()
          handlePaste()
        }
      }
      // Ctrl/Cmd + A = 全选
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        const sel = window.getSelection()?.toString()
        if (sel) return
        if (entries.length > 0) {
          e.preventDefault()
          selectAll()
        }
      }
      // Delete = 删除选中
      if (e.key === 'Delete' && selectedPaths.size > 0) {
        batchDelete()
      }
      // Escape = 清除选择/关闭菜单
      if (e.key === 'Escape') {
        if (clipboard) {
          setClipboard(null)
        }
        clearSelection()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedPaths, entries, clipboard, handleCopy, handleCut, handlePaste, selectAll, batchDelete, clearSelection])

  // ─── 移动端禁用浏览器默认长按行为（兼容所有 Android 浏览器） ──
  // 只作用于 .sftp-file-entry（文件列表条目），不干预模态框/弹窗内容。
  // 只在 .sftp-file-list 容器内清除意外选择，移出文件列表后（如点击文件信息弹窗）不做拦截。
  useEffect(() => {
    if (!isTouchDevice) return

    let activeTouchEntry = false

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      activeTouchEntry = !!target?.closest?.('.sftp-file-entry')
    }

    const handleSelectionChange = () => {
      if (!activeTouchEntry) return
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) {
        try { sel.removeAllRanges() } catch { /* ignore */ }
      }
    }

    const handleTouchEnd = () => {
      activeTouchEntry = false
      setTimeout(() => {
        const sel = window.getSelection()
        if (sel && !sel.isCollapsed) {
          try { sel.removeAllRanges() } catch { /* ignore */ }
        }
      }, 50)
    }

    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true })
    document.addEventListener('selectionchange', handleSelectionChange, { capture: true })
    document.addEventListener('touchend', handleTouchEnd, { capture: true })
    document.addEventListener('touchcancel', handleTouchEnd, { capture: true })

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, { capture: true })
      document.removeEventListener('selectionchange', handleSelectionChange, { capture: true })
      document.removeEventListener('touchend', handleTouchEnd, { capture: true })
      document.removeEventListener('touchcancel', handleTouchEnd, { capture: true })
    }
  }, [isTouchDevice])

  // ─── 右键事件 ───

  const clampMenuPosition = useCallback((cx: number, cy: number) => {
    const menuWidth = 180
    const menuHeight = 280
    const x = Math.min(cx, window.innerWidth - menuWidth)
    const y = Math.min(cy, window.innerHeight - menuHeight)
    return { x: Math.max(0, x), y: Math.max(0, y) }
  }, [])

  const handleEntryContextMenu = useCallback((e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ ...clampMenuPosition(e.clientX, e.clientY), entry })
  }, [clampMenuPosition])

  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.type !== 'contextmenu') return
    e.preventDefault()
    setContextMenu({ ...clampMenuPosition(e.clientX, e.clientY), entry: null })
  }, [clampMenuPosition])

  // ─── 拖拽上传 ───

  const readFileAsBase64 = useCallback((file: File): Promise<string> => {
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
  }, [])

  const uploadFile = useCallback(
    async (file: File, targetDir: string, onProgress?: (pct: number) => void) => {
      // Enforce size limit — base64 encoding inflates ~33%, so a 200MB file becomes ~266MB in transit
      if (file.size > MAX_UPLOAD_SIZE) {
        throw new Error(
          `文件过大 (${formatSize(file.size)})，超过 200MB 上传限制。请使用 SCP/SFTP 客户端传输。`,
        )
      }
      onProgress?.(10)
      const data = await readFileAsBase64(file)
      onProgress?.(60)
      const remotePath = targetDir === '/' ? `/${file.name}` : `${targetDir}/${file.name}`
      await sftpApi('upload', {
        connectionId: sessionId,
        path: remotePath,
        data,
      })
      onProgress?.(100)
    },
    [sessionId, readFileAsBase64],
  )

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      // 移动端禁用拖拽上传
      if (isTouchDevice) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current++
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setDragOver(true)
    },
    [isTouchDevice],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (isTouchDevice) return
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current--
      if (dragCounterRef.current === 0) setDragOver(false)
    },
    [isTouchDevice],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (isTouchDevice) return
      e.preventDefault()
      e.stopPropagation()
    },
    [isTouchDevice],
  )

  const doUpload = useCallback(
    async (files: File[], targetDir: string) => {
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
      // 移动端禁用拖拽上传
      if (isTouchDevice) return
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
    [sessionId, currentPath, doUpload, confirmOverwrite, isTouchDevice],
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
        const fileArray = Array.from(files)
        const confirmed = await confirmOverwrite(fileArray, targetDir)
        if (confirmed) doUpload(fileArray, targetDir)
      }
      input.click()
    },
    [sessionId, doUpload, confirmOverwrite],
  )

  // ─── 排序后的文件列表（useMemo 缓存） ───
  const sortedEntries = useMemo(() => {
    if (allEntries.length > 0) {
      return { dirs: [], files: sortEntriesBy(allEntries, sortKey, sortDir) }
    }
    return {
      dirs: sortEntriesBy(entries.filter(isDirLike), sortKey, sortDir),
      files: sortEntriesBy(entries.filter((e) => !isDirLike(e)), sortKey, sortDir),
    }
  }, [entries, allEntries, sortKey, sortDir])

  // 搜索过滤后的列表
  const displayEntries = useMemo(() => {
    if (allEntries.length > 0) return sortEntriesBy(allEntries, sortKey, sortDir)
    const all = [...sortedEntries.dirs, ...sortedEntries.files]
    if (!searchQuery.trim()) return all
    const q = searchQuery.toLowerCase()
    return all.filter((e) => e.name.toLowerCase().includes(q))
  }, [allEntries, searchQuery, sortedEntries, sortKey, sortDir])

  // ─── VirtualList 渲染项 ───
  const renderFileItem = useCallback(
    (entry: SftpEntry, _index: number) => {
      const isRenaming = renaming === entry.path
      const isDir = entry.type === 'directory'
      const isSymlink = entry.type === 'symlink'
      const isSelected = selectedPaths.has(entry.path)
      return (
        <div
          key={entry.path}
          className={`sftp-file-entry flex cursor-pointer items-center gap-2 px-2 py-1 text-xs transition-colors hover:bg-slate-700/30 ${isSelected ? 'bg-sky-900/20' : ''} ${isDir || (isSymlink && (entry.targetType === 'directory' || entry.targetType === 'unknown')) ? 'text-sky-300' : 'text-slate-300'}`}
          style={{ height: 28, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', touchAction: 'manipulation' as const }}
          onClick={(e) => {
            // 点击复选框区域不触发打开
            if ((e.target as HTMLElement).closest('[data-select]')) return
            // 选择模式下点击整行切换选中
            if (isSelectMode || selectedPaths.size > 0) {
              toggleSelect(entry.path)
              return
            }
            handleFileDoubleClick(entry)
          }}
          onContextMenu={(e) => handleEntryContextMenu(e, entry)}
          onPointerDown={(e) => {
            // 先捕获元素位置（setTimeout 内元素可能已卸载）
            const el = e.currentTarget as HTMLElement
            const rect = el?.getBoundingClientRect()
            // 长按 500ms：触摸设备显示上下文菜单，非触摸进入选择模式
            longPressTimerRef.current = setTimeout(() => {
              if (isTouchDevice) {
                // 触摸设备：长按显示上下文菜单
                setContextMenu({
                  x: Math.min((rect?.left ?? 0) + (rect?.width ?? 0) / 2, window.innerWidth - 180),
                  y: Math.min((rect?.top ?? 0) + (rect?.height ?? 0) / 2, window.innerHeight - 300),
                  entry,
                })
              } else {
                // 非触摸设备：进入选择模式
                setIsSelectMode(true)
                toggleSelect(entry.path)
              }
            }, 500)
          }}
          onPointerUp={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
          }}
          onPointerLeave={() => {
            if (longPressTimerRef.current) {
              clearTimeout(longPressTimerRef.current)
              longPressTimerRef.current = null
            }
          }}
        >
          {/* 复选框 — 仅在有选中项或长按时显示 */}
          {(selectedPaths.size > 0 || isSelectMode) && (
            <div
              data-select
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                isSelected ? 'border-sky-500 bg-sky-600' : 'border-slate-600 hover:border-slate-400'
              }`}
              onClick={(e) => {
                e.stopPropagation()
                toggleSelect(entry.path)
              }}
            >
              {isSelected && <Check size={10} className="text-white" />}
            </div>
          )}
          {isDir ? (
            <Folder size={14} className="shrink-0 text-sky-400" />
          ) : isSymlink && (entry.targetType === 'directory' || entry.targetType === 'unknown') ? (
            <Folder size={14} className="shrink-0 text-cyan-400" />
          ) : (
            getFileIcon(entry.name, entry.type, entry.targetType)
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(entry, renameValue)
                if (e.key === 'Escape') setRenaming(null)
              }}
              // onBlur 不再自动取消重命名——弹窗版本的 autoFocus 会触发 blur
              className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-200 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="flex-1 truncate">{entry.name}</span>
              {isSymlink && entry.linkTarget && (
                <span
                  className="max-w-[40%] shrink-0 truncate text-[10px] text-slate-600"
                  title={entry.linkTarget}
                >
                  → {entry.linkTarget.split('/').pop() || entry.linkTarget}
                </span>
              )}
            </>
          )}
          {!isDir && (
            <span className="shrink-0 text-[10px] text-slate-600">{formatSize(entry.size)}</span>
          )}
          <span className="hidden w-16 shrink-0 text-right text-[10px] text-slate-600 sm:block">
            {formatPerms(parseInt(entry.permissions, 16) || 0)}
          </span>
        </div>
      )
    },
    [
      renaming,
      renameValue,
      handleFileDoubleClick,
      handleEntryContextMenu,
      handleRename,
      selectedPaths,
      toggleSelect,
      isSelectMode,
      isTouchDevice,
    ],
  )

  // ─── 工具栏事件 ───
  const handleCreateClick = useCallback((type: 'file' | 'directory') => {
    if (type === 'file') {
      setCreatingFile(true)
      setCreatingDir(false)
    } else {
      setCreatingDir(true)
      setCreatingFile(false)
    }
    setCreateName('')
  }, [])

  const handleCreateCancel = useCallback(() => {
    setCreatingFile(false)
    setCreatingDir(false)
  }, [])

  const toggleSearch = useCallback(() => {
    setShowSearch((s) => !s)
    if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 50)
  }, [showSearch])

  // ─── 状态栏 ───
  const statusBar = useMemo(() => {
    const totalSize = entries.reduce((sum, e) => sum + (isDirLike(e) ? 0 : e.size), 0)
    const sortLabel = sortKey === 'name' ? '名称' : sortKey === 'size' ? '大小' : sortKey === 'modified' ? '日期' : '类型'
    return (
      <div className="flex items-center justify-between border-t border-slate-700/30 px-2 py-0.5 text-[10px] text-slate-600">
        <span>
          {sortedEntries.dirs.length} 目录 · {sortedEntries.files.length} 文件 · {formatSize(totalSize)}
        </span>
        <span className="text-slate-700">
          排序: {sortLabel}{sortDir === 'asc' ? ' ↑' : ' ↓'}
          {clipboard && ` · 剪贴板: ${clipboard.paths.length} 项`}
        </span>
      </div>
    )
  }, [sortedEntries.dirs.length, sortedEntries.files.length, entries, sortKey, sortDir, clipboard])

  // ── 批量选择工具栏 —— 固定在底部的操作栏 ──
  const selectionBar = useMemo(() => {
    if (selectedPaths.size === 0) return null
    const selectedEntries = entries.filter((e) => selectedPaths.has(e.path))
    return (
      <div className="sticky bottom-0 z-20 flex items-center gap-1 overflow-x-auto border-t border-sky-900/50 bg-sky-950/70 px-2 py-1 text-[11px] text-sky-300 backdrop-blur-sm sm:gap-2 sm:backdrop-blur-none">
        <span className="shrink-0 font-medium">已选 {selectedPaths.size} 项</span>
        <button
          onClick={selectAll}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-900/40"
        >
          全选
        </button>
        <button
          onClick={clearSelection}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700/50"
        >
          取消
        </button>
        <div className="flex-1" />
        <button
          onClick={() => handleCopy(selectedEntries)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-900/40 sm:px-2"
        >
          <Copy size={10} className="mr-0.5 inline sm:mr-1" /> 复制
        </button>
        <button
          onClick={() => handleCut(selectedEntries)}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-amber-900/30 sm:px-2"
        >
          <Edit3 size={10} className="mr-0.5 inline sm:mr-1" /> 剪切
        </button>
        <button
          onClick={batchMoveSelected}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-amber-400 hover:bg-amber-900/30 sm:px-2"
        >
          <Edit3 size={10} className="mr-0.5 inline sm:mr-1" /> 移动
        </button>
        <button
          onClick={batchDelete}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30 sm:px-2"
        >
          <Trash2 size={10} className="mr-0.5 inline sm:mr-1" /> 删除
        </button>
      </div>
    )
  }, [selectedPaths, entries, selectAll, clearSelection, batchDelete, handleCopy, handleCut, batchMoveSelected])

  // ─── 面包屑导航 ───
  const breadcrumb = useMemo(() => {
    if (currentPath === '/') return []
    const parts = currentPath.split('/').filter(Boolean)
    return parts.map((part, i) => ({
      label: part,
      path: '/' + parts.slice(0, i + 1).join('/'),
    }))
  }, [currentPath])

  // ─── 文件信息弹窗 ───
  const [infoEntry, setInfoEntry] = useState<SftpEntry | null>(null)

  // ─── 可编辑面包屑路径 ───
  const [pathEditMode, setPathEditMode] = useState(false)
  const [pathEditValue, setPathEditValue] = useState('')

  // ─── 右键菜单增强：添加「文件信息」 ───

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/80 ${widthClass ?? 'w-full'}`}
      onDrop={(e) => e.preventDefault()}
    >
      {/* 连接选择器 */}
      {showConnector && connectionOptions && connectionOptions.length > 0 && (
        <div className="flex items-center gap-2 border-b border-slate-700/30 px-2 py-1">
          <Server size={12} className="shrink-0 text-slate-500" />
          <select
            value={_activeConnId || ''}
            onChange={(e) => onConnect?.(e.target.value)}
            className="flex-1 bg-transparent text-xs text-slate-300 outline-none"
          >
            <option value="">选择连接…</option>
            {connectionOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.host}
              </option>
            ))}
          </select>
          {externalConnecting && <Loader2 size={12} className="animate-spin text-amber-400" />}
        </div>
      )}

      {/* 工具栏 */}
      <div className="flex items-center gap-0 overflow-x-auto border-b border-slate-700/30 px-1 py-0.5 sm:px-2 sm:py-1">
        <button
          onClick={goHome}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="根目录"
        >
          <Home size={14} />
        </button>
        <button
          onClick={goUp}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="上级目录"
        >
          <ArrowUp size={14} />
        </button>
        <button
          onClick={refresh}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="刷新"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-700/50 sm:mx-1" />
        <button
          onClick={() => handleCreateClick('file')}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="新建文件"
        >
          <FilePlus size={14} />
        </button>
        <button
          onClick={() => handleCreateClick('directory')}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="新建文件夹"
        >
          <FolderPlus size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-700/50 sm:mx-1" />
        <button
          onClick={() => handleUploadToDir(currentPath)}
          className="btn-icon shrink-0 text-slate-500 hover:text-slate-300"
          title="上传文件"
        >
          <Upload size={14} />
        </button>
        {clipboard && (
          <button
            onClick={handlePaste}
            className="btn-icon shrink-0 text-amber-400 hover:text-amber-300"
            title={`粘贴 ${clipboard.paths.length} 个${clipboard.mode === 'cut' ? '（剪切）' : '（复制）'}`}
          >
            <Save size={14} />
          </button>
        )}
        <div className="flex-1" />
        {/* 排序按钮 */}
        <div className="flex items-center gap-0">
          {([
            { key: 'name' as SortKey, label: '名称', icon: 'N' },
            { key: 'size' as SortKey, label: '大小', icon: 'S' },
            { key: 'modified' as SortKey, label: '日期', icon: 'D' },
            { key: 'type' as SortKey, label: '类型', icon: 'T' },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`rounded px-1 py-0.5 text-[10px] transition-colors ${
                sortKey === key
                  ? 'bg-sky-600/20 text-sky-400'
                  : 'text-slate-600 hover:text-slate-400'
              }`}
              title={`按${label}排序${sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}`}
            >
              <span className="sm:hidden">{icon}</span>
              <span className="hidden sm:inline">{label}{sortKey === key && (sortDir === 'asc' ? '↑' : '↓')}</span>
            </button>
          ))}
        </div>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-700/50 sm:mx-1" />
        <button
          onClick={toggleSearch}
          className={`btn-icon shrink-0 ${showSearch ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
          title="搜索文件"
        >
          <Search size={14} />
        </button>
        <button
          onClick={() => navigateTo(TRASH_DIR)}
          className="btn-icon shrink-0 text-slate-500 hover:text-amber-400"
          title="回收站"
        >
          <Trash2 size={14} />
        </button>
        <div className="mx-0.5 h-4 w-px shrink-0 bg-slate-700/50 sm:mx-1" />
        <button
          onClick={() => {
            if (isSelectMode) {
              // 退出选择模式 — 清除所有选中
              setIsSelectMode(false)
              setSelectedPaths(new Set())
            } else {
              setIsSelectMode(true)
            }
          }}
          className={`btn-icon shrink-0 ${isSelectMode ? 'text-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
          title={isSelectMode ? '退出选择' : '多选'}
        >
          <CheckSquare size={14} />
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
                  // Enter → 本地过滤（由 displayEntries 处理）
                }
              }
              if (e.key === 'Escape') {
                setShowSearch(false)
                setSearchQuery('')
              }
            }}
            placeholder="搜索文件名… (Ctrl+Enter 递归搜索)"
            className="flex-1 bg-transparent text-xs text-slate-300 outline-none"
          />
          <button
            onClick={() => {
              setSearchQuery('')
              setShowSearch(false)
            }}
            className="btn-icon text-slate-500 hover:text-slate-300"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 新建输入框 */}
      {(creatingFile || creatingDir) && (
        <div className="flex items-center gap-1 border-b border-slate-700/30 px-2 py-1">
          <span className="text-[10px] text-slate-500">
            {creatingFile ? '📄 新文件:' : '📁 新文件夹:'}
          </span>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate(creatingFile ? 'file' : 'directory')
              if (e.key === 'Escape') handleCreateCancel()
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
            onClick={handleCreateCancel}
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
      {/* 面包屑导航 — 单击整条路径进入编辑模式 */}
      <div
        className="flex min-h-[22px] items-center gap-0 overflow-x-auto border-b border-slate-700/30 px-2 text-[11px] text-slate-500 select-none"
        style={{ scrollbarWidth: 'none' }}
      >
        {pathEditMode ? (
          <div className="flex items-center gap-1 py-0.5">
            <input
              autoFocus
              value={pathEditValue}
              onChange={(e) => setPathEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pathEditValue.trim()) {
                  setPathEditMode(false)
                  navigateTo(pathEditValue.trim())
                }
                if (e.key === 'Escape') {
                  setPathEditMode(false)
                }
              }}
              onBlur={() => setPathEditMode(false)}
              className="flex-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none ring-1 ring-sky-500/50"
              placeholder="输入路径后按 Enter 跳转"
            />
            <span
              onClick={() => setPathEditMode(false)}
              className="cursor-pointer rounded px-1 py-0.5 text-[10px] text-slate-600 hover:text-slate-400"
            >
              ESC
            </span>
          </div>
        ) : (
          <>
            <button
              onClick={goHome}
              className="shrink-0 rounded px-0.5 py-0 text-slate-600 hover:text-slate-300"
              title="/"
            >
              <Home size={11} />
            </button>
            {breadcrumb.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center">
                <span className="mx-0.5 text-slate-700">/</span>
                <button
                  onClick={() => navigateTo(crumb.path)}
                  className={`shrink-0 rounded px-0.5 py-0 hover:text-slate-300 ${
                    i === breadcrumb.length - 1 ? 'text-slate-400' : 'text-slate-600'
                  }`}
                  title={crumb.path}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
            <span
              className="ml-auto cursor-pointer px-1 text-[10px] text-slate-700 hover:text-slate-500"
              title="点击编辑路径"
              onClick={() => {
                setPathEditValue(currentPath)
                setPathEditMode(true)
              }}
            >
              ✏️
            </span>
          </>
        )}
      </div>

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

      {/* 拖拽悬浮遮罩 (仅桌面端) */}
      {!isTouchDevice && dragOver && (
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
        className="sftp-file-list relative min-h-0 flex-1 overflow-y-auto select-none"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
        onContextMenu={handleEmptyContextMenu}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {!loading && displayEntries.length === 0 ? (
          <div
            className="flex flex-col items-center pt-8 text-slate-600"
            onContextMenu={handleEmptyContextMenu}
          >
            {currentPath === TRASH_DIR ? (
              <>
                <Trash2 size={32} className="text-slate-700" />
                <p className="mt-2 text-xs">回收站为空</p>
                <p className="mt-1 text-[10px] text-slate-700">删除的文件会出现在这里</p>
              </>
            ) : error ? (
              <>
                <Folder size={32} />
                <p className="mt-2 text-xs text-amber-600">无法加载目录</p>
                <p className="mt-1 max-w-[240px] break-all text-[10px] text-slate-700">{error}</p>
                <button
                  onClick={() => listDir(currentPath)}
                  className="mt-3 flex items-center gap-1 rounded border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-300"
                >
                  <RefreshCw size={12} /> 重试
                </button>
              </>
            ) : searchQuery ? (
              <>
                <Folder size={32} />
                <p className="mt-2 text-xs">无搜索结果</p>
              </>
            ) : (
              <>
                <Folder size={32} />
                <p className="mt-2 text-xs">空目录</p>
                {sessionId && (
                  <button
                    onClick={() => handleUploadToDir(currentPath)}
                    className="mt-3 flex items-center gap-1 rounded border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-300"
                  >
                    <Upload size={12} /> 上传文件
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          displayEntries.map((entry, i) => renderFileItem(entry, i))
        )}
      </div>

      {selectionBar}
      {statusBar}

      {/* 递归搜索中提示 */}
      {recursiveSearching && (
        <div className="absolute right-0 bottom-8 left-0 z-40 flex items-center justify-center bg-slate-900/90 py-2">
          <Loader2 size={14} className="mr-2 animate-spin text-sky-400" />
          <span className="text-xs text-sky-300">递归搜索中…</span>
        </div>
      )}

      {/* 右键菜单 */}
      <SftpContextMenu
        contextMenu={contextMenu}
        onOpen={(entry) => navigateTo(entry.path)}
        onPreview={(entry) => { setPreviewEntry(entry) }}
        onOpenInEditor={openInEditor}
        onDownload={handleDownload}
        onRename={(entry) => { setRenaming(entry.path); setRenameValue(entry.name) }}
        onDelete={handleDelete}
        onChmod={(entry) => {
          setChmodEntry(entry)
          setChmodValue((parseInt(entry.permissions, 16) || 0).toString(8).padStart(4, '0'))
        }}
        onMove={(entry) => {
          const parentPath = entry.path.includes('/')
            ? entry.path.substring(0, entry.path.lastIndexOf('/'))
            : ''
          setMoveEntry(entry)
          setMoveTarget(parentPath ? `${parentPath}/` : '/')
        }}
        onCopyPath={(entry) => {
          const p = entry.path
          if (navigator.clipboard) {
            navigator.clipboard.writeText(p).catch(() => fallbackCopy(p))
          } else {
            fallbackCopy(p)
          }
        }}
        onCopyName={(entry) => {
          const n = entry.name
          if (navigator.clipboard) {
            navigator.clipboard.writeText(n).catch(() => fallbackCopy(n))
          } else {
            fallbackCopy(n)
          }
        }}
        onFileInfo={(entry) => { setInfoEntry(entry) }}
        onCopyFile={handleCopy}
        onCutFile={handleCut}
        onDiskUsage={handleDiskUsage}
        onFileHash={handleFileHash}
        onCreateFile={() => handleCreateClick('file')}
        onCreateDir={() => handleCreateClick('directory')}
        onPaste={handlePaste}
        onRefresh={refresh}
        onClose={() => setContextMenu(null)}
        clipboard={clipboard}
        clipboardCount={clipboard?.paths.length ?? 0}
        isTrash={currentPath === TRASH_DIR}
        onRestore={restoreFromTrash}
      />

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

      {/* ── 文件信息弹窗 ── */}
      <FileInfoModal
        entry={infoEntry}
        onClose={() => setInfoEntry(null)}
      />

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

      {/* ── 磁盘使用弹窗 ── */}
      <DiskUsageModal
        entry={diskUsageEntry}
        data={diskUsageData}
        onClose={() => { setDiskUsageEntry(null); setDiskUsageData(null) }}
      />

      {/* ── 文件哈希弹窗 ── */}
      <HashModal
        entry={hashEntry}
        data={hashData}
        onClose={() => { setHashEntry(null); setHashData(null) }}
        onCopied={(label) => setAlertModal({ title: '已复制', message: `${label} 已复制到剪贴板` })}
      />

      {/* ── 权限编辑弹窗 ── */}
      <ChmodModal
        entry={chmodEntry}
        chmodValue={chmodValue}
        onChmodValueChange={setChmodValue}
        onConfirm={() => {
          if (chmodEntry) handleChmod(chmodEntry, chmodValue)
        }}
        onClose={() => setChmodEntry(null)}
      />

      {/* ── 移动到弹窗 ── */}
      <MoveModal
        entry={moveEntry}
        target={moveTarget}
        busy={moveBusy}
        onTargetChange={setMoveTarget}
        onConfirm={() => {
          if (moveEntry && !moveBusy) handleMove(moveEntry, moveTarget)
        }}
        onClose={() => {
          setMoveEntry(null)
          setMoveTarget('')
        }}
        sessionId={sessionId}
      />
    </div>
  )
}

export default memo(SftpBrowserInner)
