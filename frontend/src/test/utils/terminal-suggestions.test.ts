import { describe, expect, it } from 'vitest'
import {
  applyTerminalInput,
  clearTerminalCommandHistory,
  getTerminalSuggestions,
  inferTerminalContext,
  inferCwdFromPrompt,
  isSensitiveCommand,
  recordTerminalCommand,
  type TerminalCommandHistoryEntry,
} from '@/utils/terminal-suggestions'

describe('terminal suggestions', () => {
  it('ranks current-directory and frequently used history first', () => {
    const history: TerminalCommandHistoryEntry[] = [
      { command: 'git status', count: 2, lastUsed: 10, cwd: '/tmp' },
      { command: 'git stash', count: 20, lastUsed: 20, cwd: '/other' },
      { command: 'git log --oneline', count: 1, lastUsed: 30, cwd: '/tmp' },
    ]
    expect(
      getTerminalSuggestions('git ', history, '/tmp')
        .map((item) => item.command)
        .slice(0, 3),
    ).toEqual(['git status', 'git log --oneline', 'git stash'])
  })

  it('does not persist likely secrets and deduplicates commands', () => {
    expect(isSensitiveCommand('curl --header Authorization: Bearer abc')).toBe(true)
    const first = recordTerminalCommand([], '  pwd  ', '/tmp', 1)
    const second = recordTerminalCommand(first, 'pwd', '/tmp', 2)
    expect(second).toEqual([{ command: 'pwd', count: 2, lastUsed: 2, cwd: '/tmp' }])
    expect(recordTerminalCommand(second, 'export API_KEY=secret')).toBe(second)
  })

  it('provides safe shell symbol suggestions when history has no match', () => {
    expect(getTerminalSuggestions('cle', [])).toEqual([
      { command: 'clear', source: 'builtin', category: 'shell', reason: '安全的内置终端命令' },
    ])
  })

  it('infers project context from local history without probing the filesystem', () => {
    expect(
      inferTerminalContext('', '/workspace/app', [
        { command: 'pnpm dev', count: 1, lastUsed: 1 },
        { command: 'git status', count: 1, lastUsed: 2 },
      ]),
    ).toEqual({ cwd: '/workspace/app', projectTypes: ['git', 'pnpm'] })
  })

  it('prioritizes contextual templates for empty input and removes duplicates', () => {
    const history: TerminalCommandHistoryEntry[] = [
      { command: 'git status', count: 1, lastUsed: 1 },
      { command: 'pnpm test', count: 1, lastUsed: 2 },
      { command: 'pnpm run build', count: 1, lastUsed: 3 },
    ]
    const suggestions = getTerminalSuggestions('', history, '/workspace/app')
    expect(suggestions.map((item) => item.command)).toEqual([
      'git status',
      'git diff',
      'git log --oneline',
      'pnpm test',
      'pnpm build',
      'clear',
    ])
    expect(new Set(suggestions.map((item) => item.command)).size).toBe(suggestions.length)
    expect(suggestions.every((item) => item.reason && item.category)).toBe(true)
  })

  it('extracts a best-effort directory from common shell prompts', () => {
    expect(inferCwdFromPrompt('alice@host:/srv/app$ ')).toBe('/srv/app')
    expect(inferCwdFromPrompt('user@host:~% ')).toBe('~')
  })
})

describe('terminal input mirror', () => {
  const input = (text: string, cursor = text.length) => ({ text, cursor })

  it('tracks Ctrl+A/E and Home/End without changing text', () => {
    expect(applyTerminalInput(input('git status', 4), '\x01').state).toEqual(input('git status', 0))
    expect(applyTerminalInput(input('git status', 4), '\x05').state).toEqual(input('git status'))
    expect(applyTerminalInput(input('git status', 4), '\x1b[H').state).toEqual(
      input('git status', 0),
    )
    expect(applyTerminalInput(input('git status', 4), '\x1bOF').state).toEqual(input('git status'))
  })

  it('handles Delete, Ctrl+W, Alt+Backspace and multiline paste boundaries', () => {
    expect(applyTerminalInput(input('abc', 1), '\x1b[3~').state).toEqual(input('ac', 1))
    expect(applyTerminalInput(input('git status', 10), '\x17').state).toEqual(input('git ', 4))
    expect(applyTerminalInput(input('git status', 10), '\x1b\x7f').state).toEqual(input('git ', 4))
    expect(applyTerminalInput(input('echo hi'), 'echo one\necho two').submitted).toBe(true)
  })
})

describe('local history privacy controls', () => {
  it('clears only the terminal history key', () => {
    const removed: string[] = []
    clearTerminalCommandHistory({ removeItem: (key) => removed.push(key) })
    expect(removed).toEqual(['wrench-terminal-command-history-v1'])
  })
})
