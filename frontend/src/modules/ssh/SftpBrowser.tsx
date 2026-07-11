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
  FileCode,
  FileJson,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Link2,
  Binary,
  HardDrive,
  Cpu,
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
} from 'lucide-react'
import { useFileStore } from '../../stores/file-store'
import { useAppStore } from '../../stores/app-store'
import { sniffLanguage } from '../../utils/content-sniff'
import { AlertModal, ConfirmModal } from '../../components/ConfirmModal'
import type { SftpEntry } from '../../types/ssh'

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
}

// ─── REST API 工具函数 ───

/** REST API 统一响应格式 */
interface SftpApiResponse<T = unknown> {
  success: boolean
  code: number
  msg: string
  data?: T
  error?: string
}

/**
 * 通用 SFTP REST API 调用封装
 * 统一处理请求/响应格式和错误抛出
 */
async function sftpApi<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`/api/sftp/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    const json: SftpApiResponse<T> = await res.json()
    if (!json.success) {
      throw new Error(json.error || json.msg || 'SFTP 操作失败')
    }
    return json.data as T
  } finally {
    clearTimeout(timer)
  }
}

// ─── 工具函数 ───

function getFileIcon(name: string, type?: string, targetType?: string) {
  // Special file types from backend
  if (type === 'symlink') {
    // Color hint based on resolved target type
    if (targetType === 'directory') return <Link2 size={14} className="text-cyan-400" />
    if (targetType === 'broken') return <Link2 size={14} className="text-red-400" />
    return <Link2 size={14} className="text-cyan-300" />
  }
  if (type === 'block_device') {
    return <HardDrive size={14} className="text-orange-400" />
  }
  if (type === 'char_device') {
    return <Cpu size={14} className="text-orange-300" />
  }
  if (type === 'fifo') {
    return <Binary size={14} className="text-yellow-400" />
  }
  if (type === 'socket') {
    return <Binary size={14} className="text-pink-400" />
  }

  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <File size={14} className="text-slate-500" />

  // No extension but name itself indicates type
  const baseName = name.split('/').pop()?.toLowerCase() || ''

  switch (ext) {
    // Source code
    case 'js':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'mts':
    case 'cts':
    case 'tsx':
    case 'jsx':
    case 'vue':
    case 'svelte':
    case 'astro':
    case 'py':
    case 'pyw':
    case 'pyx':
    case 'go':
    case 'rs':
    case 'java':
    case 'kt':
    case 'kts':
    case 'c':
    case 'cpp':
    case 'cxx':
    case 'cc':
    case 'h':
    case 'hpp':
    case 'rb':
    case 'php':
    case 'swift':
    case 'm':
    case 'mm':
    case 'dart':
    case 'zig':
    case 'nim':
    case 'cr':
    case 'ex':
    case 'exs':
    case 'erl':
    case 'hs':
    case 'ml':
    case 'scala':
    case 'r':
    case 'jl':
    case 'v':
    case 'sv':
    case 'vhd':
      return <FileCode size={14} className="text-sky-400" />

    // Shell / config scripts
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
    case 'csh':
    case 'tcsh':
    case 'ps1':
    case 'psm1':
    case 'bat':
    case 'cmd':
      return <FileCode size={14} className="text-emerald-400" />

    // Web
    case 'html':
    case 'htm':
    case 'xhtml':
    case 'css':
    case 'scss':
    case 'less':
    case 'sass':
    case 'styl':
      return <FileCode size={14} className="text-orange-400" />

    // Data / config
    case 'json':
    case 'json5':
    case 'jsonc':
    case 'jsonl':
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'env':
    case 'xml':
    case 'xsd':
    case 'xsl':
    case 'xslt':
    case 'properties':
    case 'plist':
      return <FileJson size={14} className="text-amber-400" />

    // Markup / docs
    case 'md':
    case 'mdx':
    case 'markdown':
    case 'rst':
    case 'txt':
    case 'log':
    case 'csv':
    case 'tsv':
    case 'rtf':
    case 'doc':
    case 'docx':
    case 'pdf':
    case 'epub':
    case 'tex':
    case 'latex':
      return <FileText size={14} className="text-slate-400" />

    // Images
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'bmp':
    case 'ico':
    case 'webp':
    case 'avif':
    case 'heic':
    case 'heif':
    case 'tiff':
    case 'tif':
    case 'raw':
    case 'cr2':
    case 'nef':
    case 'arw':
    case 'dng':
    case 'psd':
    case 'ai':
    case 'eps':
    case 'xcf':
    case 'svg':
    case 'svgz':
      return <Image size={14} className="text-purple-400" />

    // Video
    case 'mp4':
    case 'mkv':
    case 'avi':
    case 'mov':
    case 'wmv':
    case 'flv':
    case 'webm':
    case 'm4v':
    case 'mpg':
    case 'mpeg':
    case '3gp':
      return <Film size={14} className="text-red-400" />

    // Audio
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'ogg':
    case 'opus':
    case 'wma':
    case 'm4a':
    case 'ape':
    case 'aiff':
    case 'mid':
    case 'midi':
      return <Music size={14} className="text-rose-400" />

    // Archives
    case 'zip':
    case 'tar':
    case 'gz':
    case 'bz2':
    case 'xz':
    case 'lz':
    case 'lzma':
    case 'zst':
    case 'br':
    case 'rar':
    case '7z':
    case 'cab':
    case 'iso':
    case 'dmg':
    case 'deb':
    case 'rpm':
    case 'apk':
    case 'msi':
    case 'pkg':
    case 'war':
    case 'ear':
    case 'jar':
      return <Archive size={14} className="text-yellow-400" />

    // Binary / compiled
    case 'so':
    case 'dll':
    case 'dylib':
    case 'exe':
    case 'bin':
    case 'elf':
    case 'out':
    case 'class':
    case 'rlib':
    case 'wasm':
    case 'o':
    case 'a':
    case 'lib':
    case 'pdb':
    case 'pyc':
    case 'pyo':
      return <Binary size={14} className="text-amber-300" />

    // Database
    case 'db':
    case 'sqlite':
    case 'sqlite3':
    case 'sql':
    case 'pgsql':
    case 'mysql':
      return <FileJson size={14} className="text-teal-400" />

    // Docker / DevOps
    case 'dockerfile':
    case 'docker':
    case 'tf':
    case 'tfvars':
    case 'hcl':
    case 'tfstate':
      return <FileCode size={14} className="text-sky-500" />

    // Makefile (special names)
    case 'mk':
      return <FileCode size={14} className="text-blue-400" />

    default:
      break
  }

  // Check special filenames (no extension match needed)
  if (
    baseName === 'dockerfile' ||
    baseName.startsWith('dockerfile.')
  ) {
    return <FileCode size={14} className="text-sky-500" />
  }
  if (baseName === 'makefile' || baseName === 'gnumakefile') {
    return <FileCode size={14} className="text-blue-400" />
  }
  if (baseName === 'gemfile' || baseName === 'rakefile') {
    return <FileCode size={14} className="text-red-400" />
  }
  if (baseName === 'cmakelists.txt') {
    return <FileCode size={14} className="text-teal-400" />
  }
  if (baseName === '.gitignore' || baseName === '.dockerignore') {
    return <FileText size={14} className="text-slate-500" />
  }
  if (baseName === 'license' || baseName.startsWith('license.')) {
    return <FileText size={14} className="text-emerald-500" />
  }
  if (baseName === 'readme' || baseName.startsWith('readme.')) {
    return <FileText size={14} className="text-blue-400" />
  }

  return <File size={14} className="text-slate-500" />
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
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  pyw: 'python',
  pyx: 'python',
  go: 'go',
  rs: 'rust',
  rlib: 'rust',
  java: 'java',
  class: 'java',
  jar: 'java',
  c: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
  hxx: 'cpp',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sass: 'scss',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'vue',
  xml: 'xml',
  svg: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  csv: 'text',
  tsv: 'text',
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  log: 'text',
  diff: 'text',
  patch: 'text',
  sql: 'sql',
  pgsql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  php: 'php',
  phtml: 'php',
  php3: 'php',
  php4: 'php',
  php5: 'php',
  php7: 'php',
  php8: 'php',
  rb: 'ruby',
  rbs: 'ruby',
  gemfile: 'ruby',
  rake: 'ruby',
  pl: 'perl',
  pm: 'perl',
  t: 'perl',
  lua: 'lua',
  wast: 'wast',
  wat: 'wast',
  liquid: 'liquid',
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
  } catch {
    // 静默失败
  }
  document.body.removeChild(ta)
}

/** 按名称排序：目录在前，符号链接次之，文件在后，字母序 */
function sortEntries(entries: SftpEntry[]) {
  const typeOrder = (t: string) => (t === 'directory' ? 0 : t === 'symlink' ? 1 : 2)
  return {
    dirs: entries
      .filter((e) => e.type === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name)),
    symlinks: entries
      .filter((e) => e.type === 'symlink')
      .sort((a, b) => a.name.localeCompare(b.name)),
    files: entries
      .filter((e) => e.type !== 'directory' && e.type !== 'symlink')
      .sort((a, b) => {
        const ao = typeOrder(a.type)
        const bo = typeOrder(b.type)
        return ao !== bo ? ao - bo : a.name.localeCompare(b.name)
      }),
  }
}

// ─── 文件类型判断工具 ───

/** 判断文件是否为图片 */
function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'].includes(ext || '')
}

/** 判断文件是否为视频 */
function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ['mp4', 'webm', 'ogg', 'mov', 'mkv'].includes(ext || '')
}

/** 判断文件是否为音频 */
function isAudioFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus'].includes(ext || '')
}

/** 判断文件是否为可编辑文本 */
function isEditableText(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  const editableExts = [
    'txt', 'md', 'log', 'csv', 'tsv', 'json', 'json5', 'yaml', 'yml', 'toml', 'xml',
    'html', 'htm', 'css', 'scss', 'less', 'js', 'ts', 'tsx', 'jsx', 'vue', 'svelte',
    'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'sh', 'bash', 'zsh',
    'sql', 'env', 'cfg', 'conf', 'ini', 'properties', 'dockerfile', 'makefile',
    'docker-compose', 'nginx', 'fstab', 'hosts', 'passwd', 'shadow', 'group',
    'ssh', 'sshd_config', 'gitignore', 'gitattributes', 'editorconfig',
  ]
  return editableExts.includes(ext || '')
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [binaryUrl, setBinaryUrl] = useState<string | null>(null)
  const [isImage, setIsImage] = useState(false)
  const [isVideo, setIsVideo] = useState(false)
  const [isAudio, setIsAudio] = useState(false)

  const loadFile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Protect against opening extremely large files (>50MB text preview will crash browser)
      const MAX_TEXT_PREVIEW = 50 * 1024 * 1024
      if (!isImageFile(entry.name) && !isVideoFile(entry.name) && !isAudioFile(entry.name) && entry.size > MAX_TEXT_PREVIEW) {
        setError(`文件过大 (${formatSize(entry.size)})，无法预览。请下载后查看或在编辑器中打开。`)
        setLoading(false)
        return
      }

      const b64 = await sftpApi<string>('download', {
        connectionId: sessionId,
        path: entry.path,
      })

      // Check if this is a binary file (image/video/audio)
      const img = isImageFile(entry.name)
      const vid = isVideoFile(entry.name)
      const aud = isAudioFile(entry.name)

      if (img) {
        setIsImage(true)
        const ext = entry.name.split('.').pop()?.toLowerCase() || 'png'
        const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
        setBinaryUrl(`data:image/${mime};base64,${b64}`)
        setLoading(false)
        return
      }
      if (vid) {
        setIsVideo(true)
        const ext = entry.name.split('.').pop()?.toLowerCase() || 'mp4'
        const mime = ext === 'mkv' ? 'x-matroska' : ext
        setBinaryUrl(`data:video/${mime};base64,${b64}`)
        setLoading(false)
        return
      }
      if (aud) {
        setIsAudio(true)
        const ext = entry.name.split('.').pop()?.toLowerCase() || 'mp3'
        const mime = ext === 'm4a' ? 'mp4' : ext
        setBinaryUrl(`data:audio/${mime};base64,${b64}`)
        setLoading(false)
        return
      }

      // Text file — decode
      const decoded = atob(b64)
      setContent(decoded)
      setOriginalContent(decoded)
    } catch (err) {
      setError('读取失败: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sessionId, entry.path, entry.name, entry.size])

  useEffect(() => {
    const t = setTimeout(() => loadFile(), 0)
    return () => clearTimeout(t)
  }, [entry.path, loadFile])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      const encoded = btoa(content)
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
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
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[90vw] max-w-4xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-2">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            {getFileIcon(entry.name, entry.type, entry.targetType)}
            <span className="font-medium">{entry.name}</span>
            <span className="text-[10px] text-slate-600">{formatSize(entry.size)}</span>
          </div>
          <div className="flex items-center gap-1">
            {error && <span className="text-[10px] text-red-400">{error}</span>}
            {saveMsg && <span className="text-[10px] text-emerald-400">{saveMsg}</span>}
            {!isImage && !isVideo && !isAudio && !editMode && isEditableText(entry.name) && (
              <button
                onClick={() => setEditMode(true)}
                className="btn-icon text-slate-500 hover:text-slate-300"
                title="编辑"
              >
                <Edit3 size={14} />
              </button>
            )}
            {onOpenInEditor && isEditableText(entry.name) && (
              <button
                onClick={() => {
                  onOpenInEditor(entry)
                }}
                className="btn-icon text-slate-500 hover:text-slate-300"
                title="在编辑器中打开"
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
              <X size={14} />
            </button>
          </div>
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-auto p-4">
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
              <video
                src={binaryUrl}
                controls
                className="max-h-[60vh] max-w-full rounded"
              >
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
              {!editMode && isEditableText(entry.name) && (
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

  const retryCountRef = useRef(0)
  const fileStore = useFileStore()
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const notifyRef = useRef<HTMLDivElement>(null)
  const dragCounterRef = useRef(0)

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
    }, 0)
    return () => clearTimeout(t3)
  }, [sessionId, listDir])

  // 关闭右键菜单
  useEffect(() => {
    const handler = () => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
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
    ): Promise<SftpEntry[]> {
      if (!sessionId) return []
      // 限制最大递归深度为 5 层，防止遍历整个文件系统
      if (depth > 5) return []
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
          if (item.name.toLowerCase().includes(q)) {
            results.push({
              ...item,
              path: dir === '/' ? `/${item.name}` : `${dir}/${item.name}`,
            })
          }
          if (item.type === 'directory') {
            const subDir = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`
            const sub = await recursiveSearch(subDir, q, depth + 1)
            results.push(...sub)
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

  const handleDelete = useCallback(
    (entry: SftpEntry) => {
      if (!sessionId) return
      setConfirmModal({
        title: '确认删除',
        message: `确定删除 ${entry.type === 'directory' ? '目录' : '文件'} "${entry.name}" 吗？`,
        variant: 'danger',
        confirmText: '删除',
        onConfirm: async () => {
          setConfirmModal(null)
          try {
            await sftpApi('delete', {
              connectionId: sessionId,
              path: entry.path,
              recursive: entry.type === 'directory',
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
    },
    [sessionId, refresh],
  )

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
              { connectionId: sessionId, path: fullPath, data: btoa('') },
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
      let lang = detectLanguage(entry.name)
      const tabId = `sftp:${entry.path}`
      try {
        const b64 = await sftpApi<string>('download', {
          connectionId: sessionId,
          path: entry.path,
        })
        const content = atob(b64)
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
      } catch (err) {
        setAlertModal({ title: '打开失败', message: (err as Error).message })
      }
    },
    [sessionId, fileStore, setActiveNav],
  )

  /** 双击文件处理 */
  const handleFileDoubleClick = useCallback(
    (entry: SftpEntry) => {
      if (entry.type === 'directory') {
        navigateTo(entry.path)
        return
      }
      // Symlink to directory: use resolved targetType for reliable detection
      if (entry.type === 'symlink') {
        if (entry.targetType === 'directory') {
          navigateTo(entry.path)
          return
        }
        // Unknown target type — try navigating (will fail gracefully if not a dir)
        if (entry.targetType === 'unknown' || entry.targetType === 'broken') {
          navigateTo(entry.path)
          return
        }
        // Symlink to file — fall through to open in editor
      }
      if (onFileDoubleClick) {
        onFileDoubleClick(entry)
      } else {
        openInEditor(entry)
      }
    },
    [navigateTo, onFileDoubleClick, openInEditor],
  )

  const handleDownload = useCallback(
    async (entry: SftpEntry) => {
      if (!sessionId || entry.type === 'directory') return
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

  // ─── 右键事件 ───

  const handleEntryContextMenu = useCallback((e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.type !== 'contextmenu') return
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry: null })
  }, [])

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
  const sortedEntries = useMemo(() => sortEntries(entries), [entries])

  // 搜索过滤后的列表
  const displayEntries = useMemo(() => {
    if (allEntries.length > 0) return allEntries
    if (!searchQuery.trim())
      return [...sortedEntries.dirs, ...sortedEntries.symlinks, ...sortedEntries.files]
    const q = searchQuery.toLowerCase()
    return [...sortedEntries.dirs, ...sortedEntries.symlinks, ...sortedEntries.files].filter((e) =>
      e.name.toLowerCase().includes(q),
    )
  }, [allEntries, searchQuery, sortedEntries])

  // ─── VirtualList 渲染项 ───
  const renderFileItem = useCallback(
    (entry: SftpEntry, _index: number) => {
      const isRenaming = renaming === entry.path
      const isDir = entry.type === 'directory'
      const isSymlink = entry.type === 'symlink'
      return (
        <div
          key={entry.path}
          className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-xs transition-colors hover:bg-slate-700/30 ${isDir ? 'text-sky-300' : isSymlink ? 'text-cyan-300' : 'text-slate-300'}`}
          style={{ height: 28 }}
          onClick={() => handleFileDoubleClick(entry)}
          onContextMenu={(e) => handleEntryContextMenu(e, entry)}
        >
          {isDir ? (
            <Folder size={14} className="shrink-0 text-sky-400" />
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
              onBlur={() => setRenaming(null)}
              className="flex-1 rounded bg-slate-800 px-1 py-0.5 text-xs text-slate-200 outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="flex-1 truncate">{entry.name}</span>
              {isSymlink && entry.linkTarget && (
                <span className="max-w-[40%] shrink-0 truncate text-[10px] text-slate-600" title={entry.linkTarget}>
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
    [renaming, renameValue, handleFileDoubleClick, handleEntryContextMenu, handleRename],
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
  const statusBar = useMemo(
    () => (
      <div className="flex items-center justify-between border-t border-slate-700/30 px-2 py-0.5 text-[10px] text-slate-600">
        <span>
          {sortedEntries.dirs.length} 目录 · {sortedEntries.symlinks.length} 链接 ·{' '}
          {sortedEntries.files.length} 文件
        </span>
      </div>
    ),
    [sortedEntries.dirs.length, sortedEntries.symlinks.length, sortedEntries.files.length],
  )

  // ─── 面包屑导航 ───
  const breadcrumb = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const items: { label: string; path: string }[] = [{ label: '/', path: '/' }]
    let accumulated = ''
    for (const part of parts) {
      accumulated += '/' + part
      items.push({ label: part, path: accumulated })
    }
    return items
  }, [currentPath])

  // ─── 文件信息弹窗 ───
  const [infoEntry, setInfoEntry] = useState<SftpEntry | null>(null)

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
            value={sessionId || ''}
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
          onClick={() => handleCreateClick('file')}
          className="btn-icon text-slate-500 hover:text-slate-300"
          title="新建文件"
        >
          <FilePlus size={14} />
        </button>
        <button
          onClick={() => handleCreateClick('directory')}
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
          onClick={toggleSearch}
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
      {/* 面包屑导航 */}
      {breadcrumb.length > 1 && (
        <div className="flex items-center gap-0 overflow-x-auto border-b border-slate-700/30 px-2 py-0.5 text-[11px] text-slate-500" style={{ scrollbarWidth: 'none' }}>
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.path} className="flex items-center">
              {i > 0 && <span className="mx-0.5 text-slate-700">/</span>}
              <button
                onClick={() => navigateTo(crumb.path)}
                className={`shrink-0 rounded px-0.5 py-0 hover:text-slate-300 ${i === breadcrumb.length - 1 ? 'text-slate-400' : 'text-slate-600'}`}
                title={crumb.path}
              >
                {crumb.label === '/' ? '/' : crumb.label}
              </button>
            </span>
          ))}
        </div>
      )}

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
        className="relative min-h-0 flex-1 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
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
            <Folder size={32} />
            <p className="mt-2 text-xs">
              {error ? '无法加载目录' : searchQuery ? '无搜索结果' : '空目录'}
            </p>
            {!error && !searchQuery && sessionId && (
              <button
                onClick={() => handleUploadToDir(currentPath)}
                className="mt-3 flex items-center gap-1 rounded border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700/50 hover:text-slate-300"
              >
                <Upload size={12} /> 上传文件
              </button>
            )}
          </div>
        ) : (
          displayEntries.map((entry, i) => renderFileItem(entry, i))
        )}
      </div>

      {statusBar}

      {/* 递归搜索中提示 */}
      {recursiveSearching && (
        <div className="absolute right-0 bottom-8 left-0 z-40 flex items-center justify-center bg-slate-900/90 py-2">
          <Loader2 size={14} className="mr-2 animate-spin text-sky-400" />
          <span className="text-xs text-sky-300">递归搜索中…</span>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry ? (
            <>
              {contextMenu.entry.type === 'directory' ? (
                <button
                  onClick={() => {
                    navigateTo(contextMenu.entry!.path)
                    setContextMenu(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Folder size={12} /> 打开
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setPreviewEntry(contextMenu.entry!)
                      setContextMenu(null)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <Eye size={12} /> 预览
                  </button>
                  {isEditableText(contextMenu.entry.name) && (
                    <button
                      onClick={() => {
                        openInEditor(contextMenu.entry!)
                        setContextMenu(null)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      <Edit3 size={12} /> 在编辑器中打开
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(contextMenu.entry!)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                  >
                    <Download size={12} /> 下载
                  </button>
                </>
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
              <div className="mx-2 my-1 border-t border-slate-700/50" />
              <button
                onClick={() => {
                  const path = contextMenu.entry!.path
                  if (navigator.clipboard) {
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
              <button
                onClick={() => {
                  const name = contextMenu.entry!.name
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(name).catch(() => fallbackCopy(name))
                  } else {
                    fallbackCopy(name)
                  }
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Copy size={12} /> 复制文件名
              </button>
              <button
                onClick={() => {
                  setInfoEntry(contextMenu.entry!)
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Eye size={12} /> 文件信息
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  handleCreateClick('file')
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <FilePlus size={12} /> 新建文件
              </button>
              <button
                onClick={() => {
                  handleCreateClick('directory')
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

      {/* ── 文件信息弹窗 ── */}
      {infoEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setInfoEntry(null)}>
          <div className="w-[90vw] max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                {getFileIcon(infoEntry.name, infoEntry.type, infoEntry.targetType)}
                <span className="truncate">{infoEntry.name}</span>
              </div>
              <button onClick={() => setInfoEntry(null)} className="btn-icon text-slate-500 hover:text-slate-300">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between"><span className="text-slate-600">类型</span><span>{infoEntry.type === 'symlink' ? `符号链接 → ${infoEntry.targetType || 'unknown'}` : infoEntry.type}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">大小</span><span>{formatSize(infoEntry.size)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">权限</span><span className="font-mono">{formatPerms(parseInt(infoEntry.permissions, 16) || 0)} ({infoEntry.permissions})</span></div>
              <div className="flex justify-between"><span className="text-slate-600">修改时间</span><span>{infoEntry.modifyTime ? new Date(infoEntry.modifyTime * 1000).toLocaleString() : '-'}</span></div>
              <div className="flex justify-between break-all"><span className="shrink-0 text-slate-600">路径</span><span className="text-right font-mono text-[10px] text-slate-500">{infoEntry.path}</span></div>
              {infoEntry.type === 'symlink' && infoEntry.linkTarget && (
                <div className="flex justify-between break-all"><span className="shrink-0 text-slate-600">链接目标</span><span className="text-right font-mono text-[10px] text-cyan-500">{infoEntry.linkTarget}</span></div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setInfoEntry(null)} className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600">关闭</button>
            </div>
          </div>
        </div>
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
