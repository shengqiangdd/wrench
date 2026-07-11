/**
 * content-sniff.ts — 文件内容嗅探
 *
 * 1. 语言嗅探：当扩展名无法确定语言类型时，从内容推断。
 * 2. 媒体类型嗅探：当扩展名不明确时，从内容特征判断图片/视频/音频等。
 *    核心场景：.face.icon（SVG）、无扩展名图片、扩展名被改错的媒体文件。
 */

// ─── Shebang 检测 ───

/** shebang 行 → 语言标识（CodeMirror 格式） */
const SHEBANG_MAP: Record<string, string> = {
  '/usr/bin/node': 'javascript',
  '/usr/local/bin/node': 'javascript',
  '/usr/bin/env node': 'javascript',
  '/bin/node': 'javascript',
  '/usr/bin/python': 'python',
  '/usr/bin/python3': 'python',
  '/usr/bin/env python': 'python',
  '/usr/bin/env python3': 'python',
  '/usr/bin/env bash': 'shell',
  '/usr/bin/bash': 'shell',
  '/bin/bash': 'shell',
  '/usr/bin/env sh': 'shell',
  '/bin/sh': 'shell',
  '/usr/bin/env zsh': 'shell',
  '/bin/zsh': 'shell',
  '/usr/bin/env fish': 'shell',
  '/usr/bin/env ruby': 'ruby',
  '/usr/bin/env perl': 'perl',
  '/usr/bin/env lua': 'lua',
  '/usr/bin/env deno': 'typescript',
  '/usr/bin/env bun': 'javascript',
}

/** 从 shebang 行解析语言 */
function sniffShebang(firstLine: string): string | null {
  const trimmed = firstLine.trim()
  if (!trimmed.startsWith('#!')) return null
  const afterShebang = trimmed.slice(2).trim()

  if (afterShebang.startsWith('/usr/bin/env ')) {
    const parts = afterShebang.slice('/usr/bin/env '.length).trim().split(/\s+/)
    const interpreter = parts[0]
    if (!interpreter) return null
    for (const [key, val] of Object.entries(SHEBANG_MAP)) {
      if (key.startsWith('/usr/bin/env ') && key.endsWith(interpreter)) {
        return val
      }
    }
  }

  for (const [key, val] of Object.entries(SHEBANG_MAP)) {
    if (
      !key.startsWith('/usr/bin/env ') &&
      (afterShebang.startsWith(key) || afterShebang === key)
    ) {
      return val
    }
  }

  return null
}

// ─── Magic Bytes 检测 ───

interface MagicSignature {
  match: number[]
  name: string
  language: string
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'archive' | 'database' | 'binary'
}

/** 文件内容头部字节 → 文件类型 / 语言 / 媒体类型 */
const MAGIC_SIGNATURES: MagicSignature[] = [
  // 图片
  { match: [0x89, 0x50, 0x4e, 0x47], name: 'PNG Image', language: 'text', mediaType: 'image' },
  { match: [0xff, 0xd8, 0xff], name: 'JPEG Image', language: 'text', mediaType: 'image' },
  { match: [0x47, 0x49, 0x46, 0x38], name: 'GIF Image', language: 'text', mediaType: 'image' },
  { match: [0x52, 0x49, 0x46, 0x46], name: 'RIFF (WebP/WAV/AVI)', language: 'text', mediaType: 'image' },
  { match: [0x42, 0x4d], name: 'BMP Image', language: 'text', mediaType: 'image' },

  // 视频
  { match: [0x1a, 0x45, 0xdf, 0xa3], name: 'MKV/WebM/MP4', language: 'text', mediaType: 'video' },

  // 音频
  { match: [0x49, 0x44, 0x33], name: 'MP3 Audio', language: 'text', mediaType: 'audio' },
  { match: [0xff, 0xfb], name: 'MP3 Audio', language: 'text', mediaType: 'audio' },
  { match: [0xff, 0xf3], name: 'MP3 Audio', language: 'text', mediaType: 'audio' },
  { match: [0xff, 0xf2], name: 'MP3 Audio', language: 'text', mediaType: 'audio' },
  { match: [0x66, 0x4c, 0x61, 0x43], name: 'FLAC Audio', language: 'text', mediaType: 'audio' },
  { match: [0x4f, 0x67, 0x67, 0x53], name: 'OGG Audio', language: 'text', mediaType: 'audio' },

  // 文档
  { match: [0x25, 0x50, 0x44, 0x46], name: 'PDF Document', language: 'text', mediaType: 'document' },
  { match: [0x50, 0x4b, 0x03, 0x04], name: 'ZIP/DOCX/XLSX', language: 'text', mediaType: 'archive' },

  // 压缩
  { match: [0x1f, 0x8b], name: 'GZIP Archive', language: 'text', mediaType: 'archive' },
  { match: [0x42, 0x5a, 0x68], name: 'BZIP2 Archive', language: 'text', mediaType: 'archive' },

  // ELF/可执行
  { match: [0x7f, 0x45, 0x4c, 0x46], name: 'ELF Binary', language: 'text', mediaType: 'binary' },

  // SQLite 数据库
  { match: [0x53, 0x51, 0x4c, 0x69], name: 'SQLite Database', language: 'text', mediaType: 'database' },
]

