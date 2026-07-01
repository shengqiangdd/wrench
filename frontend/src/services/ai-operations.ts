/**
 * ai-operations.ts
 *
 * AI 代码操作服务：对选中代码执行 AI 驱动的操作。
 * 支持解释、重构、修复、优化、注释、翻译等。
 */

import type { AiMessage } from '../types/ai'

export type AiCodeAction =
  | 'explain'
  | 'refactor'
  | 'fix'
  | 'optimize'
  | 'comment'
  | 'translate'

export interface AiCodeActionResult {
  original: string
  modified: string
  explanation: string
}

const ACTION_PROMPTS: Record<AiCodeAction, string> = {
  explain: `请解释以下代码的功能和工作原理。
用中文回答，保持简洁清晰。
输出格式：
\`\`\`explanation
你的解释
\`\`\``,

  refactor: `请重构以下代码，提高可读性、可维护性和代码质量。
保持功能完全不变。
用中文说明你的改动。
输出格式：
\`\`\`diff
改动说明
\`\`\`
\`\`\`code
重构后的完整代码
\`\`\``,

  fix: `请找出以下代码中的 bug 或潜在问题，并提供修复后的代码。
用中文说明问题和修复方案。
输出格式：
\`\`\`issues
问题列表
\`\`\`
\`\`\`code
修复后的完整代码
\`\`\``,

  optimize: `请优化以下代码的性能和资源使用。
保持功能不变，用中文说明你的优化措施。
输出格式：
\`\`\`diff
优化说明
\`\`\`
\`\`\`code
优化后的完整代码
\`\`\``,

  comment: `请为以下代码添加清晰的中文注释。
在关键逻辑处添加注释，解释代码的意图而非字面意思。
输出格式：
\`\`\`code
添加注释后的完整代码
\`\`\`
\`\`\`summary
注释总结
\`\`\``,

  translate: `请将以下代码中的注释、字符串、变量名等翻译为中文。
仅翻译文本内容，保持代码逻辑和结构不变。
输出格式：
\`\`\`code
翻译后的完整代码
\`\`\``,
}

export const ACTION_LABELS: Record<AiCodeAction, string> = {
  explain: '解释代码',
  refactor: '重构',
  fix: '修复',
  optimize: '优化',
  comment: '添加注释',
  translate: '翻译',
}

export const ACTION_ICONS: Record<AiCodeAction, string> = {
  explain: '🔍',
  refactor: '🔄',
  fix: '🔧',
  optimize: '⚡',
  comment: '💬',
  translate: '🌐',
}

/**
 * 对选中代码执行 AI 操作
 */
export async function aiCodeAction(
  action: AiCodeAction,
  code: string,
  language: string,
  apiKey: string,
  model: string,
  baseUrl: string,
  signal?: AbortSignal,
): Promise<AiCodeActionResult> {
  const systemPrompt = `你是一个专业的代码助手。用户选择了 ${language} 代码，需要对代码进行"${ACTION_LABELS[action]}"操作。请严格按照指定的输出格式返回结果。`

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: ACTION_PROMPTS[action] },
    { role: 'user', content: `以下是我的 ${language} 代码：\n\n\`\`\`${language}\n${code}\n\`\`\`` },
  ]

  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'SmartBox',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: 4096,
    }),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`AI API 错误 (${res.status}): ${errText}`)
  }

  const data = await res.json()
  const content: string = data.choices?.[0]?.message?.content || ''

  // 解析结果
  return parseActionResult(content, code)
}

/**
 * 解析 AI 返回的结果
 */
function parseActionResult(content: string, originalCode: string): AiCodeActionResult {
  // 尝试提取 code 块中的代码
  const codeMatch = content.match(/```code\n([\s\S]*?)```/)
  const modified = codeMatch ? codeMatch[1]!.trim() : originalCode

  // 提取 explanation / diff / issues
  const explMatch = content.match(/```(?:explanation|diff|issues|summary)\n([\s\S]*?)```/)
  const explanation = explMatch ? explMatch[1]!.trim() : content.replace(/```[\s\S]*?```/g, '').trim()

  return { original: originalCode, modified, explanation }
}

/**
 * 计算简单差异行的辅助函数
 */
export function computeDiffLines(original: string, modified: string): { added: number; removed: number } {
  const origLines = original.split('\n')
  const modLines = modified.split('\n')
  let added = 0
  let removed = 0

  // 简单对比行数差异
  if (origLines.length !== modLines.length) {
    added = Math.max(0, modLines.length - origLines.length)
    removed = Math.max(0, origLines.length - modLines.length)
  }

  return { added, removed }
}
