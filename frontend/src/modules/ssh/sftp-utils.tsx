/**
 * SFTP utility functions — extracted from SftpBrowser.tsx
 *
 * Pure functions with no React/JSX dependency.
 */

import {
  FileText,
  Image,
  Film,
  Music,
  File,
  Link2,
  HardDrive,
  Cpu,
  Binary,
  FileCode,
  FileJson,
  Archive,
} from 'lucide-react'
import type { SftpEntry } from '../../types/ssh'
import { authedFetch } from '../../services/auth'

export function b64ToText(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** string -> base64 (correctly handles multibyte UTF-8 chars) */
export function textToB64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0)
  return btoa(bin)
}

/**
 * 从 base64 数据的前几个字节推断 MIME 类型
 * 用于内容嗅探到的媒体文件（扩展名不匹配时）
 */
export function inferMimeFromBase64(b64: string): string {
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

export const MIME_MAP: Record<string, string> = {
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
export function getMimeByName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

// ─── REST API 工具函数 ───

/** REST API 统一响应格式 */
export interface SftpApiResponse<T = unknown> {
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
export async function sftpApi<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 30000,
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

export function getFileIcon(name: string, type?: string, targetType?: string) {
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

export function formatSize(bytes: number | undefined | null): string {
  if (bytes == null || bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

export function formatPerms(mode: number): string {
  const s = mode.toString(8).slice(-3)
  const p = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return s
    .split('')
    .map((c) => p[parseInt(c)] || '---')
    .join('')
}

/** 文件扩展名 → CodeMirror 语言标识映射 */
export const LANGUAGE_MAP: Record<string, string> = {
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

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANGUAGE_MAP[ext] || 'text'
}

/** 兜底的复制方案：当 navigator.clipboard 不可用时使用 */
export function fallbackCopy(text: string) {
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
export function isDirLike(entry: SftpEntry): boolean {
  return (
    entry.type === 'directory' ||
    (entry.type === 'symlink' &&
      (entry.targetType === 'directory' || entry.targetType === 'unknown'))
  )
}

// ─── 排序类型 ───

export type SortKey = 'name' | 'size' | 'modified' | 'type'
export type SortDir = 'asc' | 'desc'

/** 按指定字段和方向排序条目 */
export function sortEntriesBy(entries: SftpEntry[], key: SortKey, dir: SortDir): SftpEntry[] {
  const sorted = [...entries].sort((a, b) => {
    // 目录始终在前
    const aDir = isDirLike(a)
    const bDir = isDirLike(b)
    if (aDir !== bDir) return aDir ? -1 : 1

    let cmp = 0
    switch (key) {
      case 'name':
        cmp = a.name.localeCompare(b.name)
        break
      case 'size':
        cmp = a.size - b.size
        break
      case 'modified':
        cmp = (a.modifyTime || 0) - (b.modifyTime || 0)
        break
      case 'type': {
        const extA = a.name.split('.').pop()?.toLowerCase() || ''
        const extB = b.name.split('.').pop()?.toLowerCase() || ''
        cmp = extA.localeCompare(extB) || a.name.localeCompare(b.name)
        break
      }
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

// ─── 文件类型判断工具 ───

/** 判断文件是否为图片 */
export function isImageFile(name: string): boolean {
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
export function isVideoFile(name: string): boolean {
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
export function isAudioFile(name: string): boolean {
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
export function isBinaryFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase()
  // 无扩展名时，按文件名匹配已知二进制文件
  const binaryNames = ['vmlinuz', 'vmlinux', 'System.map', 'initramfs', 'initrd']
  if (!ext || ext === name.toLowerCase()) {
    return binaryNames.some((n) => name.toLowerCase().startsWith(n))
  }
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
    // Kernel / firmware / disk images
    'ko',
    'dtb',
    'dtbo',
    'img',
    'raw',
    'rom',
    'bios',
    'efi',
    'mem',
    'dump',
  ]
  return binaryExts.includes(ext || '')
}

/**
 * 嗅探 base64 解码后的内容是否为二进制。
 * 检查前 512 字节中 null bytes 的比例——超过 1% 视为二进制。
 */
export function isBinaryContent(b64: string): boolean {
  try {
    const raw = atob(b64.length > 2048 ? b64.slice(0, 2048) : b64)
    let nullCount = 0
    const len = Math.min(raw.length, 512)
    for (let i = 0; i < len; i++) {
      if (raw.charCodeAt(i) === 0) nullCount++
    }

    return len > 0 && nullCount / len > 0.01
  } catch {
    return false
  }
}