/** 从二进制头部检测 magic bytes */
function sniffMagic(headBytes: Uint8Array): MagicSignature | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.match.length > headBytes.length) continue
    let ok = true
    for (let i = 0; i < sig.match.length; i++) {
      if (sig.match[i] !== -1 && sig.match[i] !== headBytes[i]) {
        ok = false
        break
      }
    }
    if (ok) return sig
  }
  return null
}

// ─── 文本内容模式检测（SVG/XML/JSON/HTML） ───

/** 检测文本内容是否为 SVG（扩展名不明确时使用） */
function isSvgContent(content: string): boolean {
  const head = content.slice(0, 2000).trim()
  if (/^<svg[\s>]/i.test(head)) return true
  if (/^<\?xml[^>]*\?>\s*<svg[\s>]/i.test(head)) return true
  if (/^<!DOCTYPE[^>]*svg[^>]*>/i.test(head)) return true
  return false
}

/** 检测文本内容是否为 JSON */
function isJsonContent(content: string): boolean {
  const head = content.slice(0, 1000).trim()
  if (head.startsWith('{') || head.startsWith('[')) {
    try {
      JSON.parse(head.length < 500 ? head : content.slice(0, 5000))
      return true
    } catch {
      return false
    }
  }
  return false
}

/** 检测文本内容是否为 HTML */
function isHtmlContent(content: string): boolean {
  const head = content.slice(0, 1000).trim()
  return /^<!DOCTYPE\s+html>/i.test(head) || /^<html[\s>]/i.test(head)
}

// ─── 无后缀文件名模式匹配 ───

const NAMED_FILE_MAP: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  justfile: 'makefile',
  '.gitignore': 'text',
  '.gitattributes': 'text',
  '.gitmodules': 'ini',
  '.npmrc': 'ini',
  '.yarnrc': 'yaml',
  '.prettierrc': 'json',
  '.eslintrc': 'javascript',
  '.babelrc': 'json',
  '.editorconfig': 'ini',
  '.env': 'dotenv',
  '.env.example': 'dotenv',
  '.dockerignore': 'text',
  'package-lock.json': 'json',
  'yarn.lock': 'yaml',
  'pnpm-lock.yaml': 'yaml',
  'composer.lock': 'json',
  'Cargo.lock': 'toml',
  'Gemfile.lock': 'ruby',
}

// ═══════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════

export interface SniffResult {
  /** CodeMirror 使用的语言标识 */
  language: string
  /** 人类可读的文件类型描述 */
  typeName?: string
  /** 推断依据 */
  method: 'extension' | 'shebang' | 'magic' | 'filename' | 'content'
}

/**
 * 综合内容嗅探 — 语言
 */
