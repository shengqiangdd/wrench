import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearLocalAgentSession,
  getLocalAgentSession,
  pairLocalAgent,
} from '../../services/local-agent'

describe('local SSH agent pairing', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    localStorage.setItem('wrench_space_code', 'space-a')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects non-loopback endpoints before sending the one-time token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(pairLocalAgent('http://192.168.1.10:1234', 'secret')).rejects.toThrow('127.0.0.1')
    await expect(pairLocalAgent('http://localhost:1234', 'secret')).rejects.toThrow('127.0.0.1')
    await expect(pairLocalAgent('https://127.0.0.1:1234', 'secret')).rejects.toThrow('127.0.0.1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores only the session token and a loopback WebSocket URL for the current tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ paired: true, session_token: 'tab-token' }), {
            status: 200,
          }),
      ),
    )
    await pairLocalAgent('http://127.0.0.1:1234', 'one-time-token')
    expect(getLocalAgentSession()).toEqual({
      endpoint: 'http://127.0.0.1:1234',
      websocketUrl: 'ws://127.0.0.1:1234/ws',
      sessionToken: 'tab-token',
      spaceCode: 'space-a',
    })
    localStorage.setItem('wrench_space_code', 'space-b')
    expect(getLocalAgentSession()).toBeNull()
    clearLocalAgentSession()
    expect(getLocalAgentSession()).toBeNull()
  })
})
