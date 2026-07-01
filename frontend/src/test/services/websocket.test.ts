import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  readyState = 0
  onopen: (() => void) | null = null
  onclose: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
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
    this.onclose?.({ code: 1000, reason: 'close' })
  }

  // 模拟接收消息
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

import { WsClient, getWsClient, getWsClientSync } from '../../services/websocket'

describe('WsClient', () => {
  let client: WsClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new WsClient('ws://localhost:8080/ws')
  })

  it('connects to WebSocket', async () => {
    const statuses: string[] = []
    client.onStatus((s) => statuses.push(s))
    client.connect()

    await vi.waitFor(() => {
      expect(client.status).toBe('connected')
    })
  })

  it('sends messages when connected', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    client.send({ type: 'ping' })
    const ws = (client as any).ws as MockWebSocket
    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: 'ping' })
  })

  it('handles request-response pattern', async () => {
    client.connect()
    await vi.waitFor(() => expect(client.status).toBe('connected'))

    const promise = client.request({ type: 'get_info' })
    
    const ws = (client as any).ws as MockWebSocket
    // Find the requestId from sent message
    const sentMsg = JSON.parse(ws.sentMessages[0])
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

    const ws = (client as any).ws as MockWebSocket
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