export function sniffLanguage(filename: string, content?: string): SniffResult {
  const basename = filename.toLowerCase()

  // 1. 已知文件名模式
  const namedMatch = NAMED_FILE_MAP[basename]
  if (namedMatch) {
    return { language: namedMatch, method: 'filename' }
  }

  // 2. shebang 嗅探
  if (content && content.length > 0) {
    const firstLine = content.split('\n')[0]!
    const shebangLang = sniffShebang(firstLine)
    if (shebangLang) {
      return { language: shebangLang, method: 'shebang' }
    }
  }

  // 3. magic bytes 嗅探
  if (content) {
    const encoder = new TextEncoder()
    const headBytes = encoder.encode(content.slice(0, 16))
    const magicSig = sniffMagic(headBytes)
    if (magicSig) {
      return { language: magicSig.language, typeName: magicSig.name, method: 'magic' }
    }
  }

  // 4. 文本内容模式检测
  if (content && content.length > 0) {
    if (isSvgContent(content)) {
      return { language: 'xml', typeName: 'SVG Image', method: 'content' }
    }
    if (isHtmlContent(content)) {
      return { language: 'html', typeName: 'HTML', method: 'content' }
    }
    if (isJsonContent(content)) {
      return { language: 'json', typeName: 'JSON', method: 'content' }
    }
  }

  return { language: 'text', method: 'extension' }
}

/**
 * 从内容头部获取文件类型描述
 */
export function sniffFileType(content: string): string | null {
  if (!content) return null

  const firstLine = content.split('\n')[0]!.trim()
  if (firstLine.startsWith('#!')) {
    const interpreter = firstLine.slice(2).trim()
    return `${interpreter} script`
  }

  const encoder = new TextEncoder()
  const headBytes = encoder.encode(content.slice(0, 16))
  const sig = sniffMagic(headBytes)
  if (sig) return sig.name

  return null
}

// ═══════════════════════════════════════════════
//  媒体类型嗅探（核心新增）
// ═══════════════════════════════════════════════

export type MediaType = 'image' | 'video' | 'audio' | 'svg' | 'document' | 'text' | 'unknown'

/**
 * 从文件内容嗅探实际媒体类型
 *
 * 解决的核心问题：扩展名与内容不匹配（如 .face.icon 实际是 SVG）
 *
 * @param content    文件内容（文本字符串或 ArrayBuffer）
 * @param isBinary   是否被标记为二进制文件
 */
export function sniffMediaType(
  content: string | ArrayBuffer | null,
  isBinary: boolean,
): MediaType {
  if (!content) return 'unknown'

  // ── 二进制内容（ArrayBuffer）：magic bytes 检测 ──
  if (isBinary && content instanceof ArrayBuffer) {
    const head = new Uint8Array(content.slice(0, 16))
    const sig = sniffMagic(head)
    if (sig?.mediaType === 'image') return 'image'
    if (sig?.mediaType === 'video') return 'video'
    if (sig?.mediaType === 'audio') return 'audio'
    if (sig?.mediaType === 'document') return 'document'
    return 'unknown'
  }

  // ── 二进制内容（base64 字符串）：解码后检测 ──
  if (isBinary && typeof content === 'string') {
    const b64 = content.includes(',') ? content.split(',')[1]! : content
    try {
      const raw = atob(b64.slice(0, 1000))
      const head = new Uint8Array([...raw].map((c) => c.charCodeAt(0)))
      const sig = sniffMagic(head)
      if (sig?.mediaType === 'image') return 'image'
      if (sig?.mediaType === 'video') return 'video'
      if (sig?.mediaType === 'audio') return 'audio'
      if (sig?.mediaType === 'document') return 'document'
    } catch {
      // 不是有效的 base64，跳过
    }
    return 'unknown'
  }

  // ── 文本内容：模式检测 ──
  if (typeof content === 'string') {
    if (isSvgContent(content)) return 'svg'
    if (isHtmlContent(content)) return 'text'
    if (isJsonContent(content)) return 'text'
    return 'text'
  }

  return 'unknown'
}

/**
 * 从文本内容判断是否为 SVG
 */
export function isSvgText(content: string): boolean {
  return isSvgContent(content)
}

