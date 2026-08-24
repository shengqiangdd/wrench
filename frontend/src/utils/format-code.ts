/**
 * format-code.ts
 *
 * 代码格式化工具（编辑器"格式化"操作的底层实现）。
 *
 * 设计要点：
 * - 优先使用 Prettier（standalone + 按需懒加载插件，不增加首屏包体积）
 * - Prettier 不支持的语言提供轻量内置回退（JSON / XML）
 * - 支持仅格式化选区：CodeMirror 的偏移量是 UTF-16 code unit，
 *   与 Prettier 的 rangeStart / rangeEnd 语义一致，可直接透传
 */

export interface FormatSelection {
  from: number
  to: number
}

export type FormatResult =
  { ok: true; formatted: string; unchanged: boolean } | { ok: false; error: string }

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
  if (lang === 'xml' || lang === 'toml' || lang === 'ini' || lang === 'conf' || lang === 'dotenv' || lang === 'nginx')
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
        // 传模块命名空间本身（含 parsers / printers / languages / options）
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

// ─── 内置回退：JSON / XML ───

/** JSON 兜底：JSON.parse + 2 空格缩进（Prettier 失败时使用） */
export function formatJsonNative(code: string): string | null {
  try {
    const parsed = JSON.parse(code)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return null
  }
}

/**
 * XML 轻量格式化（Prettier 不支持 XML）：
 * 按标签类型维护缩进层级；纯文本/CDATA/注释作为元素唯一子节点时保持内联。
 * 仅作为尽力而为的工具，解析异常时返回 null。
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
        type = 'special' // 注释 / CDATA / DOCTYPE
      } else if (value.startsWith('<?')) {
        type = 'pi' // XML 声明 / 处理指令
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
        // 简单元素（唯一子节点为文本/CDATA/注释）保持单行：<a>text</a>
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
        if (text) {
          lines.push(pad(depth) + text)
        }
      }
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : null
  } catch {
    return null
  }
}

// ─── 内置回退：配置文件格式 ───

/** TOML 简单格式化：按 section 分组，key=value 对齐缩进 */
export function formatToml(code: string): string | null {
  try {
    const lines = code.split('\n')
    const result: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        continue
      }

      // [section] 或 [[array]]
      if (/^\[+.*\]+$/.test(trimmed)) {
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        result.push(trimmed)
        continue
      }

      // key = value / key = [inline] / key = "string"
      const kvMatch = /^([\w.-]+)\s*=\s*(.*)$/.exec(trimmed)
      if (kvMatch) {
        result.push(`${kvMatch[1]} = ${kvMatch[2]}`)
        continue
      }

      // 注释或其他行原样保留
      result.push(trimmed)
    }

    // 去除末尾多余空行
    while (result.length > 0 && result[result.length - 1] === '') {
      result.pop()
    }

    return result.join('\n') + '\n'
  } catch {
    return null
  }
}

/** INI/conf 简单格式化：section 对齐，key=value 间距统一 */
export function formatIni(code: string): string | null {
  try {
    const lines = code.split('\n')
    const result: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        continue
      }

      // 注释行原样保留
      if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
        result.push(trimmed)
        continue
      }

      // [section]
      if (/^\[.*\]$/.test(trimmed)) {
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        result.push(trimmed)
        continue
      }

      // key = value
      const kvMatch = /^([\w.-]+)\s*[=:]\s*(.*)$/.exec(trimmed)
      if (kvMatch) {
        result.push(`${kvMatch[1]} = ${kvMatch[2]}`)
        continue
      }

      result.push(trimmed)
    }

    while (result.length > 0 && result[result.length - 1] === '') {
      result.pop()
    }

    return result.join('\n') + '\n'
  } catch {
    return null
  }
}

