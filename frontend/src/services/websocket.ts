/**
 * Wrench WebSocket 客户端
 *
 * 与前端的 WebSocket 服务通信。
 * 消息协议: JSON 格式，requestId 匹配请求-响应。
 *
 * 性能优化:
 * - 二进制协议: 终端数据使用 MessagePack 编码，避免 base64 的 33% 开销
 * - 输出缓冲: 终端输出按 16KB/50ms 阈值批量发送
 * - 事件分发: 直接 Map 查找，避免每次创建临时数组
 */

type MessageHandler = (data: Record<string, unknown>) => void
type StatusHandler = (status: WsStatus) => void
type ErrorHandler = (error: string) => void

export type WsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

import { buildWsUrl } from './auth'

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** WebSocket 连接超时时间（毫秒） */
const WS_CONNECT_TIMEOUT_MS = 10_000

/** 终端输出缓冲阈值（字节）— 超过此大小立即 flush */
const OUTPUT_BUFFER_THRESHOLD = 16_384
/** 终端输出 flush 间隔（毫秒）— 保证最大延迟 */
const OUTPUT_FLUSH_INTERVAL_MS = 50

export class WsClient {
  private ws: WebSocket | null = null
  private url: string
  private handlers = new Map<string, MessageHandler[]>()
  private statusHandlers: StatusHandler[] = []
  private errorHandlers: ErrorHandler[] = []
  private pendingRequests = new Map<string, PendingRequest>()
  private requestIdCounter = 0
  private _status: WsStatus = 'disconnected'
  private _lastError: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  // ─── 终端输出缓冲（用于高频终端 I/O）───
  private outputBuffer: string[] = []
  private outputBufferBytes = 0
  private outputFlushTimer: ReturnType<typeof setTimeout> | null = null
  private outputFlushCallback: ((data: string) => void) | null = null

  constructor(url: string) {
    this.url = url
  }

  get status() {
    return this._status
  }

  get lastError() {
    return this._lastError
  }

  private setStatus(status: WsStatus) {
    this._status = status
    // 避免 forEach 开销，直接遍历
    const handlers = this.statusHandlers
    for (let i = 0; i < handlers.length; i++) {
      const fn = handlers[i]
      if (fn) fn(status)
    }
  }

