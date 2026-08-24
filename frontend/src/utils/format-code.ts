/**
 * format-code.ts
 *
 * 代码格式化工具（编辑器"格式化"操作的底层实现）。
 *
 * 设计要点：
 * - 优先使用 Prettier（standalone + 按需懒加载插件，不增加首屏包体积）
 * - Prettier 不支持的语言提供轻量内置回退（JSON / XML / 配置文件）
 * - 支持仅格式化选区：CodeMirror 的偏移量是 UTF-16 code unit，
 *   与 Prettier 的 rangeStart / rangeEnd 语义一致，可直接透传
 */

export interface FormatSelection {
  from: number
  to: number
}

export type FormatResult =
  { ok: true; formatted: string; unchanged: boolean } | { ok: false; error: string }

// ─── 常量 / 映射表 ───

/** Prettier 解析器 → 所需插件（全部动态 import，仅首次格式化时才加载） */
const PRETTIER_PARSERS: Record<string, { parser: string; plugins: string[] }> = {
  javascript: {
    parser: 'babel',
    plugins: ['prettier/plugins/babel', 'prettier/plugins/estree'],
  },
  jsx: {
    parser: 'babel',
    plugins: ['prettier/plugins/babel', 'prettier/plugins/estree'],
  },
  typescript: {
    parser: 'typescript',
    plugins: ['prettier/plugins/typescript', 'prettier/plugins/estree'],
  },
  tsx: {
    parser: 'typescript',
    plugins: ['prettier/plugins/typescript', 'prettier/plugins/estree'],
  },
  json: {
    parser: 'json',
    plugins: ['prettier/plugins/babel', 'prettier/plugins/estree'],
  },
  jsonc: {
    parser: 'jsonc',
    plugins: ['prettier/plugins/babel', 'prettier/plugins/estree'],
  },
  json5: {
    parser: 'json5',
    plugins: ['prettier/plugins/babel', 'prettier/plugins/estree'],
  },
  html: { parser: 'html', plugins: ['prettier/plugins/html'] },
  vue: { parser: 'vue', plugins: ['prettier/plugins/html'] },
  css: { parser: 'css', plugins: ['prettier/plugins/postcss'] },
  scss: { parser: 'scss', plugins: ['prettier/plugins/postcss'] },
  less: { parser: 'less', plugins: ['prettier/plugins/postcss'] },
  markdown: { parser: 'markdown', plugins: ['prettier/plugins/markdown'] },
  mdx: { parser: 'mdx', plugins: ['prettier/plugins/markdown'] },
  yaml: { parser: 'yaml', plugins: ['prettier/plugins/yaml'] },
  yml: { parser: 'yaml', plugins: ['prettier/plugins/yaml'] },
  graphql: { parser: 'graphql', plugins: ['prettier/plugins/graphql'] },
  angular: {
    parser: 'angular',
    plugins: ['prettier/plugins/html', 'prettier/plugins/glimmer'],
  },
  glimmer: { parser: 'glimmer', plugins: ['prettier/plugins/glimmer'] },
  xml: { parser: 'xml', plugins: [] },
}

/** 支持"仅格式化选区"（片段格式化）的语言 */
const RANGE_CAPABLE = new Set([
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'html',
  'vue',
  'css',
  'scss',
  'less',
  'markdown',
  'mdx',
  'graphql',
  'angular',
  'glimmer',
  'xml',
])

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  jsx: 'JSX',
  typescript: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  jsonc: 'JSONC',
  json5: 'JSON5',
  html: 'HTML',
  vue: 'Vue',
  css: 'CSS',
  scss: 'SCSS',
  less: 'LESS',
  markdown: 'Markdown',
  mdx: 'MDX',
  yaml: 'YAML',
  yml: 'YAML',
  xml: 'XML',
  graphql: 'GraphQL',
  angular: 'Angular',
  glimmer: 'Handlebars',
  nginx: 'Nginx',
  toml: 'TOML',
  ini: 'INI',
  conf: '配置',
  dotenv: 'dotenv',
  text: '文本',
}

