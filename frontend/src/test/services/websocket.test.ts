import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  sentMessages: string[] = []

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'close' } as CloseEvent)
  }

  // 模拟接收消息
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  simulateRawMessage(data: ArrayBuffer | Uint8Array) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

import { decodeTerminalBinaryFrame, WsClient, getWsClientSync } from '../../services/websocket'

/** Helper to access private ws property for testing */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getMockWs(client: WsClient): MockWebSocket {
  return (client as any).ws
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('binary PTY frame compatibility', () => {
  it('decodes SSH and Docker frames without base64', () => {
    const id = new TextEncoder().encode('conn-1')
    const payload = new Uint8Array([0x1b, 0x5b, 0x32, 0x6a])
    const frame = new Uint8Array(3 + id.length + payload.length)
    frame[0] = 1
    frame[1] = 0
    frame[2] = id.length
    frame.set(id, 3)
    frame.set(payload, 3 + id.length)
    const decoded = decodeTerminalBinaryFrame(frame)
    expect(decoded?.type).toBe('data')
    expect(decoded?.connectionId).toBe('conn-1')
    expect(Array.from(decoded?.data as Uint8Array)).toEqual(Array.from(payload))
  })

  it('rejects truncated or unknown frames', () => {
    expect(decodeTerminalBinaryFrame(new Uint8Array([1, 0]))).toBeNull()
    expect(decodeTerminalBinaryFrame(new Uint8Array([9, 0, 0]))).toBeNull()
  })
})

describe('WsClient', () => {
  let client: WsClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new WsClient('ws://localhost:8080/ws')
  })

  it('connects to WebSocket', async () => {
    const _statuses: string[] = []
    client.onStatus((s) => _statuses.push(s))
    client.connect()

    await vi.waitFor(() => {
      expect(client.status).toBe('connected')
    })
  })

  it('keeps the current heartbeat when a replaced socket closes late', async () => {
    vi.useFakeTimers()
    try {
      client.connect()
      await vi.advanceTimersByTimeAsync(1)
      expect(client.status).toBe('connected')
      const oldWs = getMockWs(client)

      client.disconnect()
      client.connect()
      await vi.advanceTimersByTimeAsync(1)
      expect(client.status).toBe('connected')
      const currentWs = getMockWs(client)

      oldWs.onclose?.({ code: 1000, reason: 'late close' } as CloseEvent)
      await vi.advanceTimersByTimeAsync(20_000)

      expect(currentWs.sentMessages).toContain(JSON.stringify({ type: 'ping' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores onopen from a replaced socket', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))
    const oldWs = getMockWs(client)

    client.disconnect()
    client.connect()
    expect(client.status).toBe('connecting')
    oldWs.onopen?.()
    expect(client.status).toBe('connecting')

    await vi.waitFor(() => expect(client.status).toBe('connected'))
  })

  it('ignores binary messages from a replaced socket', async () => {
    const received: Record<string, unknown>[] = []
    client.on('data', (data) => received.push(data))
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))
    const oldWs = getMockWs(client)

    client.disconnect()
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))
    const currentWs = getMockWs(client)

    const id = new TextEncoder().encode('conn-1')
    const frame = new Uint8Array(3 + id.length + 1)
    frame[0] = 1
    frame[2] = id.length
    frame.set(id, 3)
    frame[3 + id.length] = 0x41

    oldWs.simulateRawMessage(frame)
    expect(received).toHaveLength(0)
    currentWs.simulateRawMessage(frame)
    expect(received).toHaveLength(1)
  })

  it('flushes buffered terminal output before an explicit disconnect', async () => {
    vi.useFakeTimers()
    try {
      const received: string[] = []
      client.onTerminalOutput((data) => received.push(data))
      client.bufferTerminalOutput('partial output')

      client.disconnect()

      expect(received).toEqual(['partial output'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('adapts burst threshold to measured RTT while keeping timer latency bounded', () => {
    vi.useFakeTimers()
    try {
      const received: string[] = []
      client.onTerminalOutput((data) => received.push(data))
      client.bufferTerminalOutput('a'.repeat(8192))
      expect(received).toEqual(['a'.repeat(8192)])

      // Simulate a slow link: 12KB is retained as one batch, not flushed early.
      ;(client as unknown as { _rttSamples: number[] })._rttSamples = [600, 600, 600]
      client.bufferTerminalOutput('b'.repeat(8192))
      expect(received).toEqual(['a'.repeat(8192)])
      vi.advanceTimersByTime(16)
      expect(received).toEqual(['a'.repeat(8192), 'b'.repeat(8192)])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends terminal input immediately while PTY output is buffered', async () => {
    const received: string[] = []
    client.onTerminalOutput((data) => received.push(data))
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))
    client.bufferTerminalOutput('pending output')

    expect(client.sendTerminalInput({ type: 'exec', data: 'a' })).toBe(true)
    expect(getMockWs(client).sentMessages).toContain(JSON.stringify({ type: 'exec', data: 'a' }))
    expect(received).toEqual([])
  })

  it('bounds terminal input queued during reconnecting', () => {
    ;(client as unknown as { _status: string })._status = 'reconnecting'
    for (let i = 0; i < 128; i++) {
      expect(client.sendTerminalInput({ type: 'exec', data: String(i) })).toBe(true)
    }
    expect(client.queuedTerminalInputCount).toBe(128)
    expect(client.sendTerminalInput({ type: 'exec', data: 'overflow' })).toBe(false)
    expect(client.queuedTerminalInputCount).toBe(128)
  })

  it('rejects a terminal input frame larger than the byte budget', () => {
    ;(client as unknown as { _status: string })._status = 'reconnecting'
    expect(client.sendTerminalInput({ type: 'exec', data: 'a'.repeat(16 * 1024) })).toBe(false)
    expect(client.queuedTerminalInputCount).toBe(0)
  })

  it('sends messages when connected', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    client.send({ type: 'ping' })
    const ws = getMockWs(client)
    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0]!)).toEqual({ type: 'ping' })
  })

  it('handles request-response pattern', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    const promise = client.request({ type: 'get_info' })

    const ws = getMockWs(client)
    // Find the requestId from sent message
    const sentMsg = JSON.parse(ws.sentMessages[0]!)
    expect(sentMsg.type).toBe('get_info')
    expect(sentMsg.requestId).toBeDefined()

    // Simulate response
    ws.simulateMessage({ requestId: sentMsg.requestId, data: { name: 'test' } })

    const result = await promise
    expect(result.data).toEqual({ name: 'test' })
  })

  it('supports event subscription', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    const handler = vi.fn()
    client.on('docker_event', handler)

    const ws = getMockWs(client)
    ws.simulateMessage({ type: 'docker_event', container: 'nginx' })

    expect(handler).toHaveBeenCalledWith({ type: 'docker_event', container: 'nginx' })
  })

  it('disconnects and stops reconnection', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    client.disconnect()
    expect(client.status).toBe('disconnected')
  })

  it('provides sync access to singleton', async () => {
    const c1 = getWsClientSync()
    expect(c1.status).toBeDefined()
  })
})
