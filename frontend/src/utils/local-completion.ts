import {
  CompletionContext,
  snippetCompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'

export interface LocalCompletionOptions {
  from: number
  options: readonly Completion[]
}

interface LocalTemplate {
  label: string
  detail: string
  type: Completion['type']
  template: string
  keywords?: readonly string[]
}

const LANGUAGE_ALIASES: Record<string, string> = {
  javascript: 'javascript',
  js: 'javascript',
  jsx: 'javascript',
  typescript: 'typescript',
  ts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  python: 'python',
  py: 'python',
  markdown: 'markdown',
  md: 'markdown',
  mdx: 'markdown',
  rust: 'rust',
  rs: 'rust',
  shell: 'shell',
  bash: 'shell',
  sh: 'shell',
  zsh: 'shell',
}

const TEMPLATES: Record<string, readonly LocalTemplate[]> = {
  common: [
    {
      label: 'todo',
      detail: '本地注释模板',
      type: 'text',
      template: 'TODO: ${说明}',
    },
  ],
  javascript: [
    {
      label: 'function',
      detail: '函数模板',
      type: 'keyword',
      template: 'function ${name}(${args}) {\n  ${body}\n}',
    },
    {
      label: 'arrow',
      detail: '箭头函数模板',
      type: 'keyword',
      template: 'const ${name} = (${args}) => {\n  ${body}\n}',
    },
    {
      label: 'trycatch',
      detail: '错误处理模板',
      type: 'keyword',
      template: 'try {\n  ${body}\n} catch (error) {\n  console.error(error)\n}',
    },
    {
      label: 'import',
      detail: '导入模板',
      type: 'keyword',
      template: "import { ${name} } from '${module}'",
    },
  ],
  typescript: [
    {
      label: 'interface',
      detail: '接口模板',
      type: 'type',
      template: 'interface ${Name} {\n  ${property}: ${Type}\n}',
    },
    {
      label: 'type',
      detail: '类型别名模板',
      type: 'type',
      template: 'type ${Name} = {\n  ${property}: ${Type}\n}',
    },
  ],
  json: [
    {
      label: 'object',
      detail: 'JSON 对象模板',
      type: 'keyword',
      template: '{\n  "${key}": ${value}\n}',
    },
    {
      label: 'array',
      detail: 'JSON 数组模板',
      type: 'keyword',
      template: '[\n  ${value}\n]',
    },
    {
      label: 'property',
      detail: 'JSON 属性模板',
      type: 'property',
      template: '"${key}": ${value}',
    },
  ],
  python: [
    {
      label: 'def',
      detail: '函数模板',
      type: 'keyword',
      template: 'def ${name}(${args}):\n    ${body}',
    },
    {
      label: 'class',
      detail: '类模板',
      type: 'class',
      template: 'class ${Name}:\n    def __init__(self${args}):\n        ${body}',
    },
    {
      label: 'ifmain',
      detail: '模块入口模板',
      type: 'keyword',
      template: "if __name__ == '__main__':\n    ${body}",
    },
    {
      label: 'tryexcept',
      detail: '错误处理模板',
      type: 'keyword',
      template: 'try:\n    ${body}\nexcept ${Error} as error:\n    print(error)',
    },
  ],
  rust: [
    {
      label: 'fn',
      detail: '函数模板',
      type: 'keyword',
      template: 'fn ${name}(${args}) -> ${Return} {\n    ${body}\n}',
    },
    {
      label: 'struct',
      detail: '结构体模板',
      type: 'type',
      template: 'struct ${Name} {\n    ${field}: ${Type},\n}',
    },
    {
      label: 'match',
      detail: '模式匹配模板',
      type: 'keyword',
      template: 'match ${value} {\n    ${pattern} => ${result},\n    _ => ${fallback},\n}',
    },
    {
      label: 'impl',
      detail: '实现块模板',
      type: 'keyword',
      template: 'impl ${Type} {\n    ${body}\n}',
    },
  ],
  shell: [
    {
      label: 'shebang',
      detail: 'Shell 入口模板',
      type: 'keyword',
      template: '#!/usr/bin/env bash\nset -euo pipefail\n\n${body}',
    },
    {
      label: 'for',
      detail: '循环模板',
      type: 'keyword',
      template: 'for ${item} in ${items}; do\n  ${body}\ndone',
    },
    {
      label: 'if',
      detail: '条件模板',
      type: 'keyword',
      template: 'if [[ ${condition} ]]; then\n  ${body}\nfi',
    },
  ],
  markdown: [
    {
      label: 'heading',
      detail: '标题模板',
      type: 'text',
      template: '## ${标题}',
    },
    {
      label: 'codeblock',
      detail: '代码块模板',
      type: 'text',
      template: '``` ${language}\n${code}\n```',
    },
    {
      label: 'task',
      detail: '任务列表模板',
      type: 'text',
      template: '- [ ] ${任务}',
    },
  ],
}

const COMMON_WORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'class',
  'interface',
  'type',
  'def',
  'fn',
  'struct',
  'match',
  'if',
  'else',
  'for',
  'while',
  'true',
  'false',
  'null',
  'undefined',
])