function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] || language || '该文件'
}

/** 该语言是否支持格式化 */
export function isFormatSupported(language: string): boolean {
  const lang = (language || '').toLowerCase()
  if (
    lang === 'xml' ||
    lang === 'toml' ||
    lang === 'ini' ||
    lang === 'conf' ||
    lang === 'dotenv' ||
    lang === 'nginx'
  )
    return true
  return Boolean(PRETTIER_PARSERS[lang])
}

// ─── Prettier 懒加载 ───

interface PrettierModule {
  format: (source: string, options: Record<string, unknown>) => Promise<string>
}

let prettierCache: PrettierModule | null = null
const pluginCache = new Map<string, unknown>()

/**
 * Prettier 插件加载器（静态 import 映射）。
 *
 * 注意：不能写成 `await import(spec)` 变量形式 —— Rollup 无法静态分析
 * 变量动态导入，生产构建会保留裸说明符 `import('prettier/plugins/babel')`，
 * 浏览器运行时会直接报错。必须使用字面量的静态动态导入。
 */
const PRETTIER_PLUGIN_LOADERS: Record<string, () => Promise<unknown>> = {
  'prettier/plugins/babel': () => import('prettier/plugins/babel'),
  'prettier/plugins/estree': () => import('prettier/plugins/estree'),
  'prettier/plugins/typescript': () => import('prettier/plugins/typescript'),
  'prettier/plugins/html': () => import('prettier/plugins/html'),
  'prettier/plugins/postcss': () => import('prettier/plugins/postcss'),
  'prettier/plugins/markdown': () => import('prettier/plugins/markdown'),
  'prettier/plugins/yaml': () => import('prettier/plugins/yaml'),
  'prettier/plugins/graphql': () => import('prettier/plugins/graphql'),
  'prettier/plugins/glimmer': () => import('prettier/plugins/glimmer'),
}

async function loadPrettier(config: {
  parser: string
  plugins: string[]
}): Promise<PrettierModule> {
  if (!prettierCache) {
    const mod = await import('prettier/standalone')
    prettierCache = mod as unknown as PrettierModule
  }
  const plugins = await Promise.all(
    config.plugins.map(async (spec) => {
      let plugin = pluginCache.get(spec)
      if (!plugin) {
        const loader = PRETTIER_PLUGIN_LOADERS[spec]
        if (!loader) {
          throw new Error(`未知的 Prettier 插件: ${spec}`)
        }
        plugin = await loader()
        pluginCache.set(spec, plugin)
      }
      return plugin
    }),
  )
  const format = (source: string, options: Record<string, unknown>) =>
    prettierCache!.format(source, { ...options, parser: config.parser, plugins })
  return { format }
}

// ─── 内置回退：共享工具函数 ───

/** 合并连续空行（最多保留 1 行） */
function cleanBlankLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    if (!line && out.length > 0 && out[out.length - 1] === '') continue
    out.push(line)
  }
  return out
}

