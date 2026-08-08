/**
 * Wrench WebSocket 客户端
 *
 * 与前端的 WebSocket 服务通信。
 * 消息协议: JSON 格式，requestId 匹配请求-响应。
 *
 * 功能特性:
 * - 指数退避自动重连（1s~30s, jitter ±500ms）
 * - 消息队列 + 重发（连接恢复后自动发送未送达消息）
 * - 心跳 pong/ping 检测（每 15s ping，30s 无响应判定断连）
 * - onReconnecting / onReconnected 回调
 * - 重连失败计数（超过 5 次可通过 reconnectFailedCount 查询）
 *
 * 性能优化:
 * - 二进制协议: 终端数据使用 MessagePack 编码，避免 base64 的 33% 开销
 * - 输出缓冲: 终端输出按 8KB/16ms 阈值批量发送，减少历史命令和Tab补全的显示延迟
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
const OUTPUT_BUFFER_THRESHOLD = 8_192
/** 终端输出 flush 间隔（毫秒）— 保证最大延迟，更短的间隔减少历史命令和Tab补全的显示延迟 */
const OUTPUT_FLUSH_INTERVAL_MS = 16

// ─── 重连参数 ───
/** 初始重连延迟（毫秒） */
const INITIAL_RECONNECT_DELAY_MS = 2_000
/** 最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY_MS = 30_000
/** 重连 jitter 范围 ±500ms */
const RECONNECT_JITTER_MS = 500

