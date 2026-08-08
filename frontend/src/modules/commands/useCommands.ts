import { useState, useEffect, useCallback } from 'react'
import { authedFetch } from '../../services/auth'
import type { QuickCommand, CommandGroup } from './index'
import { BUILTIN_COMMANDS, BUILTIN_GROUPS, STORAGE_KEY, DEFAULT_CUSTOM } from './index'

const GROUP_STORAGE_KEY = 'wrench-command-groups'

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

function loadCustomGroups(): CommandGroup[] {
  try {
    const raw = localStorage.getItem(GROUP_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveCustomGroups(groups: CommandGroup[]) {
  localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(groups))
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
  const [customGroups, setCustomGroups] = useState<CommandGroup[]>(loadCustomGroups)
  const [results, setResults] = useState<CommandResult[]>([])
  const [executingId, setExecutingId] = useState<string | null>(null)

  // 持久化
  useEffect(() => {
    saveCustom(customCommands)
  }, [customCommands])

  useEffect(() => {
    saveCustomGroups(customGroups)
  }, [customGroups])

  /** 全部分组（内置 + 自定义） */
  const allGroups = useCallback(() => {
    return [...BUILTIN_GROUPS, ...customGroups]
  }, [customGroups])

  /** 全部命令（内置 + 自定义） */
  const allCommands = useCallback(() => {
    return [...BUILTIN_COMMANDS, ...customCommands]
  }, [customCommands])

  /** 按分组取命令 */
  const commandsByGroup = useCallback(() => {
    const groups = allGroups().map((g) => ({
      ...g,
      commands: allCommands().filter((c) => c.groupId === g.id),
    }))
    return groups.filter((g) => g.commands.length > 0)
  }, [allGroups, allCommands])

  /** 添加自定义命令 */
  const addCommand = useCallback((cmd: Omit<QuickCommand, 'id' | 'isBuiltin'>) => {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setCustomCommands((prev) => [...prev, { ...cmd, id, isBuiltin: false }])
    return id
  }, [])

  /** 更新自定义命令 */
  const updateCommand = useCallback(
    (id: string, updates: Partial<Omit<QuickCommand, 'id' | 'isBuiltin'>>) => {
      setCustomCommands((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
    },
    [],
  )

  /** 删除自定义命令 */
  const removeCommand = useCallback((id: string) => {
    setCustomCommands((prev) => prev.filter((c) => c.id !== id))
  }, [])

  /** 通过 SSH 执行命令 */
  const executeCommand = useCallback(async (cmd: QuickCommand, connectionId: string) => {
    setExecutingId(cmd.id)
    try {
      // 带超时的 fetch（30s）
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30000)

      let resp: Response
      try {
        resp = await authedFetch('/api/ssh/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, command: cmd.command }),
          signal: controller.signal,
        })
      } catch (fetchErr: unknown) {
        clearTimeout(timer)
        const msg =
          fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
            ? '请求超时（30秒）'
            : fetchErr instanceof Error
              ? fetchErr.message
              : '网络错误'
        const result: CommandResult = {
          connectionId,
          command: cmd.command,
          stdout: '',
          stderr: msg,
          exitCode: null,
          timestamp: Date.now(),
        }
        setResults((prev) => [result, ...prev].slice(0, 50))
        return result
      }
      clearTimeout(timer)

      let data: Record<string, unknown>
      try {
        data = await resp.json()
      } catch {
        data = { success: false, error: `HTTP ${resp.status}: 非JSON响应` }
      }

      // 兼容 ApiResponse { success, data: { stdout, stderr, exitCode } }
      // 和直接返回 { stdout, stderr, exitCode } 两种格式
      const ok = resp.ok && data.success !== false
      if (!ok) {
        const errMsg = (data.error || data.msg || '执行失败') as string
        const result: CommandResult = {
          connectionId,
          command: cmd.command,
          stdout: '',
          stderr: errMsg,
          exitCode: null,
          timestamp: Date.now(),
        }
        setResults((prev) => [result, ...prev].slice(0, 50))
        return result
      }

      const inner = (data.data || data) as Record<string, unknown>
      const result: CommandResult = {
        connectionId,
        command: cmd.command,
        stdout: (inner.stdout as string) || '',
        stderr: (inner.stderr as string) || '',
        exitCode: inner.exitCode != null ? (inner.exitCode as number) : null,
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

  /** 保存分组（新建或更新） */
  const saveGroup = useCallback((group: CommandGroup) => {
    setCustomGroups((prev) => {
      const existing = prev.findIndex((g) => g.id === group.id)
      if (existing >= 0) {
        const updated = [...prev]
        updated[existing] = group
        return updated
      }
      return [...prev, group]
    })
  }, [])

  /** 删除自定义分组（同时移除分组下的命令） */
  const removeGroup = useCallback((id: string) => {
    setCustomGroups((prev) => prev.filter((g) => g.id !== id))
    setCustomCommands((prev) => prev.filter((c) => c.groupId !== id))
  }, [])

  return {
    customCommands,
    customGroups,
    allGroups,
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
    saveGroup,
    removeGroup,
  }
}
