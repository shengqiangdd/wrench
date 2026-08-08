export interface CommandItem {
  id: string
  label: string
  description?: string
  keywords: string[]
  icon?: string
  category: '导航' | '主题' | '插件' | '工具' | 'AI'
  action: () => void
}

// 注册命令的系统
const _registry: CommandItem[] = []

// Expose for test cleanup (only in test environment)
if (typeof globalThis !== 'undefined') {
  const g = globalThis as Record<string, unknown>
  g.__commandRegistry = _registry
}

export function registerCommand(cmd: CommandItem) {
  _registry.push(cmd)
}

export function getCommands(): CommandItem[] {
  return [..._registry]
}

// 简单的模糊匹配（支持拼音首字母和英文）
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const lower = text.toLowerCase()
  const q = query.toLowerCase().trim()

  // 直接子串匹配
  if (lower.includes(q)) return true

  // 拼音首字母匹配（取每个词的首字母）
  const initials = lower
    .split(/[\s_-]/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
  if (initials.includes(q)) return true

  // 单词首字母匹配（驼峰）
  const camelInitials = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
  if (camelInitials.includes(q)) return true

  return false
}