/** dotenv 简单格式化：去重空行、注释对齐 */
export function formatDotenv(code: string): string | null {
  try {
    const lines = code.split('\n')
    const result: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) {
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        continue
      }

      // 注释
      if (trimmed.startsWith('#')) {
        result.push(trimmed)
        continue
      }

      // KEY=VALUE
      const kvMatch = /^([\w.-]+)\s*=\s*(.*)$/.exec(trimmed)
      if (kvMatch) {
        result.push(`${kvMatch[1]}=${kvMatch[2]}`)
        continue
      }

      result.push(trimmed)
    }

    while (result.length > 0 && result[result.length - 1] === '') {
      result.pop()
    }

    return result.join('\n') + '\n'
  } catch {
    return null
  }
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
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('')
        }
        continue
      }

      // 注释：统一格式 "# comment"
      if (trimmed.startsWith('#')) {
        const afterHash = trimmed.slice(1)
        result.push(pad(depth) + '#' + (afterHash.startsWith(' ') ? afterHash : ' ' + afterHash))
        continue
      }

      // 闭合块 "}" — 先减层级
      if (trimmed === '}') {
        depth = Math.max(0, depth - 1)
        result.push(pad(depth) + '}')
        continue
      }

      // 包含开块 "directive ... {" — 指令行 + 开括号同行
      if (trimmed.endsWith('{')) {
        result.push(pad(depth) + trimmed)
        depth += 1
        continue
      }

      // 其他指令
      result.push(pad(depth) + trimmed)
    }

    while (result.length > 0 && result[result.length - 1] === '') {
      result.pop()
    }

    return result.join('\n') + '\n'
  } catch {
    return null
  }
}

// ─── 主入口 ───

/**
 * 格式化代码。
 *
 * 注意：返回的 formatted 始终是【完整文档】内容 —— 传入 selection 时
 * Prettier 会以 rangeStart/rangeEnd 限制只重排选区内的节点，
 * 但输出仍为整篇文档（选区外保持原样）。调用方直接用它替换整个文档即可。
 *
 * @param code      待格式化内容
 * @param language  语言标识（与编辑器 tab.language 一致）
 * @param selection 可选选区（UTF-16 code unit 偏移）。仅 RANGE_CAPABLE 语言生效；
 *                  其余语言忽略选区、格式化整个文档
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
      // Prettier 解析失败时，XML 回退到原生格式化
      if (lang === 'xml') {
        const fallback = formatXml(code)
        if (fallback !== null) {
          return { ok: true, formatted: fallback, unchanged: fallback === code }
        }
      }
      // JSON 族语言回退到原生格式化
      if (lang === 'json' || lang === 'jsonc' || lang === 'json5') {
        const fallback = formatJsonNative(code)
        if (fallback !== null) {
          return { ok: true, formatted: fallback, unchanged: fallback === code }
        }
      }
      const detail = prettierErr instanceof Error ? prettierErr.message : '解析失败'
      return { ok: false, error: `${languageLabel(lang)} 语法错误: ${detail}` }
    }
  }

  // ─── 内置回退：配置文件格式 ───
  if (lang === 'toml') {
    const formatted = formatToml(code)
    if (formatted !== null) {
      return { ok: true, formatted, unchanged: formatted === code }
    }
    return { ok: false, error: 'TOML 解析失败' }
  }

  if (lang === 'ini' || lang === 'conf') {
    const formatted = formatIni(code)
    if (formatted !== null) {
      return { ok: true, formatted, unchanged: formatted === code }
    }
    return { ok: false, error: `${languageLabel(lang)} 解析失败` }
  }

  if (lang === 'nginx') {
    const formatted = formatNginx(code)
    if (formatted !== null) {
      return { ok: true, formatted, unchanged: formatted === code }
    }
    return { ok: false, error: 'Nginx 配置解析失败' }
  }

  if (lang === 'dotenv') {
    const formatted = formatDotenv(code)
    if (formatted !== null) {
      return { ok: true, formatted, unchanged: formatted === code }
    }
    return { ok: false, error: 'dotenv 解析失败' }
  }

  return { ok: false, error: `暂不支持格式化 ${languageLabel(lang)} 文件` }
}
