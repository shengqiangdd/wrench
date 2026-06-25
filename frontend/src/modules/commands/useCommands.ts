import { useState, useEffect, useCallback } from 'react'
import type { QuickCommand, CommandGroup } from './index'
import { BUILTIN_COMMANDS, COMMAND_GROUPS, STORAGE_KEY, DEFAULT_CUSTOM } from './index'

function loadCustom(): QuickCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return DEFAULT_CUSTOM
}

function saveCustom(commands: QuickCommand[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(commands))
}

export interface CommandResult {
  connectionId: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  timestamp: number
}

export function useCommands() {
  const [customCommands, setCustomCommands] = useState<QuickCommand[]>(loadCustom)
  const [results, setResults] = useState<CommandResult[]>([])
  const [executingId, setExecutingId] = useState<string | null>(null)

  // 持久化自定义命令
  useEffect(() => {
    saveCustom(customCommands)
  }, [customCommands])

  /** 全部命令（内置 + 自定义） */
  const allCommands = useCallback(() => {
    return [...BUILTIN_COMMANDS, ...customCommands]
  }, [customCommands])

  /** 按分组取命令 */
  const commandsByGroup = useCallback(() => {
    const groups = COMMAND_GROUPS.map((g) => ({
      ...g,
      commands: allCommands().filter((c) => c.groupId === g.id),
    }))
    return groups.filter((g) => g.commands.length > 0)
  }, [allCommands])

  /** 添加自定义命令 */
  const addCommand = useCallback((cmd: Omit<QuickCommand, 'id' | 'isBuiltin'>) => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setCustomCommands((prev) => [...prev, { ...cmd, id, isBuiltin: false }])
    return id
  }, [])

  /** 更新自定义命令 */
  const updateCommand = useCallback((id: string, updates: Partial<Omit<QuickCommand, 'id' | 'isBuiltin'>>) => {
    setCustomCommands((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
  }, [])

  /** 删除自定义命令 */
  const removeCommand = useCallback((id: string) => {
    setCustomCommands((prev) => prev.filter((c) => c.id !== id))
  }, [])

  /** 通过 SSH 执行命令 */
  const executeCommand = useCallback(async (cmd: QuickCommand, connectionId: string) => {
    setExecutingId(cmd.id)
    try {
      const resp = await fetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, command: cmd.command }),
      })
      const data = await resp.json()
      const result: CommandResult = {
        connectionId,
        command: cmd.command,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        exitCode: data.exitCode ?? null,
        timestamp: Date.now(),
      }
      setResults((prev) => [result, ...prev].slice(0, 50))
      return result
    } finally {
      setExecutingId(null)
    }
  }, [])

  /** 清除执行历史 */
  const clearResults = useCallback(() => setResults([]), [])

  /** 删除单条结果 */
  const removeResult = useCallback((index: number) => {
    setResults((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return {
    customCommands,
    allCommands,
    commandsByGroup,
    results,
    executingId,
    addCommand,
    updateCommand,
    removeCommand,
    executeCommand,
    clearResults,
    removeResult,
    setCustomCommands,
  }
}