/** 去除末尾空行并追加换行符 */
function trimAndJoin(lines: string[]): string {
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

// ─── 内置回退：JSON / XML ───

/** JSON 兜底：JSON.parse + 2 空格缩进（Prettier 失败时使用） */
export function formatJsonNative(code: string): string | null {
  try {
    return JSON.stringify(JSON.parse(code), null, 2)
  } catch {
    return null
  }
}

/**
 * XML 轻量格式化（Prettier 不支持 XML）：
 * 按标签类型维护缩进层级；纯文本/CDATA/注释作为元素唯一子节点时保持内联。
 */
export function formatXml(code: string, indentSize = 2): string | null {
  try {
    type TokenType = 'special' | 'pi' | 'open' | 'close' | 'selfclose' | 'text'
    const tokens: { type: TokenType; value: string }[] = []
    const re =
      /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![\s\S]*?>|<\?[\s\S]*?\?>|<\/[^>]+>|<[^>]+>|[^<]+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      const value = m[0]
      let type: TokenType
      if (value.startsWith('<!--') || value.startsWith('<![CDATA[') || value.startsWith('<!')) {
        type = 'special'
      } else if (value.startsWith('<?')) {
        type = 'pi'
      } else if (value.startsWith('</')) {
        type = 'close'
      } else if (value.startsWith('<')) {
        type = /\/\s*>$/.test(value) ? 'selfclose' : 'open'
      } else {
        type = 'text'
      }
      tokens.push({ type, value })
    }

    const lines: string[] = []
    let depth = 0
    const pad = (n: number) => ' '.repeat(n * indentSize)
    const tagName = (tag: string) => /^<\/?([\w:.-]+)/.exec(tag)?.[1]?.toLowerCase() ?? null

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!
      if (t.type === 'open') {
        const next = tokens[i + 1]
        const after = tokens[i + 2]
        const inline =
          next !== undefined &&
          after !== undefined &&
          after.type === 'close' &&
          tagName(t.value) === tagName(after.value) &&
          (next.type === 'text' || next.type === 'special')
        if (inline) {
          const inner = next.type === 'text' ? next.value.trim() : next.value
          lines.push(pad(depth) + t.value + inner + after.value)
          i += 2
        } else {
          lines.push(pad(depth) + t.value)
          depth += 1
        }
      } else if (t.type === 'close') {
        depth = Math.max(0, depth - 1)
        lines.push(pad(depth) + t.value)
      } else if (t.type === 'selfclose' || t.type === 'pi' || t.type === 'special') {
        lines.push(pad(depth) + t.value)
      } else {
        const text = t.value.trim()
        if (text) lines.push(pad(depth) + text)
      }
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : null
  } catch {
    return null
  }
}

// ─── 内置回退：配置文件格式（TOML / INI / dotenv 共用） ───

interface KvConfigOptions {
  /** 注释起始字符，如 ['#'] 或 [';', '#'] */
  commentChars: string[]
  /** section 行正则（null 表示无 section，如 dotenv） */
  sectionRe: RegExp | null
  /** key-value 匹配正则（须含捕获组 1=key, 2=value） */
  kvRe: RegExp
  /** 格式化 key=value 输出 */
  kvFormat: (key: string, value: string) => string
}

/**
 * 通用 key-value 配置文件格式化器。
 * TOML / INI / dotenv 共用同一结构，仅语法细节不同。
 */
function formatKvConfig(code: string, opts: KvConfigOptions): string | null {
  try {
    const lines = code.split('\n')
    const result: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        result.push('')
        continue
      }

      // 注释
      if (opts.commentChars.some((c) => trimmed.startsWith(c))) {
        result.push(trimmed)
        continue
      }

      // [section] / [[array]]
      if (opts.sectionRe?.test(trimmed)) {
        result.push(trimmed)
        continue
      }

      // key = value
      const m = opts.kvRe.exec(trimmed)
      if (m) {
        result.push(opts.kvFormat(m[1]!, m[2]!))
        continue
      }

      result.push(trimmed)
    }

    return trimAndJoin(cleanBlankLines(result))
  } catch {
    return null
  }
}

/** TOML 简单格式化 */
export function formatToml(code: string): string | null {
  return formatKvConfig(code, {
    commentChars: ['#'],
    sectionRe: /^\[+.*\]+$/,
    kvRe: /^([\w.-]+)\s*=\s*(.*)$/,
    kvFormat: (k, v) => `${k} = ${v}`,
  })
}

/** INI/conf 简单格式化 */
export function formatIni(code: string): string | null {
  return formatKvConfig(code, {
    commentChars: [';', '#'],
    sectionRe: /^\[.*\]$/,
    kvRe: /^([\w.-]+)\s*[=:]\s*(.*)$/,
    kvFormat: (k, v) => `${k} = ${v}`,
  })
}

