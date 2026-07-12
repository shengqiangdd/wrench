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
import { authedFetch } from '../../services/auth'
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
import { sniffLanguage, classifyFile } from '../../utils/content-sniff'
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
  /** 宽度类名 */
  widthClass?: string
}

// --- Base64 / Text encoding helpers (UTF-8 safe) ---

/** base64 -> string (correctly handles multibyte UTF-8 chars like CJK) */
function b64ToText(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** string -> base64 (correctly handles multibyte UTF-8 chars) */
function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0)
  return btoa(bin)
}

/**
 * 从 base64 数据的前几个字节推断 MIME 类型
 * 用于内容嗅探到的媒体文件（扩展名不匹配时）
 */
function inferMimeFromBase64(b64: string): string {
  try {
    const raw = atob(b64.slice(0, 20))
    const bytes = new Uint8Array([...raw].map((c) => c.charCodeAt(0)))

    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png'
    }
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return 'image/jpeg'
    }
    // GIF: 47 49 46 38 (GIF8)
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
      return 'image/gif'
    }
    // BMP: 42 4D
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'image/bmp'
    }
    // WebP: RIFF....WEBP
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp'
    }
    // MP3: ID3 or FF FB/FF F3/FF F2
    if (
      (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
      (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2))
    ) {
      return 'audio/mpeg'
    }
    // FLAC: fLaC
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      return 'audio/flac'
    }
    // OGG: OggS
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return 'audio/ogg'
    }
    // MP4: ....ftyp
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return 'video/mp4'
    }
    // Matroska/WebM: 1A 45 DF A3
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return 'video/webm'
    }
    // PDF: %PDF
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'application/pdf'
    }
  } catch {
    // ignore decode errors
  }
  return 'application/octet-stream'
}

// --- MIME type map (covers common formats) ---

const MIME_MAP: Record<string, string> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  raw: 'image/raw',
  cr2: 'image/x-canon-cr2',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
  dng: 'image/x-adobe-dng',
  psd: 'image/vnd.adobe.photoshop',
  // Video
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  m4v: 'video/mp4',
  '3gp': 'video/3gpp',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  // Audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  opus: 'audio/opus',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  mid: 'audio/midi',
  midi: 'audio/midi',
  ape: 'audio/ape',
  // Documents
  pdf: 'application/pdf',
  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  // Text
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  csv: 'text/csv',
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  sql: 'text/x-sql',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  dart: 'text/x-dart',
  r: 'text/x-r',
  R: 'text/x-r',
}

/** Get MIME type by filename extension */
function getMimeByName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
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
    const res = await authedFetch(`/api/sftp/${endpoint}`, {
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
    if (targetType === 'directory' || targetType === 'unknown')
      return <Link2 size={14} className="text-cyan-400" />
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
  if (baseName === 'dockerfile' || baseName.startsWith('dockerfile.')) {
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
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hrl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  ml: 'ocaml',
  mli: 'ocaml',
  clj: 'clojure',
  cljs: 'clojure',
  r: 'r',
  scala: 'scala',
  groovy: 'groovy',
  gradle: 'groovy',
  v: 'verilog',
  sv: 'systemverilog',
  vhdl: 'vhdl',
  cmake: 'cmake',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  vim: 'vim',
  nginx: 'nginx',
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

/** 判断条目是否为目录（包括指向目录的符号链接） */
function isDirLike(entry: SftpEntry): boolean {
  return (
    entry.type === 'directory' ||
    (entry.type === 'symlink' &&
      (entry.targetType === 'directory' || entry.targetType === 'unknown'))
  )
}

/** 按名称排序：目录（含目录符号链接）在前，文件在后，字母序 */
function sortEntries(entries: SftpEntry[]) {
  const dirs = entries.filter(isDirLike).sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter((e) => !isDirLike(e)).sort((a, b) => a.name.localeCompare(b.name))
  return { dirs, files }
}

// ─── 文件类型判断工具 ───

/** 判断文件是否为图片 */
function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return [
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'svg',
    'avif',
    'heic',
    'heif',
    'tiff',
    'tif',
    'raw',
    'cr2',
    'nef',
    'arw',
    'dng',
    'psd',
    'xcf',
    'svgz',
  ].includes(ext || '')
}

/** 判断文件是否为视频 */
function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return [
    'mp4',
    'webm',
    'ogg',
    'ogv',
    'mov',
    'mkv',
    'avi',
    'wmv',
    'flv',
    'm4v',
    '3gp',
    'mpeg',
    'mpg',
  ].includes(ext || '')
}

/** 判断文件是否为音频 */
function isAudioFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  return [
    'mp3',
    'wav',
    'ogg',
    'flac',
    'aac',
    'm4a',
    'opus',
    'wma',
    'ape',
    'aiff',
    'mid',
    'midi',
  ].includes(ext || '')
}