// ═══════════════════════════════════════════════
//  综合文件分类
// ═══════════════════════════════════════════════

export type FileCategory =
  | 'image'
  | 'svg'
  | 'video'
  | 'audio'
  | 'document'
  | 'code'
  | 'text'
  | 'binary'
  | 'archive'

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'heic', 'heif',
  'tiff', 'tif', 'raw', 'cr2', 'nef', 'arw', 'dng', 'psd', 'xcf',
])
const VIDEO_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'ogv', 'mov', 'mkv', 'avi', 'wmv', 'flv',
  'm4v', '3gp', 'mpeg', 'mpg',
])
const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'wma', 'ape',
  'aiff', 'mid', 'midi',
])
const ARCHIVE_EXTS = new Set([
  'zip', 'tar', 'gz', 'bz2', 'xz', 'lz', 'lzma', 'zst', 'br',
  'rar', '7z', 'cab', 'iso', 'dmg', 'deb', 'rpm', 'apk', 'msi',
])
const DOC_EXTS = new Set(['pdf'])
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'json', 'yaml', 'yml',
  'toml', 'ini', 'conf', 'sh', 'bash', 'zsh', 'fish', 'rb', 'php',
  'swift', 'kt', 'vue', 'svelte', 'sql', 'md', 'rst', 'tex', 'vim',
])

/**
 * 从文件扩展名 + 内容综合判断文件类型
 *
 * 返回确定的分类 + 置信度（high = 扩展名匹配，low = 仅内容嗅探）
 */
export function classifyFile(
  filename: string,
  ext: string,
  content: string | ArrayBuffer | null,
  isBinary: boolean,
): { category: FileCategory; confidence: 'high' | 'low' } {
  // ── 扩展名高置信度检测 ──
  if (ext === 'svg' || ext === 'svgz') {
    return { category: 'svg', confidence: 'high' }
  }
  if (IMAGE_EXTS.has(ext)) {
    return { category: 'image', confidence: 'high' }
  }
  if (VIDEO_EXTS.has(ext)) {
    return { category: 'video', confidence: 'high' }
  }
  if (AUDIO_EXTS.has(ext)) {
    return { category: 'audio', confidence: 'high' }
  }
  if (DOC_EXTS.has(ext)) {
    return { category: 'document', confidence: 'high' }
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return { category: 'archive', confidence: 'high' }
  }
  if (CODE_EXTS.has(ext)) {
    return { category: 'code', confidence: 'high' }
  }

  // ── 扩展名不匹配：内容嗅探（低置信度） ──
  if (!content) {
    return { category: 'binary', confidence: 'low' }
  }

  if (typeof content === 'string') {
    if (isSvgContent(content)) return { category: 'svg', confidence: 'low' }
    if (isHtmlContent(content)) return { category: 'code', confidence: 'low' }
    if (isJsonContent(content)) return { category: 'code', confidence: 'low' }

    const textRatio = calculateTextRatio(content.slice(0, 2000))
    if (textRatio > 0.9) {
      return { category: 'text', confidence: 'low' }
    }
    return { category: 'binary', confidence: 'low' }
  }

  if (content instanceof ArrayBuffer && isBinary) {
    const head = new Uint8Array(content.slice(0, 16))
    const sig = sniffMagic(head)
    if (sig?.mediaType === 'image') return { category: 'image', confidence: 'low' }
    if (sig?.mediaType === 'video') return { category: 'video', confidence: 'low' }
    if (sig?.mediaType === 'audio') return { category: 'audio', confidence: 'low' }
    if (sig?.mediaType === 'document') return { category: 'document', confidence: 'low' }
    if (sig?.mediaType === 'archive') return { category: 'archive', confidence: 'low' }
  }

  return { category: 'binary', confidence: 'low' }
}

/** 计算文本中可打印字符的比例 */
function calculateTextRatio(text: string): number {
  if (text.length === 0) return 0
  let printable = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (
      (code >= 0x20 && code <= 0x7e) ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      code >= 0x00a0
    ) {
      printable++
    }
  }
  return printable / text.length
}
