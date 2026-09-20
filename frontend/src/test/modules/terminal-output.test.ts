import { describe, expect, it } from 'vitest'
import { shouldClearInitialTerminal } from '../../modules/ssh/terminal-output'

describe('initial terminal output preservation', () => {
  it('clears only an untouched initial status line', () => {
    expect(shouldClearInitialTerminal(false)).toBe(true)
  })

  it('preserves PTY output that arrives before the connected ack', () => {
    expect(shouldClearInitialTerminal(true)).toBe(false)
  })
})