/** 判断文件是否为二进制文件（图片/视频/音频/压缩包/编译产物等） */
function isBinaryFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  const binaryExts = [
    // Images
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'ico',
    'svg',
    'avif',
    'heic',
    'heif',
    'tiff',
    'tif',
    'raw',
    'cr2',
    'nef',
    'arw',
    'dng',
    'psd',
    'ai',
    'eps',
    'xcf',
    'svgz',
    // Video
    'mp4',
    'mkv',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    'm4v',
    'mpg',
    'mpeg',
    '3gp',
    // Audio
    'mp3',
    'wav',
    'ogg',
    'flac',
    'aac',
    'm4a',
    'opus',
    'wma',
    'ape',
    'aiff',
    'mid',
    'midi',
    // Archives
    'zip',
    'tar',
    'gz',
    'bz2',
    'xz',
    'lz',
    'lzma',
    'zst',
    'br',
    'rar',
    '7z',
    'cab',
    'iso',
    'dmg',
    'deb',
    'rpm',
    'apk',
    'msi',
    'pkg',
    'war',
    'ear',
    'jar',
    // Binary / compiled
    'so',
    'dll',
    'dylib',
    'exe',
    'bin',
    'elf',
    'out',
    'class',
    'rlib',
    'wasm',
    'o',
    'a',
    'lib',
    'pdb',
    'pyc',
    'pyo',
  ]
  return binaryExts.includes(ext || '')
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

  // ── 多选 ──
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
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
      // 二进制文件无法在文本编辑器中打开
      if (isBinaryFile(entry.name)) {
        setAlertModal({ title: '无法打开', message: '无法在编辑器中打开二进制文件' })
        return
      }
      // 对符号链接先 stat 解析实际类型，防止目录符号链接进入编辑器
      let resolvedEntry = entry
      if (entry.type === 'symlink') {
        try {
          const st = await sftpApi<{ type: string }>('stat', {
            connectionId: sessionId,
            path: entry.path,
          })
          if (st.type === 'directory') {
            navigateTo(entry.path)
            return
          }
          // 用 stat 结果更新 entry（保留原 entry 其余字段）
          resolvedEntry = { ...entry, type: st.type as SftpEntry['type'] }
        } catch {
          // stat 失败时继续尝试打开
        }
      }
      if (resolvedEntry.type === 'directory') {
        navigateTo(entry.path)
        return
      }
      let lang = detectLanguage(entry.name)
      const tabId = `sftp:${entry.path}`
      try {
        const b64 = await sftpApi<string>('download', {
          connectionId: sessionId,
          path: entry.path,
        })
        const content = b64ToText(b64)
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
      if (entry.size > MAX_DOWNLOAD) {
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
    setConfirmModal({
      title: `删除 ${paths.length} 个项目`,
      message: `确定删除选中的 ${paths.length} 个项目吗？此操作不可撤销。`,
      variant: 'danger',
      confirmText: '删除',
      onConfirm: async () => {
        setConfirmModal(null)
        let ok = 0
        let fail = 0
        for (const p of paths) {
          try {
            await sftpApi('delete', {
              connectionId: sessionId,
              path: p,
              recursive: true,
            })
            ok++
          } catch {
            fail++
          }
        }
        clearSelection()
        refresh()
        setAlertModal({
          title: '批量删除完成',
          message: `成功 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}`,
        })
      },
      onCancel: () => setConfirmModal(null),
    })
  }, [sessionId, selectedPaths, refresh, clearSelection])

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
    if (!searchQuery.trim()) return [...sortedEntries.dirs, ...sortedEntries.files]
    const q = searchQuery.toLowerCase()
    return [...sortedEntries.dirs, ...sortedEntries.files].filter((e) =>
      e.name.toLowerCase().includes(q),
    )
  }, [allEntries, searchQuery, sortedEntries])

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
          className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-xs transition-colors hover:bg-slate-700/30 ${isSelected ? 'bg-sky-900/20' : ''} ${isDir || (isSymlink && (entry.targetType === 'directory' || entry.targetType === 'unknown')) ? 'text-sky-300' : 'text-slate-300'}`}
          style={{ height: 28 }}
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
          onPointerDown={() => {
            // 长按 500ms 进入选择模式
            longPressTimerRef.current = setTimeout(() => {
              setIsSelectMode(true)
              toggleSelect(entry.path)
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
  const statusBar = useMemo(
    () => (
      <div className="flex items-center justify-between border-t border-slate-700/30 px-2 py-0.5 text-[10px] text-slate-600">
        <span>
          {sortedEntries.dirs.length} 目录 · {sortedEntries.files.length} 文件
        </span>
      </div>
    ),
    [sortedEntries.dirs.length, sortedEntries.files.length],
  )

  // ── 批量选择工具栏 ──
  const selectionBar = useMemo(() => {
    if (selectedPaths.size === 0) return null
    return (
      <div className="flex items-center gap-2 border-t border-sky-900/50 bg-sky-950/30 px-2 py-1 text-[11px] text-sky-300">
        <span className="font-medium">已选 {selectedPaths.size} 项</span>
        <button
          onClick={selectAll}
          className="rounded px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-900/40"
        >
          全选
        </button>
        <button
          onClick={clearSelection}
          className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-700/50"
        >
          取消
        </button>
        <div className="flex-1" />
        <button
          onClick={batchDelete}
          className="rounded px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30"
        >
          <Trash2 size={10} className="mr-1 inline" /> 删除
        </button>
      </div>
    )
  }, [selectedPaths.size, selectAll, clearSelection, batchDelete])

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
      {breadcrumb.length > 0 && (
        <div
          className="flex items-center gap-0 overflow-x-auto border-b border-slate-700/30 px-2 py-0.5 text-[11px] text-slate-500"
          style={{ scrollbarWidth: 'none' }}
        >
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
                className={`shrink-0 rounded px-0.5 py-0 hover:text-slate-300 ${i === breadcrumb.length - 1 ? 'text-slate-400' : 'text-slate-600'}`}
                title={crumb.path}
              >
                {crumb.label}
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
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry ? (
            <>
              {isDirLike(contextMenu.entry) ? (
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
                  {!isDirLike(contextMenu.entry) && !isBinaryFile(contextMenu.entry.name) && (
                    <button
                      onClick={async () => {
                        const entry = contextMenu.entry!
                        setContextMenu(null)
                        await openInEditor(entry)
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
              <button
                onClick={() => {
                  setChmodEntry(contextMenu.entry!)
                  setChmodValue(
                    (parseInt(contextMenu.entry!.permissions, 16) || 0)
                      .toString(8)
                      .padStart(4, '0'),
                  )
                  setContextMenu(null)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Edit3 size={12} /> 权限
              </button>
              {!isDirLike(contextMenu.entry!) && (
                <button
                  onClick={() => {
                    const parentPath = contextMenu.entry!.path.includes('/')
                      ? contextMenu.entry!.path.substring(
                          0,
                          contextMenu.entry!.path.lastIndexOf('/'),
                        )
                      : ''
                    setMoveEntry(contextMenu.entry!)
                    setMoveTarget(parentPath ? `${parentPath}/` : '/')
                    setContextMenu(null)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  <Edit3 size={12} /> 移动到…
                </button>
              )}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setInfoEntry(null)}
        >
          <div
            className="w-[90vw] max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
                {getFileIcon(infoEntry.name, infoEntry.type, infoEntry.targetType)}
                <span className="truncate">{infoEntry.name}</span>
              </div>
              <button
                onClick={() => setInfoEntry(null)}
                className="btn-icon text-slate-500 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex justify-between">
                <span className="text-slate-600">类型</span>
                <span>
                  {infoEntry.type === 'symlink'
                    ? `符号链接 → ${infoEntry.targetType || 'unknown'}`
                    : infoEntry.type}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">大小</span>
                <span>{formatSize(infoEntry.size)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">权限</span>
                <span className="font-mono">
                  {formatPerms(parseInt(infoEntry.permissions, 16) || 0)} ({infoEntry.permissions})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">修改时间</span>
                <span>
                  {infoEntry.modifyTime
                    ? new Date(infoEntry.modifyTime * 1000).toLocaleString()
                    : '-'}
                </span>
              </div>
              <div className="flex justify-between break-all">
                <span className="shrink-0 text-slate-600">路径</span>
                <span className="text-right font-mono text-[10px] text-slate-500">
                  {infoEntry.path}
                </span>
              </div>
              {infoEntry.type === 'symlink' && infoEntry.linkTarget && (
                <div className="flex justify-between break-all">
                  <span className="shrink-0 text-slate-600">链接目标</span>
                  <span className="text-right font-mono text-[10px] text-cyan-500">
                    {infoEntry.linkTarget}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setInfoEntry(null)}
                className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-600"
              >
                关闭
              </button>
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

      {/* ── 权限编辑弹窗 ── */}
      {chmodEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setChmodEntry(null)}
        >
          <div
            className="w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-medium text-slate-200">修改权限</h3>
            <p className="mb-1 text-xs text-slate-400">{chmodEntry.name}</p>
            <p className="mb-3 text-xs text-slate-500">
              当前: {formatPerms(parseInt(chmodEntry.permissions, 16) || 0)}
            </p>
            {/* 八进制输入 */}
            <div className="mb-3">
              <label className="mb-1 block text-xs text-slate-500">八进制权限</label>
              <input
                autoFocus
                value={chmodValue}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-7]/g, '').slice(0, 4)
                  setChmodValue(v)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChmod(chmodEntry, chmodValue)
                  if (e.key === 'Escape') setChmodEntry(null)
                }}
                className="w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="例如: 755"
                maxLength={4}
              />
            </div>
            {/* 快捷权限预设 */}
            <div className="mb-3 grid grid-cols-3 gap-1">
              {[
                { label: '755', desc: 'rwxr-xr-x' },
                { label: '777', desc: 'rwxrwxrwx' },
                { label: '644', desc: 'rw-r--r--' },
                { label: '600', desc: 'rw-------' },
                { label: '700', desc: 'rwx------' },
                { label: '666', desc: 'rw-rw-rw-' },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setChmodValue(p.label)}
                  className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                    chmodValue === p.label
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  <div className="font-medium">{p.label}</div>
                  <div className="text-[8px] opacity-60">{p.desc}</div>
                </button>
              ))}
            </div>
            {/* rwx 复选框 */}
            <div className="mb-3 grid grid-cols-3 gap-2 text-center text-[10px] text-slate-500">
              {(['owner', 'group', 'others'] as const).map((who, wi) => (
                <div key={who}>
                  <div className="mb-1 font-medium text-slate-400">
                    {who === 'owner' ? '所有者' : who === 'group' ? '用户组' : '其他'}
                  </div>
                  {(['r', 'w', 'x'] as const).map((perm, pi) => {
                    const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
                    const bitVal = bits[wi * 3 + pi] ?? 0
                    const current = parseInt(chmodValue, 8) || 0
                    const checked = (current & bitVal) === bitVal
                    return (
                      <label
                        key={perm}
                        className="flex cursor-pointer items-center justify-center gap-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const newVal = checked ? current & ~bitVal : current | bitVal
                            setChmodValue((newVal & 0o7777).toString(8).padStart(4, '0'))
                          }}
                          className="accent-sky-500"
                        />
                        <span>{perm}</span>
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setChmodEntry(null)}
                className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                onClick={() => handleChmod(chmodEntry, chmodValue)}
                className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 移动到弹窗 ── */}
      {moveEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => {
            setMoveEntry(null)
            setMoveTarget('')
          }}
        >
          <div
            className="w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-medium text-slate-200">移动到</h3>
            <p className="mb-1 text-xs text-slate-400">{moveEntry.name}</p>
            <input
              autoFocus
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !moveBusy) handleMove(moveEntry, moveTarget)
                if (e.key === 'Escape') {
                  setMoveEntry(null)
                  setMoveTarget('')
                }
              }}
              className="mb-1 w-full rounded bg-slate-800 px-2 py-1.5 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="目标路径，例如: /tmp/"
            />
            <p className="mb-3 text-[10px] text-slate-600">
              输入完整路径。以 / 结尾表示移到目录内。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setMoveEntry(null)
                  setMoveTarget('')
                }}
                className="rounded px-3 py-1 text-xs text-slate-400 hover:bg-slate-800"
              >
                取消
              </button>
              <button
                onClick={() => handleMove(moveEntry, moveTarget)}
                disabled={moveBusy || !moveTarget.trim()}
                className="rounded bg-sky-600 px-3 py-1 text-xs text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {moveBusy ? '移动中…' : '移动'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(SftpBrowserInner)
