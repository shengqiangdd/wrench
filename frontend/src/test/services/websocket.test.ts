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
}

vi.stubGlobal('WebSocket', MockWebSocket)

import { WsClient, getWsClientSync } from '../../services/websocket'

/** Helper to access private ws property for testing */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getMockWs(client: WsClient): MockWebSocket {
  return (client as any).ws
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
