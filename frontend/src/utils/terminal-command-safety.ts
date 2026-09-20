export type TerminalCommandRisk = 'safe' | 'mutating' | 'dangerous' | 'blocked'

export interface TerminalCommandAssessment {
  risk: TerminalCommandRisk
  reason?: string
}

const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|--recursive)(?:\s|$)/i, '递归删除'],
  [/\b(?:mkfs|fdisk|parted|dd)\b/i, '磁盘写入或分区'],
  [/\b(?:shutdown|reboot|poweroff|halt)\b/i, '主机控制'],
  [/\b(?:kubectl\s+delete|docker\s+(?:rm|system\s+prune|volume\s+rm))\b/i, '删除资源'],
  [/\b(?:git\s+reset\s+--hard|git\s+clean\s+-f)\b/i, '丢弃工作区内容'],
]

const MUTATING_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:mkdir|touch|cp|mv|chmod|chown|tee)\b/i, '修改文件'],
  [/\b(?:git\s+(?:commit|merge|rebase|push|pull|checkout|switch))\b/i, '修改版本库'],
  [/\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|run)\b/i, '修改项目或执行脚本'],
  [/\b(?:docker|kubectl)\s+(?:run|exec|compose\s+(?:up|down|restart|build))\b/i, '修改容器资源'],
]

/** Pure local classifier. It never sends, stores, or logs the command. */
export function assessTerminalCommand(command: string): TerminalCommandAssessment {
  if (
    Array.from(command).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  )
    return { risk: 'blocked', reason: '包含控制字符' }
  const normalized = command.trim()
  if (!normalized) return { risk: 'safe' }
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) return { risk: 'dangerous', reason }
  }
  for (const [pattern, reason] of MUTATING_PATTERNS) {
    if (pattern.test(normalized)) return { risk: 'mutating', reason }
  }
  return { risk: 'safe' }
}

export const TERMINAL_DANGEROUS_CONFIRM_STORAGE_KEY = 'wrench-terminal-dangerous-confirm-v1'

export function readDangerousCommandConfirmationEnabled(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  try {
    return storage.getItem(TERMINAL_DANGEROUS_CONFIRM_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeDangerousCommandConfirmationEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(TERMINAL_DANGEROUS_CONFIRM_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Local preference failures must never block terminal input.
  }
}
