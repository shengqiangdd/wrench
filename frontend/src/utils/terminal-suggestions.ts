export const TERMINAL_HISTORY_STORAGE_KEY = 'wrench-terminal-command-history-v1'
export const TERMINAL_HISTORY_ENABLED_STORAGE_KEY = 'wrench-terminal-command-history-enabled-v1'
export const TERMINAL_HISTORY_LIMIT = 100
export const TERMINAL_SUGGESTION_LIMIT = 6

export interface TerminalCommandHistoryEntry {
  command: string
  count: number
  lastUsed: number
  cwd?: string
}

export interface TerminalSuggestion {
  command: string
  source: 'history' | 'builtin'
  cwd?: string
  category: 'history' | 'project' | 'shell'
  reason: string
}

export interface TerminalContext {
  cwd: string
  projectTypes: Array<
    'git' | 'docker-compose' | 'npm' | 'pnpm' | 'yarn' | 'cargo' | 'go' | 'python'
  >
}

export interface TerminalInputState {
  text: string
  cursor: number
}

export interface TerminalInputEdit {
  state: TerminalInputState
  changed: boolean
  reset: boolean
  submitted: boolean
}

/**
 * Conservative client-side filter. Commands are never sent to a server, but
 * values that commonly contain credentials should not be persisted either.
 */