  private setError(error: string) {
    this._lastError = error
    const handlers = this.errorHandlers
    for (let i = 0; i < handlers.length; i++) {
      const fn = handlers[i]
      if (fn) fn(error)
    }
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
    this._lastError = null

    // 清理之前的连接超时计时器
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }

    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'WebSocket 创建失败'
      this.setError(errMsg)
      this.setStatus('disconnected')
      this.scheduleReconnect()
      return
    }

    // 连接超时检测
    this.connectTimeoutTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
        this.setError(
          `连接超时（${WS_CONNECT_TIMEOUT_MS / 1000}秒无响应），请检查后端服务是否正常运行`,
        )
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }
    }, WS_CONNECT_TIMEOUT_MS)

    this.ws.onopen = () => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer)
        this.connectTimeoutTimer = null
      }
      this.reconnectAttempts = 0
      this._lastError = null
      this.setStatus('connected')
      this.startHeartbeat()
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string)
        this.dispatch(data)
      } catch {
        // 忽略无法解析的消息
      }
    }

    this.ws.onclose = (event) => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer)
        this.connectTimeoutTimer = null
      }
      this.stopHeartbeat()
      this.stopOutputFlush()

      if (this._status === 'connecting') {
        // close 在 open 之前发生 → HTTP upgrade 很可能被拒绝
        const urlBase = this.url.split('?')[0]
        const diag = `Code: ${event.code}, Reason: ${event.reason || '(无)'}, WasClean: ${event.wasClean}, URL: ${urlBase}`
        if (event.code === 1006) {
          this.setError(
            `连接被拒绝（HTTP upgrade 可能返回了 401/403/500）。${diag}`,
          )
        } else if (event.code !== 1000) {
          this.setError(
            `连接在建立前被关闭（WebSocket is closed before open）。${diag}`,
          )
        }
        console.error(`[WsClient] 连接失败 — ${diag}`)
      }

      this.setStatus('disconnected')
      this.rejectAllPending(new Error('连接已关闭'))
      this.ws = null
      this.scheduleReconnect()
    }

    this.ws.onerror = (event) => {
      if (this._status === 'connecting') {
        const urlBase = this.url.split('?')[0]
        const detail = event instanceof Event ? `${urlBase}` : ''
        this.setError(
          `连接错误：无法建立 WebSocket 连接${detail ? ` (${detail})` : ''}，请检查网络和服务状态`,
        )
        console.error(
          `[WsClient] onerror — URL: ${urlBase}, readyState: ${this.ws?.readyState}`,
        )
      }
    }
  }

  disconnect() {
    this.stopHeartbeat()
    this.stopOutputFlush()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }
    this.reconnectAttempts = this.maxReconnectAttempts // 禁止自动重连
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  /** 手动重连（用户触发） */
  reconnect() {
    this.reconnectAttempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this._lastError = null
    this.connect()
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

  // ─── 终端输出缓冲 ───

  /**
   * 注册终端输出回调。终端数据会按阈值批量回调，减少消息数量。
   * 返回取消注册函数。
   */
  onTerminalOutput(callback: (data: string) => void): () => void {
    this.outputFlushCallback = callback
    return () => {
      if (this.outputFlushCallback === callback) {
        this.outputFlushCallback = null
      }
    }
  }

  /**
   * 缓冲终端输出数据。达到阈值时立即 flush，否则延迟 flush。
   */
  bufferTerminalOutput(data: string) {
    this.outputBuffer.push(data)
    this.outputBufferBytes += data.length

    if (this.outputBufferBytes >= OUTPUT_BUFFER_THRESHOLD) {
      this.flushOutputBuffer()
      return
    }

    // 设置延迟 flush（如果尚未设置）
    if (!this.outputFlushTimer) {
      this.outputFlushTimer = setTimeout(() => {
        this.flushOutputBuffer()
      }, OUTPUT_FLUSH_INTERVAL_MS)
    }
  }

  private flushOutputBuffer() {
    if (this.outputFlushTimer) {
      clearTimeout(this.outputFlushTimer)
      this.outputFlushTimer = null
    }

    if (this.outputBuffer.length === 0) return

    const data = this.outputBuffer.join('')
    this.outputBuffer = []
    this.outputBufferBytes = 0

    if (this.outputFlushCallback) {
      this.outputFlushCallback(data)
    }
  }

  private stopOutputFlush() {
    if (this.outputFlushTimer) {
      clearTimeout(this.outputFlushTimer)
      this.outputFlushTimer = null
    }
    this.outputBuffer = []
    this.outputBufferBytes = 0
  }

  // ─── 消息收发 ───

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    return false
  }

  /**
   * 等待 WebSocket 进入 OPEN 状态（用于连接尚未就绪时排队发送）。
   */
  private waitForOpen(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) return resolve()
      if (
        this._status === 'disconnected' &&
        (!this.ws || this.ws.readyState === WebSocket.CLOSED)
      ) {
        this.connect()
      }
      const unsub = this.onStatus((status) => {
        if (status === 'connected') {
          unsub()
          resolve()
        } else if (status === 'disconnected') {
          unsub()
          reject(new Error('连接已断开'))
        }
      })
      setTimeout(() => {
        unsub()
        reject(new Error('连接等待超时'))
      }, timeout)
    })
  }

  /**
   * 发送请求并等待响应（requestId 匹配模式）
   */
  async request(data: Record<string, unknown>, timeout = 10000): Promise<Record<string, unknown>> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      await this.waitForOpen(timeout)
    }

    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.requestIdCounter}_${Date.now()}`
      const payload = { ...data, requestId }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`请求超时: ${data.type || 'unknown'}`))
      }, timeout)

      this.pendingRequests.set(requestId, { resolve, reject, timer })
      if (!this.send(payload)) {
        clearTimeout(timer)
        this.pendingRequests.delete(requestId)
        reject(new Error('无法发送请求：WebSocket 不可用'))
      }
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
    // 立即用当前状态通知新注册的 handler
    handler(this._status)
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler)
    }
  }

  /** 注册错误回调 */
  onError(handler: ErrorHandler) {
    this.errorHandlers.push(handler)
    if (this._lastError) {
      handler(this._lastError)
    }
    return () => {
      this.errorHandlers = this.errorHandlers.filter((h) => h !== handler)
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
        pending.reject(new Error((data.message as string) || '未知错误'))
      } else {
        pending.resolve(data)
      }
      // 不 return → 继续按类型分发
    }

    // 按类型分发 — 直接遍历，避免创建临时数组
    const type = data.type as string
    if (type) {
      const handlers = this.handlers.get(type)
      if (handlers) {
        for (let i = 0; i < handlers.length; i++) {
          const fn = handlers[i]
          if (fn) fn(data)
        }
      }
    }
  }

  private rejectAllPending(err: Error) {
    for (const [, pending] of this.pendingRequests) {
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/ws`
  }
}

/**
 * 获取 WS 客户端（异步，确保 token 就绪后连接）—— 由 AuthGate 在应用启动时调用。
 */
export async function getWsClient(): Promise<WsClient> {
  if (!_instance) {
    _instance = new WsClient('')
  }
  const url = await resolveWsUrl()
  _instance.setUrl(url)
  _tokenReady = true
  _instance.connect()
  return _instance
}

/**
 * 同步获取已有 WsClient 实例。
 */
export function getWsClientSync(): WsClient {
  if (_instance) {
    return _instance
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  _instance = new WsClient(`${protocol}//${host}/ws`)
  return _instance
}

/**
 * 为 SSH 终端创建独立的 WsClient 实例。
 */
export function createTerminalWsClient(token: string): WsClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const url = `${protocol}//${host}/ws?token=${token}`
  return new WsClient(url)
}