export function normalizeCompletionLanguage(language: string, fileName = ''): string {
  const fromLanguage = LANGUAGE_ALIASES[language.toLowerCase()]
  if (fromLanguage) return fromLanguage

  const extension = fileName.toLowerCase().split('.').pop() || ''
  return LANGUAGE_ALIASES[extension] || language.toLowerCase()
}

function templateOptions(language: string): Completion[] {
  const templates = [...(TEMPLATES.common || []), ...(TEMPLATES[language] || [])]
  if (language === 'typescript') templates.push(...(TEMPLATES.javascript || []))
  return templates.map(({ label, detail, type, template }) =>
    snippetCompletion(template, { label, detail, type }),
  )
}

function symbolOptions(doc: string, prefix: string): Completion[] {
  const symbols = new Set<string>()
  const identifierPattern = /\b[A-Za-z_$][\w$]*\b/g
  for (const match of doc.matchAll(identifierPattern)) {
    const symbol = match[0]
    if (symbol.length >= 2 && !COMMON_WORDS.has(symbol)) symbols.add(symbol)
    if (symbols.size >= 80) break
  }

  return [...symbols]
    .filter((symbol) => symbol !== prefix)
    .map((label) => ({ label, type: 'variable' as const, detail: '当前文件符号' }))
}

function supportsHashComments(language: string): boolean {
  return ['python', 'shell'].includes(language)
}

/**
 * Keep local suggestions out of comments and quoted literals. This is a
 * deliberately small lexical check: it avoids parsing the document while
 * still covering the contexts where an editor completion is most disruptive.
 */
function isCompletionSuppressed(doc: string, pos: number, language: string): boolean {
  const prefix = doc.slice(0, pos)
  const hashComments = supportsHashComments(language)
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  let blockComment = false

  for (let index = 0; index < prefix.length; index += 1) {
    const character = prefix[index]
    const next = prefix[index + 1]

    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }

    if (character === '/' && next === '*') {
      blockComment = true
      index += 1
    } else if (character === '/' && next === '/') {
      const lineEnd = prefix.indexOf('\n', index + 2)
      if (lineEnd === -1) return true
      index = lineEnd
    } else if (hashComments && character === '#') {
      const lineEnd = prefix.indexOf('\n', index + 1)
      if (lineEnd === -1) return true
      index = lineEnd
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character
    }
  }

  return Boolean(quote || blockComment)
}

export function getLocalCompletionOptions(
  language: string,
  fileName: string,
  doc: string,
  pos: number,
  explicit = false,
): LocalCompletionOptions | null {
  const beforeCursor = doc.slice(0, pos)
  const token = /[\w$-]*$/.exec(beforeCursor)?.[0] || ''
  if (!explicit && token.length === 0) return null

  const normalizedLanguage = normalizeCompletionLanguage(language, fileName)
  if (isCompletionSuppressed(doc, pos, normalizedLanguage)) return null

  const options = [...templateOptions(normalizedLanguage), ...symbolOptions(doc, token)]
  const filteredOptions = token
    ? options.filter((option) => option.label.toLowerCase().startsWith(token.toLowerCase()))
    : options

  if (filteredOptions.length === 0) return null

  return {
    from: pos - token.length,
    options: filteredOptions,
  }
}

export function createLocalCompletionSource(language: string, fileName: string): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const result = getLocalCompletionOptions(
      language,
      fileName,
      context.state.doc.toString(),
      context.pos,
      context.explicit,
    )
    return result ? { ...result, validFor: /^[\w$-]*$/ } : null
  }
}
