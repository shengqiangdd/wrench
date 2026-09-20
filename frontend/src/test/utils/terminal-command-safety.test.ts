import { describe, expect, it } from 'vitest'
import {
  assessTerminalCommand,
  readDangerousCommandConfirmationEnabled,
  writeDangerousCommandConfirmationEnabled,
} from '../../utils/terminal-command-safety'

describe('terminal command safety', () => {
  it('classifies commands locally without treating read-only commands as dangerous', () => {
    expect(assessTerminalCommand('git status').risk).toBe('safe')
    expect(assessTerminalCommand('mkdir build').risk).toBe('mutating')
    expect(assessTerminalCommand('rm -rf build')).toMatchObject({
      risk: 'dangerous',
      reason: '递归删除',
    })
  })

  it('blocks control characters for split synchronization', () => {
    expect(assessTerminalCommand('printf ok' + String.fromCharCode(0)).risk).toBe('blocked')
  })

  it('stores only the local confirmation preference', () => {
    const storage = new Map<string, string>()
    const local = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }
    expect(readDangerousCommandConfirmationEnabled(local)).toBe(true)
    writeDangerousCommandConfirmationEnabled(false, local)
    expect(readDangerousCommandConfirmationEnabled(local)).toBe(false)
  })
})