/** dotenv 简单格式化 */
export function formatDotenv(code: string): string | null {
  return formatKvConfig(code, {
    commentChars: ['#'],
    sectionRe: null,
    kvRe: /^([\w.-]+)\s*=\s*(.*)$/,
    kvFormat: (k, v) => `${k}=${v}`,
  })
}

/**
 * Nginx 配置格式化（block-based，非纯 key=value）：
 * - 指令缩进按 `{` / `}` 层级
 * - 注释 `#` 后统一加一个空格
 * - 空行去重
 */
export function formatNginx(code: string): string | null {
  try {
    const lines = code.split('\n')
    const result: string[] = []
    let depth = 0
    const pad = (n: number) => '  '.repeat(n)

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        result.push('')
        continue
      }

      // 注释：统一格式 "# comment"
      if (trimmed.startsWith('#')) {
        const afterHash = trimmed.slice(1)
        result.push(pad(depth) + '#' + (afterHash.startsWith(' ') ? afterHash : ' ' + afterHash))
        continue
      }

      // 闭合块 "}"
      if (trimmed === '}') {
        depth = Math.max(0, depth - 1)
        result.push(pad(depth) + '}')
        continue
      }

      // 开块 "directive {"
      if (trimmed.endsWith('{')) {
        result.push(pad(depth) + trimmed)
        depth += 1
        continue
      }

      result.push(pad(depth) + trimmed)
    }

    return trimAndJoin(cleanBlankLines(result))
  } catch {
    return null
  }
}

// ─── 主入口 ───

/**
 * 格式化代码。
 *
 * 返回的 formatted 始终是【完整文档】内容 —— 传入 selection 时
 * Prettier 会以 rangeStart/rangeEnd 限制只重排选区内的节点，
 * 但输出仍为整篇文档（选区外保持原样）。
 */
export async function formatCode(
  code: string,
  language: string,
  selection?: FormatSelection,
): Promise<FormatResult> {
  const lang = (language || '').toLowerCase()

  if (!code.trim()) {
    return { ok: true, formatted: code, unchanged: true }
  }

  // ─── Prettier 通道 ───
  const prettierConfig = PRETTIER_PARSERS[lang]
  if (prettierConfig) {
    try {
      const { format } = await loadPrettier(prettierConfig)
      const useRange = selection && RANGE_CAPABLE.has(lang)
      const formatted = await format(code, {
        printWidth: 100,
        semi: true,
        singleQuote: true,
        trailingComma: 'all',
        ...(useRange ? { rangeStart: selection!.from, rangeEnd: selection!.to } : {}),
      })
      return { ok: true, formatted, unchanged: formatted === code }
    } catch (prettierErr) {
      // XML / JSON 回退到原生格式化
      if (lang === 'xml') {
        const fb = formatXml(code)
        if (fb !== null) return { ok: true, formatted: fb, unchanged: fb === code }
      }
      if (lang === 'json' || lang === 'jsonc' || lang === 'json5') {
        const fb = formatJsonNative(code)
        if (fb !== null) return { ok: true, formatted: fb, unchanged: fb === code }
      }
      const detail = prettierErr instanceof Error ? prettierErr.message : '解析失败'
      return { ok: false, error: `${languageLabel(lang)} 语法错误: ${detail}` }
    }
  }

  // ─── 内置回退通道 ───
  const fallbacks: Record<string, () => string | null> = {
    toml: () => formatToml(code),
    ini: () => formatIni(code),
    conf: () => formatIni(code),
    dotenv: () => formatDotenv(code),
    nginx: () => formatNginx(code),
  }

  const fallback = fallbacks[lang]
  if (fallback) {
    const formatted = fallback()
    if (formatted !== null) {
      return { ok: true, formatted, unchanged: formatted === code }
    }
    return { ok: false, error: `${languageLabel(lang)} 解析失败` }
  }

  return { ok: false, error: `暂不支持格式化 ${languageLabel(lang)} 文件` }
}