export function isSensitiveCommand(command: string): boolean {
  return /(?:--?(?:password|passwd|token|secret|api[-_]?key|private[-_]?key)|\b(?:password|passwd|token|secret|api[-_]?key|private[-_]?key)\s*=|authorization\s*:\s*bearer|-----BEGIN .*PRIVATE KEY-----|\bsshpass\b)/i.test(
    command,
  )
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

/** Best-effort prompt parsing; failure is intentionally harmless. */
export function inferCwdFromPrompt(promptLine: string): string | undefined {
  const match = promptLine.match(/(?:^|\s)(?:[^\s:@]+@[^\s:]+:)?(\/[^\s$#>%]*|~)[#$>%]\s*$/)
  return match?.[1]
}

export function readTerminalCommandHistory(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): TerminalCommandHistoryEntry[] {
  try {
    const raw = storage.getItem(TERMINAL_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isHistoryEntry).slice(0, TERMINAL_HISTORY_LIMIT)
  } catch {
    return []
  }
}

export function recordTerminalCommand(
  history: TerminalCommandHistoryEntry[],
  command: string,
  cwd?: string,
  now = Date.now(),
): TerminalCommandHistoryEntry[] {
  const normalized = normalizeCommand(command)
  if (!normalized || normalized.length > 512 || isSensitiveCommand(normalized)) return history

  const existing = history.find((entry) => entry.command === normalized)
  const next = existing
    ? history.map((entry) =>
        entry.command === normalized
          ? { ...entry, count: entry.count + 1, lastUsed: now, cwd: cwd || entry.cwd }
          : entry,
      )
    : [...history, { command: normalized, count: 1, lastUsed: now, ...(cwd ? { cwd } : {}) }]

  return next.sort((left, right) => right.lastUsed - left.lastUsed).slice(0, TERMINAL_HISTORY_LIMIT)
}

export function writeTerminalCommandHistory(
  history: TerminalCommandHistoryEntry[],
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(TERMINAL_HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    // A blocked or full localStorage must never affect terminal input.
  }
}

/** Remove only this app's locally persisted command history. Nothing is uploaded. */
export function clearTerminalCommandHistory(
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  try {
    storage.removeItem(TERMINAL_HISTORY_STORAGE_KEY)
  } catch {
    // A blocked localStorage must never affect terminal input.
  }
}

export function readTerminalCommandHistoryEnabled(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  try {
    return storage.getItem(TERMINAL_HISTORY_ENABLED_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export function writeTerminalCommandHistoryEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void {
  try {
    storage.setItem(TERMINAL_HISTORY_ENABLED_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // A blocked localStorage must never affect terminal input.
  }
}

/** Mirror readline-style local editing without trying to emulate the remote shell. */
export function applyTerminalInput(input: TerminalInputState, data: string): TerminalInputEdit {
  const state = { text: input.text, cursor: input.cursor }
  const reset = (submitted = false): TerminalInputEdit => ({
    state: { text: '', cursor: 0 },
    changed: false,
    reset: true,
    submitted,
  })
  const changed = (): TerminalInputEdit => ({
    state,
    changed: true,
    reset: false,
    submitted: false,
  })
  const removeWordBackward = () => {
    const before = state.text.slice(0, state.cursor).replace(/\s+$/, '')
    const match = before.match(/\S+$/)
    const start = match?.index ?? 0
    state.text = state.text.slice(0, start) + state.text.slice(state.cursor)
    state.cursor = start
  }

  if (data === '\r' || data === '\n' || data.includes('\r') || data.includes('\n'))
    return reset(true)
  if (data === '\x03' || data === '\x04' || data === '\x1b') return reset()

  switch (data) {
    case '\x01':
    case '\x1b[H':
    case '\x1bOH':
    case '\x1b[1~':
      state.cursor = 0
      return changed()
    case '\x05':
    case '\x1b[F':
    case '\x1bOF':
    case '\x1b[4~':
      state.cursor = state.text.length
      return changed()
    case '\x7f':
      if (state.cursor > 0) {
        state.text = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor)
        state.cursor -= 1
      }
      return changed()
    case '\x17':
    case '\x1b\x7f':
      removeWordBackward()
      return changed()
    case '\x15':
      state.text = state.text.slice(state.cursor)
      state.cursor = 0
      return changed()
    case '\x0b':
      state.text = state.text.slice(0, state.cursor)
      return changed()
    case '\x1b[3~':
      if (state.cursor < state.text.length)
        state.text = state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1)
      return changed()
    case '\x1b[D':
      state.cursor = Math.max(0, state.cursor - 1)
      return changed()
    case '\x1b[C':
      state.cursor = Math.min(state.text.length, state.cursor + 1)
      return changed()
    case '\x1b[1;5D': {
      const before = state.text.slice(0, state.cursor).replace(/\s+$/, '')
      const match = before.match(/\S+$/)
      state.cursor = match?.index ?? 0
      return changed()
    }
    case '\x1b[1;5C': {
      const offset = state.text.slice(state.cursor).search(/\S/)
      state.cursor = offset < 0 ? state.text.length : state.cursor + offset
      return changed()
    }
  }

  if (/^[\x20-\x7e\u00a0-\uffff]+$/.test(data)) {
    state.text = state.text.slice(0, state.cursor) + data + state.text.slice(state.cursor)
    state.cursor += data.length
    return changed()
  }
  if (data.startsWith('\x1b[') || data.startsWith('\x1bO')) return reset()
  return { state, changed: false, reset: false, submitted: false }
}

export function getTerminalSuggestions(
  input: string,
  history: TerminalCommandHistoryEntry[],
  cwd = '',
  limit = TERMINAL_SUGGESTION_LIMIT,
): TerminalSuggestion[] {
  const prefix = input.trimStart()
  if (/[\r\n]/.test(input)) return []

  const context = inferTerminalContext(input, cwd, history)
  const historySuggestions = history
    .filter(
      (entry) =>
        Boolean(prefix) && !isSensitiveCommand(entry.command) && entry.command.startsWith(prefix),
    )
    .sort((left, right) => {
      const leftCwd = cwd && left.cwd === cwd ? 1 : 0
      const rightCwd = cwd && right.cwd === cwd ? 1 : 0
      return rightCwd - leftCwd || right.count - left.count || right.lastUsed - left.lastUsed
    })
    .map((entry) => ({
      command: entry.command,
      source: 'history' as const,
      cwd: entry.cwd,
      category: 'history' as const,
      reason: entry.cwd && cwd && entry.cwd === cwd ? '当前目录的本地历史' : '本地命令历史',
    }))

  const builtins = getBuiltinSuggestions(prefix, context).filter(
    (item) => !historySuggestions.some((historyItem) => historyItem.command === item.command),
  )
  return [...historySuggestions, ...builtins].slice(0, limit)
}

/** Infer only from local terminal state; no filesystem or network probe is performed. */
export function inferTerminalContext(
  input: string,
  cwd: string,
  history: TerminalCommandHistoryEntry[] = [],
): TerminalContext {
  const commands = [input, ...history.map((entry) => entry.command)].map((command) =>
    normalizeCommand(command).toLowerCase(),
  )
  const projectTypes: TerminalContext['projectTypes'] = []
  const has = (pattern: RegExp) => commands.some((command) => pattern.test(command))
  if (has(/^git(?:\s|$)/)) projectTypes.push('git')
  if (has(/^(?:docker\s+compose|docker-compose)(?:\s|$)/)) projectTypes.push('docker-compose')
  if (has(/^npm(?:\s|$)/)) projectTypes.push('npm')
  if (has(/^pnpm(?:\s|$)/)) projectTypes.push('pnpm')
  if (has(/^yarn(?:\s|$)/)) projectTypes.push('yarn')
  if (has(/^cargo(?:\s|$)/)) projectTypes.push('cargo')
  if (has(/^go(?:\s|$)/)) projectTypes.push('go')
  if (has(/^(?:python|python3)(?:\s|$)/)) projectTypes.push('python')
  return { cwd, projectTypes }
}

function getBuiltinSuggestions(prefix: string, context: TerminalContext): TerminalSuggestion[] {
  const templates: Array<{
    command: string
    reason: string
    projectTypes: TerminalContext['projectTypes']
    category: TerminalSuggestion['category']
  }> = [
    {
      command: 'git status',
      reason: '检测到 Git 命令历史',
      projectTypes: ['git'],
      category: 'project',
    },
    {
      command: 'git diff',
      reason: '检测到 Git 命令历史',
      projectTypes: ['git'],
      category: 'project',
    },
    {
      command: 'git log --oneline',
      reason: '检测到 Git 命令历史',
      projectTypes: ['git'],
      category: 'project',
    },
    {
      command: 'docker compose ps',
      reason: '检测到 Docker Compose 命令历史',
      projectTypes: ['docker-compose'],
      category: 'project',
    },
    {
      command: 'docker compose logs',
      reason: '检测到 Docker Compose 命令历史',
      projectTypes: ['docker-compose'],
      category: 'project',
    },
    {
      command: 'npm test',
      reason: '检测到 npm 命令历史',
      projectTypes: ['npm'],
      category: 'project',
    },
    {
      command: 'npm run build',
      reason: '检测到 npm 命令历史',
      projectTypes: ['npm'],
      category: 'project',
    },
    {
      command: 'pnpm test',
      reason: '检测到 pnpm 命令历史',
      projectTypes: ['pnpm'],
      category: 'project',
    },
    {
      command: 'pnpm build',
      reason: '检测到 pnpm 命令历史',
      projectTypes: ['pnpm'],
      category: 'project',
    },
    {
      command: 'yarn test',
      reason: '检测到 yarn 命令历史',
      projectTypes: ['yarn'],
      category: 'project',
    },
    {
      command: 'yarn build',
      reason: '检测到 yarn 命令历史',
      projectTypes: ['yarn'],
      category: 'project',
    },
    {
      command: 'cargo check',
      reason: '检测到 Cargo 命令历史',
      projectTypes: ['cargo'],
      category: 'project',
    },
    {
      command: 'cargo test',
      reason: '检测到 Cargo 命令历史',
      projectTypes: ['cargo'],
      category: 'project',
    },
    {
      command: 'go test ./...',
      reason: '检测到 Go 命令历史',
      projectTypes: ['go'],
      category: 'project',
    },
    {
      command: 'python -m pytest',
      reason: '检测到 Python 命令历史',
      projectTypes: ['python'],
      category: 'project',
    },
    { command: 'clear', reason: '安全的内置终端命令', projectTypes: [], category: 'shell' },
    { command: 'history', reason: '安全的内置终端命令', projectTypes: [], category: 'shell' },
    { command: 'pwd', reason: '安全的内置终端命令', projectTypes: [], category: 'shell' },
    { command: 'which ', reason: '安全的内置终端命令', projectTypes: [], category: 'shell' },
  ]
  return templates
    .filter((item) => {
      const prefixMatch = !prefix || item.command.startsWith(prefix)
      const projectMatch =
        item.projectTypes.length === 0 ||
        item.projectTypes.some((type) => context.projectTypes.includes(type))
      return prefixMatch && projectMatch
    })
    .map(({ command, category, reason }) => ({
      command,
      source: 'builtin' as const,
      category,
      reason,
    }))
}

export interface TerminalSuggestionProvider {
  getSuggestions(input: string, cwd?: string): Promise<TerminalSuggestion[]>
}

/** Future AI providers can implement this without changing terminal input handling. */
export const noOpTerminalSuggestionProvider: TerminalSuggestionProvider = {
  async getSuggestions() {
    return []
  },
}

function isHistoryEntry(value: unknown): value is TerminalCommandHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<TerminalCommandHistoryEntry>
  return (
    typeof entry.command === 'string' &&
    typeof entry.count === 'number' &&
    typeof entry.lastUsed === 'number' &&
    entry.command.length <= 512
  )
}