// ─── 心跳参数 ───
/** 心跳 ping 发送间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 20_000
/** 心跳超时阈值（毫秒）— 超过此时间未收到任何消息认为断连 */
/** 增加到 90 秒，与后端 SSH keepalive (30s * 3) 保持一致，减少误判断连 */
const HEARTBEAT_TIMEOUT_MS = 90_000
/** 心跳看门狗检查间隔（毫秒） */
const HEARTBEAT_WATCHDOG_INTERVAL_MS = 10_000

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

  // ─── 增强: 重连回调 ───
  private _onReconnectingHandlers: (() => void)[] = []
  private _onReconnectedHandlers: (() => void)[] = []

  // ─── 增强: 消息队列（连接断开期间暂存，恢复后重发）───
  private _messageQueue: string[] = []

  // ─── 增强: 重连失败计数（超过 5 次用于 UI 显示 "Connection Lost"）───
  private _reconnectFailedCount = 0

  // ─── 增强: 心跳检测 ───
  private _lastPongTime = 0
  private heartbeatWatchdogTimer: ReturnType<typeof setInterval> | null = null

  // ─── 动态心跳：根据网络延迟自动调整 ───
  /** 最近 5 次 ping 的 RTT（毫秒） */
  private _rttSamples: number[] = []
  /** 当前 ping 发送时间（毫秒） */
  private _pingSentTime = 0
  /** 当前心跳间隔（毫秒），动态调整 */
  private _currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS
  /** 当前心跳超时（毫秒），动态调整 */
  private _currentHeartbeatTimeout = HEARTBEAT_TIMEOUT_MS

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

  /** 当前重连失败次数（连续），用于 UI 判断是否显示 "Connection Lost" */
  get reconnectFailedCount() {
    return this._reconnectFailedCount
  }

  /** 获取最近的平均 RTT（毫秒），用于网络质量监控 */
  get averageRtt(): number {
    if (this._rttSamples.length === 0) return 0
    return Math.round(
      this._rttSamples.reduce((a, b) => a + b, 0) / this._rttSamples.length,
    )
  }

  /** 获取当前心跳间隔（毫秒） */
  get currentHeartbeatInterval(): number {
    return this._currentHeartbeatInterval
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
      // OPEN / CONNECTING / CLOSING 都不应创建新连接
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING || state === WebSocket.CLOSING)
        return
      // CLOSING/CLOSED 状态下，等待旧连接完全关闭后再重连
      if (state === WebSocket.CLOSED) {
        // 旧连接已关闭，清理引用后可以创建新连接
        this.ws = null
      }
    }
    // 如果正在 reconnecting 且已有 reconnectTimer，不重复创建
    if (this._status === 'reconnecting' && this.reconnectTimer) return
    console.log(`[WsClient] connect() — url=${this.url.split('?')[0]}, status=${this._status}`)
    this.setStatus('connecting')
    this._lastError = null

    // 清理之前的连接超时计时器
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer)
      this.connectTimeoutTimer = null
    }

    try {
      this.ws = new WebSocket(this.url)
      console.log(`[WsClient] WebSocket created, readyState=${this.ws.readyState}`)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'WebSocket 创建失败'
      console.error(`[WsClient] WebSocket constructor failed:`, e)
      this.setError(errMsg)
      this.setStatus('disconnected')
      this.scheduleReconnect()
      return
    }

    const ws = this.ws

    // 连接超时检测
    this.connectTimeoutTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close()
        this.setError(
          `连接超时（${WS_CONNECT_TIMEOUT_MS / 1000}秒无响应），请检查后端服务是否正常运行`,
        )
        this.setStatus('disconnected')
        this.scheduleReconnect()
      }
    }, WS_CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      console.log(`[WsClient] onopen — connected to ${this.url.split('?')[0]}`)
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer)
        this.connectTimeoutTimer = null
      }
      this.reconnectAttempts = 0
      this._reconnectFailedCount = 0
      this._lastError = null
      this._lastPongTime = Date.now()
      this.setStatus('connected')
      this.startHeartbeat()
      // 增强: 连接恢复后重发消息队列
      this.flushMessageQueue()
      // 增强: 触发 onReconnected 回调
      const reconnectedHandlers = this._onReconnectedHandlers
      for (let i = 0; i < reconnectedHandlers.length; i++) {
        const fn = reconnectedHandlers[i]
        if (fn) fn()
      }
    }

    ws.onmessage = (event) => {
      // 增强: 收到任意消息即更新心跳时间戳
      this._lastPongTime = Date.now()

      // 记录 RTT（如果刚发过 ping）
      if (this._pingSentTime > 0) {
        const rtt = Date.now() - this._pingSentTime
        this._rttSamples.push(rtt)
        if (this._rttSamples.length > 5) {
          this._rttSamples.shift() // 保留最近 5 个样本
        }
        this._pingSentTime = 0
        // 动态调整心跳参数
        this.updateHeartbeatFromRtt()
      }

      try {
        const data = JSON.parse(event.data as string)
        this.dispatch(data)
      } catch {
        // 忽略无法解析的消息
      }
    }

    ws.onclose = (event) => {
      if (this.connectTimeoutTimer) {
        clearTimeout(this.connectTimeoutTimer)
        this.connectTimeoutTimer = null
      }
      this.stopHeartbeat()
      this.stopOutputFlush()

      // 只处理当前连接的关闭事件（避免旧连接干扰新连接）
      if (this.ws !== ws) return

      if (this._status === 'connecting') {
        // close 在 open 之前发生 → HTTP upgrade 很可能被拒绝
        const urlBase = this.url.split('?')[0]
        const diag = `Code: ${event.code}, Reason: ${event.reason || '(无)'}, WasClean: ${event.wasClean}, URL: ${urlBase}`
        if (event.code === 1006) {
          this.setError(`连接被拒绝（HTTP upgrade 可能返回了 401/403/500）。${diag}`)
        } else if (event.code !== 1000) {
          this.setError(`连接在建立前被关闭（WebSocket is closed before open）。${diag}`)
        }
        console.error(`[WsClient] 连接失败 — ${diag}`)
      }

      this.setStatus('disconnected')
      this.rejectAllPending(new Error('连接已关闭'))
      this.ws = null
      this.scheduleReconnect()
    }

    ws.onerror = (event) => {
      // 只处理当前连接的错误事件
      if (this.ws !== ws) return
      if (this._status === 'connecting') {
        const urlBase = this.url.split('?')[0]
        const detail = event instanceof Event ? `${urlBase}` : ''
        this.setError(
          `连接错误：无法建立 WebSocket 连接${detail ? ` (${detail})` : ''}，请检查网络和服务状态`,
        )
        console.error(`[WsClient] onerror — URL: ${urlBase}, readyState: ${ws.readyState}`)
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
    this._reconnectFailedCount = 0 // 重置失败计数
    this._messageQueue = [] // 清空消息队列
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.setStatus('disconnected')
  }

  /** 手动重连（用户触发） */
  reconnect() {
    this.reconnectAttempts = 0
    this._reconnectFailedCount = 0
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

  // ─── 自动重连（增强: 指数退避 + jitter ±500ms）───

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return
    if (this.reconnectTimer) return

    const base = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    )
    // jitter ±500ms
    const jitter = Math.random() * 2 * RECONNECT_JITTER_MS - RECONNECT_JITTER_MS
    const delay = Math.max(base + jitter, 0)
    this.reconnectAttempts++
    this._reconnectFailedCount++
    this.setStatus('reconnecting')

    // 增强: 触发 onReconnecting 回调
    const reconnectingHandlers = this._onReconnectingHandlers
    for (let i = 0; i < reconnectingHandlers.length; i++) {
      const fn = reconnectingHandlers[i]
      if (fn) fn()
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  // ─── 增强: 注册/注销重连回调 ───

  /**
   * 注册重连中回调（当客户端开始尝试重连时触发）。
   * 返回取消注册函数。
   */
  onReconnecting(handler: () => void): () => void {
    this._onReconnectingHandlers.push(handler)
    return () => {
      this._onReconnectingHandlers = this._onReconnectingHandlers.filter((h) => h !== handler)
    }
  }

  /**
   * 注册重连成功回调（当客户端成功重连并进入 connected 状态时触发）。
   * 返回取消注册函数。
   */
  onReconnected(handler: () => void): () => void {
    this._onReconnectedHandlers.push(handler)
    return () => {
      this._onReconnectedHandlers = this._onReconnectedHandlers.filter((h) => h !== handler)
    }
  }

  // ─── 消息队列 ───

  /**
   * 连接恢复后重发队列中所有消息。
   */
  private flushMessageQueue() {
    if (this._messageQueue.length === 0) return
    const queue = this._messageQueue
    this._messageQueue = []
    for (let i = 0; i < queue.length; i++) {
      const msg = queue[i]
      if (msg && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(msg)
      }
    }
  }

  // ─── 心跳（增强: 动态间隔 + RTT 监测）───

  private startHeartbeat() {
    this._lastPongTime = Date.now()
    this._rttSamples = []
    this._currentHeartbeatInterval = HEARTBEAT_INTERVAL_MS
    this._currentHeartbeatTimeout = HEARTBEAT_TIMEOUT_MS

    // 使用动态间隔发送 ping
    this.scheduleHeartbeatPing()

    // 看门狗: 定期检查是否超过超时阈值未收到任何消息
    this.heartbeatWatchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this._lastPongTime
      if (elapsed > this._currentHeartbeatTimeout) {
        console.warn(
          `[WsClient] Heartbeat timeout — ${(elapsed / 1000).toFixed(1)}s without response (threshold: ${this._currentHeartbeatTimeout / 1000}s), closing connection`,
        )
        this.setError(`心跳超时：${(elapsed / 1000).toFixed(1)}秒无响应`)
        if (this.ws) {
          this.ws.close()
        }
      }
    }, HEARTBEAT_WATCHDOG_INTERVAL_MS)
  }

  private scheduleHeartbeatPing() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this._pingSentTime = Date.now()
        this.send({ type: 'ping' })
      }
    }, this._currentHeartbeatInterval)
  }

  /**
   * 根据 RTT 样本动态调整心跳参数
   * - 网络良好（RTT < 100ms）：使用标准间隔
   * - 网络一般（100ms < RTT < 500ms）：延长间隔 50%，超时 2x
   * - 网络较差（RTT > 500ms）：延长间隔 100%，超时 3x
   */
  private updateHeartbeatFromRtt() {
    if (this._rttSamples.length < 3) return // 至少 3 个样本

    const avgRtt = this._rttSamples.reduce((a, b) => a + b, 0) / this._rttSamples.length
    const maxRtt = Math.max(...this._rttSamples)

    let newInterval: number
    let newTimeout: number

    if (avgRtt < 100) {
      // 网络良好：标准参数
      newInterval = HEARTBEAT_INTERVAL_MS
      newTimeout = HEARTBEAT_TIMEOUT_MS
    } else if (avgRtt < 500) {
      // 网络一般：适当放宽
      newInterval = HEARTBEAT_INTERVAL_MS * 1.5
      newTimeout = HEARTBEAT_TIMEOUT_MS * 2
    } else {
      // 网络较差：大幅放宽
      newInterval = HEARTBEAT_INTERVAL_MS * 2
      newTimeout = HEARTBEAT_TIMEOUT_MS * 3
    }

    // 额外检查：如果最近有高延迟样本，进一步放宽
    if (maxRtt > 1000) {
      newInterval = Math.max(newInterval, 60_000)
      newTimeout = Math.max(newTimeout, 180_000)
    }

    // 仅在参数变化时更新（避免频繁重置定时器）
    if (
      Math.abs(newInterval - this._currentHeartbeatInterval) > 1000 ||
      Math.abs(newTimeout - this._currentHeartbeatTimeout) > 1000
    ) {
      console.log(
        `[WsClient] Adjusting heartbeat: interval ${(newInterval / 1000).toFixed(0)}s, timeout ${(newTimeout / 1000).toFixed(0)}s (avg RTT: ${avgRtt.toFixed(0)}ms)`,
      )
      this._currentHeartbeatInterval = newInterval
      this._currentHeartbeatTimeout = newTimeout
      this.scheduleHeartbeatPing() // 用新间隔重新调度
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatWatchdogTimer) {
      clearInterval(this.heartbeatWatchdogTimer)
      this.heartbeatWatchdogTimer = null
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

  // ─── 消息收发（增强: 断连时入队）───

  send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = JSON.stringify(data)
      this.ws.send(msg)
      return true
    }
    // 增强: 连接未就绪时入队等待重发
    if (this._status === 'connecting' || this._status === 'reconnecting') {
      this._messageQueue.push(JSON.stringify(data))
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
let _initPromise: Promise<WsClient> | null = null

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
 *
 * 内置单例守卫：多次调用会复用同一个 Promise，避免竞态导致重复 connect()。
 */
export async function getWsClient(): Promise<WsClient> {
  // 如果已有正在进行的初始化，直接返回同一个 Promise
  if (_initPromise) return _initPromise

  _initPromise = (async () => {
    if (!_instance) {
      _instance = new WsClient('')
    }
    const url = await resolveWsUrl()
    _instance.setUrl(url)
    _tokenReady = true
    _instance.connect()
    return _instance
  })()

  // 完成后清除守卫（允许 token 刷新后重新初始化）
  _initPromise.finally(() => {
    // 如果连接失败，清除守卫以便重试
    if (_instance && _instance.status === 'disconnected') {
      _initPromise = null
    }
  })

  return _initPromise
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
 *
 * @deprecated Token in URL query parameter is insecure (exposed in server logs,
 * browser history, proxy logs). Will migrate to first-message auth in a future release.
 * Backend currently accepts both header and query param (with deprecation warning).
 */
export function createTerminalWsClient(token: string): WsClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  const url = `${protocol}//${host}/ws?token=${token}`
  return new WsClient(url)
}
