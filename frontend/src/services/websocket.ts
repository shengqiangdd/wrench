/**
 * SmartBox WebSocket 客户端
 *
 * 与前端的 WebSocket 服务通信。
 * 消息协议: JSON 格式，requestId 匹配请求-响应。
 */

type MessageHandler = (data: Record<string, unknown>) => void
type StatusHandler = (status: WsStatus) => void

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

import { buildWsUrl } from './auth'

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class WsClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers = new Map<string, MessageHandler[]>()
  private statusHandlers: StatusHandler[] = []
  private pendingRequests = new Map<string, PendingRequest>()
  private requestIdCounter = 0
  private _status: WsStatus = 'disconnected'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor(url: string) {
    this.url = url
  }

  get status() {
    return this._status
  }

  private setStatus(status: WsStatus) {
    this._status = status
    this.statusHandlers.forEach((fn) => fn(status))
  }

  // ─── 生命周期 ───

  /** 更新连接 URL（用于 token 刷新后） */
  setUrl(url: string) {
    this.url = url
  }

  connect() {
    // 如果已连接或正在连接，不重复创建
    if (this.ws) {
      const state = this.ws.readyState
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return
    }
    this.setStatus('connecting')

    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      this.setStatus('disconnected')
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.setStatus('connected')
      this.startHeartbeat()
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.dispatch(data)
      } catch {
        // 忽略无法解析的消息
      }
    }

    this.ws.onclose = () => {
      this.stopHeartbeat()
      this.setStatus('disconnected')
      this.rejectAllPending(new Error('连接已关闭'))
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose 也会触发，这里不做重复处理
    }
  }

  disconnect() {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts // 禁止自动重连
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  // ─── 自动重连 ───

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    if (this.reconnectTimer) return

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
    this.reconnectAttempts++
    this.setStatus('reconnecting')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  // ─── 心跳 ───

  private startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: 'ping' })
    }, 25000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── 消息收发 ───

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  /**
   * 发送请求并等待响应（requestId 匹配模式）
   */
  request(data: Record<string, unknown>, timeout = 10000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestIdCounter}_${Date.now()}`
      const payload = { ...data, requestId }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`请求超时: ${data.type || 'unknown'}`))
      }, timeout)

      this.pendingRequests.set(requestId, { resolve, reject, timer })
      this.send(payload)
    })
  }

  // ─── 事件监听 ───

  on(type: string, handler: MessageHandler) {
    const list = this.handlers.get(type) || []
    list.push(handler)
    this.handlers.set(type, list)
    return () => this.off(type, handler)
  }

  off(type: string, handler: MessageHandler) {
    const list = this.handlers.get(type)
    if (!list) return
    this.handlers.set(
      type,
      list.filter((h) => h !== handler),
    )
  }

  onStatus(handler: StatusHandler) {
    this.statusHandlers.push(handler)
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler)
    }
  }

  // ─── 内部分发 ───

  private dispatch(data: Record<string, unknown>) {
    // 请求-响应匹配
    const requestId = data.requestId as string | undefined
    if (requestId && this.pendingRequests.has(requestId)) {
      const pending = this.pendingRequests.get(requestId)!
      clearTimeout(pending.timer)
      this.pendingRequests.delete(requestId)
      if (data.error) {
        pending.reject(new Error(data.message as string || '未知错误'))
      } else {
        pending.resolve(data)
      }
      return
    }

    // 按类型分发
    const type = data.type as string
    if (type) {
      const handlers = this.handlers.get(type) || []
      handlers.forEach((fn) => fn(data))
    }
  }

  private rejectAllPending(err: Error) {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pendingRequests.clear()
  }
}

// 单例
let _instance: WsClient | null = null
let _tokenReady = false

/** 获取 WS 连接地址（带一次性 token） */
async function resolveWsUrl(): Promise<string> {
  try {
    return buildWsUrl('/ws')
  } catch (err) {
    console.error('[WS] Failed to resolve WebSocket URL:', err)
    // 尝试不带 token 连接（后端会拒绝，但错误更清晰）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws`
  }
}

/**
 * 获取 WS 客户端（异步，确保 token 就绪后连接）—— 由 AuthGate 在应用启动时调用。
 *
 * - 首次调用时创建 WsClient 实例并建立认证连接
 * - 后续调用直接返回已连实例
 *
 * @throws 如果无法获取认证令牌则抛出错误
 */
export async function getWsClient(): Promise<WsClient> {
  if (!_instance) {
    _instance = new WsClient('') // URL 在下面设置
  }
  // 获取新令牌（每次连接/重连都是新的）
  const url = await resolveWsUrl()
  _instance.setUrl(url)
  _tokenReady = true
  _instance.connect()
  return _instance
}

/**
 * 同步获取已有 WsClient 实例。
 *
 * - 如果 `getWsClient()` 已在应用启动时调用，返回已认证的实例
 * - 否则创建一个指向 `ws://host/ws` 的退化实例（兼容旧逻辑）
 */
export function getWsClientSync(): WsClient {
  if (_instance) {
    return _instance
  }
  // 退化：创建未认证的实例
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  _instance = new WsClient(`${protocol}//${host}/ws`)
  return _instance
}
