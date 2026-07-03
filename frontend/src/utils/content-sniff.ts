/**
 * content-sniff.ts — 文件内容嗅探
 *
 * 当扩展名无法确定语言类型时（无后缀/未知后缀），
 * 从文件内容头部推断编程语言、文件类型等。
 * 同时辅助 getFileIcon 做图标映射。
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
  // 去掉可能的 BOM 和前导空格
  const trimmed = firstLine.trim()

  // #!/usr/bin/env node
  if (!trimmed.startsWith('#!')) return null

  const afterShebang = trimmed.slice(2).trim()

  // 处理 /usr/bin/env <interpreter> 格式
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

  // 处理 /bin/<interpreter> 格式
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

/** 文件内容头部字节 → 文件类型 / 语言 */
const MAGIC_SIGNATURES: Array<{
  match: number[] // 匹配字节序列（用 -1 表示通配）
  name: string // 文件类型名
  language: string // CodeMirror 语言标识
}> = [
  // 图片
  { match: [0x89, 0x50, 0x4e, 0x47], name: 'PNG Image', language: 'text' },
  { match: [0xff, 0xd8, 0xff], name: 'JPEG Image', language: 'text' },
  { match: [0x47, 0x49, 0x46, 0x38], name: 'GIF Image', language: 'text' },
  { match: [0x52, 0x49, 0x46, 0x46], name: 'WebP Image', language: 'text' },
  { match: [0x42, 0x4d], name: 'BMP Image', language: 'text' },

  // 文档
  { match: [0x25, 0x50, 0x44, 0x46], name: 'PDF Document', language: 'text' },
  { match: [0x50, 0x4b, 0x03, 0x04], name: 'ZIP/DOCX/XLSX', language: 'text' },

  // 压缩
  { match: [0x1f, 0x8b], name: 'GZIP Archive', language: 'text' },
  { match: [0x42, 0x5a, 0x68], name: 'BZIP2 Archive', language: 'text' },

  // ELF/可执行
  { match: [0x7f, 0x45, 0x4c, 0x46], name: 'ELF Binary', language: 'text' },

  // SQLite 数据库
  { match: [0x53, 0x51, 0x4c, 0x69], name: 'SQLite Database', language: 'text' },
]

/** 从二进制头部检测 magic bytes */
function sniffMagic(headBytes: Uint8Array): string | null {
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.match.length > headBytes.length) continue
    let match = true
    for (let i = 0; i < sig.match.length; i++) {
      if (sig.match[i] !== -1 && sig.match[i] !== headBytes[i]) {
        match = false
        break
      }
    }
    if (match) return sig.language
  }
  return null
}

// ─── 无后缀文件名模式匹配 ───

/** 常见的无后缀文件名 → 语言映射 */
const NAMED_FILE_MAP: Record<string, string> = {
  // 构建/配置
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  justfile: 'makefile',

  // 配置文件
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

  // 包管理器锁文件
  'package-lock.json': 'json',
  'yarn.lock': 'yaml',
  'pnpm-lock.yaml': 'yaml',
  'composer.lock': 'json',
  'Cargo.lock': 'toml',
  'Gemfile.lock': 'ruby',
}

// ─── 主入口 ───

export interface SniffResult {
  /** CodeMirror 使用的语言标识，如 'javascript', 'python', 'text' */
  language: string
  /** 人类可读的文件类型描述 */
  typeName?: string
  /** 推断依据：'extension' | 'shebang' | 'magic' | 'filename' */
  method: 'extension' | 'shebang' | 'magic' | 'filename'
}

/**
 * 综合内容嗅探 — 按优先级：
 * 1. 扩展名映射（最高优先级）
 * 2. 已知文件名（无后缀文件如 Dockerfile）
 * 3. shebang 行（脚本文件）
 * 4. magic bytes（二进制文件头部）
 *
 * @param filename  文件名
 * @param content   文件内容（可选，提供后启用 3 和 4）
 * @returns SniffResult
 */
export function sniffLanguage(filename: string, content?: string): SniffResult {
  const ext = filename.split('.').pop()?.toLowerCase()
  const basename = filename.toLowerCase()

  // 1. 先用扩展名判断（兜底 LANGUAGE_MAP 已在 SftpBrowser 中）
  //    这里只处理扩展名已知但"未识别"的情形
  if (ext && ext !== basename) {
    // 有扩展名但不一定在 LANGUAGE_MAP 中 => 交给 SftpBrowser 的 detectLanguage
    // 这里不做重复判断
  }

  // 2. 已知文件名模式（无后缀或特殊文件名）
  const namedMatch = NAMED_FILE_MAP[basename]
  if (namedMatch) {
    return { language: namedMatch, method: 'filename' }
  }

  // 3. 如果有内容，做 shebang 嗅探
  if (content && content.length > 0) {
    const firstLine = content.split('\n')[0]!
    const shebangLang = sniffShebang(firstLine)
    if (shebangLang) {
      return { language: shebangLang, method: 'shebang' }
    }
  }

  // 4. 如果有内容（二进制），做 magic bytes 嗅探
  if (content) {
    // 将前几个字符转为字节判断
    const encoder = new TextEncoder()
    const headBytes = encoder.encode(content.slice(0, 16))
    const magicLang = sniffMagic(headBytes)
    if (magicLang) {
      return { language: magicLang, method: 'magic' }
    }
  }

  return { language: 'text', method: 'extension' }
}

/**
 * 从内容头部获取文件类型描述（用于信息展示）
 */
export function sniffFileType(content: string): string | null {
  if (!content) return null

  // Shebang
  const firstLine = content.split('\n')[0]!.trim()
  if (firstLine.startsWith('#!')) {
    const interpreter = firstLine.slice(2).trim()
    return `${interpreter} script`
  }

  // Magic bytes
  const encoder = new TextEncoder()
  const headBytes = encoder.encode(content.slice(0, 16))
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.match.length > headBytes.length) continue
    let match = true
    for (let i = 0; i < sig.match.length; i++) {
      if (sig.match[i] !== -1 && sig.match[i] !== headBytes[i]) {
        match = false
        break
      }
    }
    if (match) return sig.name
  }

  return null
}
