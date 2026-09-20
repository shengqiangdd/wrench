import { describe, expect, it } from 'vitest'
import {
  decodePtyBytes,
  flushPtyBytes,
  shouldClearInitialTerminal,
} from '../../modules/ssh/terminal-output'

describe('initial terminal output preservation', () => {
  it('clears only an untouched initial status line', () => {
    expect(shouldClearInitialTerminal(false)).toBe(true)
  })

  it('preserves PTY output that arrives before the connected ack', () => {
    expect(shouldClearInitialTerminal(true)).toBe(false)
  })
})

it('preserves UTF-8 characters split across binary PTY frames', () => {
  const decoder = new TextDecoder()
  expect(decodePtyBytes(decoder, new Uint8Array([0xe4, 0xb8]))).toBe('')
  expect(decodePtyBytes(decoder, new Uint8Array([0xad]))).toBe('中')
})

it('flushes an incomplete UTF-8 tail at stream close', () => {
  const decoder = new TextDecoder()
  expect(decodePtyBytes(decoder, new Uint8Array([0xe4, 0xb8]))).toBe('')
  expect(flushPtyBytes(decoder)).toBe('�')
  expect(flushPtyBytes(decoder)).toBe('')
})
