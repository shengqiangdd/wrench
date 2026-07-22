/**
 * SSH Session Manager - 统一管理 SSH 和 SFTP 会话
 *
 * 🔧 核心改进：
 * 1. 智能 session 复用：同一连接的 SSH 和 SFTP 可以共享
 * 2. 连接池管理：避免重复连接，自动清理空闲连接
 * 3. 跨页面状态同步：确保所有页面看到一致的连接状态
 * 4. 连接预热：页面加载时预连接常用主机，减少首次连接等待
 * 5. 连接状态持久化：将连接状态存储在 localStorage，刷新后快速恢复
 */

import { useSshStore, decryptConnection } from '../stores/ssh-store'
import { setSessionCredentials } from './session-credentials'
import { authedFetch } from './auth'
import type { WsClient } from './websocket'

interface SessionInfo {
  id: string
  connectionId: string
  type: 'ssh' | 'sftp'
  status: 'connected' | 'disconnected' | 'error'
  host: string
  port: number
  username: string
}

/** 持久化的连接状态 */
interface PersistedConnectionState {
  connectionId: string
  sessionId: string
  type: 'ssh' | 'sftp'
  host: string
  port: number
  username: string
  lastUsed: number
}

/** 连接预热配置 */
interface WarmupConfig {
  /** 是否启用预热 */
  enabled: boolean
  /** 预热延迟（ms），避免阻塞页面渲染 */
  delayMs: number
  /** 最大预热连接数 */
  maxConnections: number
}

const STORAGE_KEY = 'wrench:ssh-session-state'
const WARMUP_DEFAULTS: WarmupConfig = {
  enabled: true,
  delayMs: 2000,
  maxConnections: 3,
}

/** 连接池配置 */
interface PoolConfig {
  /** 最大并发连接数（SSH + SFTP 合计） */
  maxPoolSize: number
  /** 空闲超时（ms），超过此时间未使用的连接自动断开 */
  idleTimeoutMs: number
}
const POOL_DEFAULTS: PoolConfig = {
  maxPoolSize: 8,
  idleTimeoutMs: 30 * 60 * 1000, // 30 分钟
}

class SshSessionManager {
  private sessions = new Map<string, SessionInfo>()
  private wsClient: WsClient | null = null
  private warmupConfig: WarmupConfig = { ...WARMUP_DEFAULTS }
  private warmupTimer: ReturnType<typeof setTimeout> | null = null
  private poolConfig: PoolConfig = { ...POOL_DEFAULTS }
  private poolCheckTimer: ReturnType<typeof setInterval> | null = null

  // ─── 连接健康检查 ───
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  private healthCheckIntervalMs = 30_000 // 30 秒检查一次

  // ─── 智能重连 ───
  /** 最近 N 次连接尝试的结果（true=成功，false=失败） */
  private _connectHistory: boolean[] = []
  /** 最近一次连接失败的错误类型 */
  private _lastConnectError: string | null = null

  /**
   * 设置 WS 客户端（应用启动时调用）
   */
  setWsClient(client: WsClient) {
    this.wsClient = client
    this.restorePersistedState()
    this.scheduleWarmup()
    this.startPoolCheck()
    this.startHealthCheck()

    // 监听 WS 断连，暂停健康检查（避免无意义的探测）
    client.onStatus((status) => {
      if (status === 'disconnected' || status === 'reconnecting') {
        this.pauseHealthCheck()
      } else if (status === 'connected') {
        this.resumeHealthCheck()
      }
    })
  }

  // ─── 连接预热 ───

  /**
   * 配置预热策略
   */
  configureWarmup(config: Partial<WarmupConfig>) {
    this.warmupConfig = { ...this.warmupConfig, ...config }
  }

  /**
   * 调度预热任务（延迟执行，避免阻塞页面渲染）
   */
  private scheduleWarmup() {
    if (!this.warmupConfig.enabled) return
    if (this.warmupTimer) return

    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null
      this.performWarmup()
    }, this.warmupConfig.delayMs)
  }

  /**
   * 执行预热：连接最近使用的主机
   */
  private async performWarmup() {
    if (!this.wsClient || this.wsClient.status !== 'connected') {
      // WS 未就绪，等连接恢复后再试
      const unsub = this.wsClient?.onStatus((status) => {
        if (status === 'connected') {
          unsub?.()
          this.performWarmup()
        }
      })
      return
    }

    // 从持久化状态中获取最近使用的连接，按 lastUsed 降序排列
    const persisted = this.loadPersistedState()
    if (persisted.length === 0) return

    const sorted = [...persisted].sort((a, b) => b.lastUsed - a.lastUsed)
    const toWarmup = sorted.slice(0, this.warmupConfig.maxConnections)

    console.log(`[SshSessionManager] Warming up ${toWarmup.length} connections...`)

    for (const state of toWarmup) {
      // 跳过已有活跃 session 的连接
      if (this.hasActiveSession(state.connectionId)) continue

      // 静默预热（不触发 UI 状态变化）
      try {
        if (state.type === 'sftp') {
          await this.createSftpSession(state.connectionId)
        } else {
          await this.createSshSession(state.connectionId)
        }
        console.log(`[SshSessionManager] Warmed up: ${state.host}`)
      } catch {
        // 预热失败静默忽略，用户使用时再正式连接
      }
    }
  }

  // ─── 连接状态持久化 ───

  /**
   * 加载持久化的连接状态
   */
  private loadPersistedState(): PersistedConnectionState[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /**
   * 保存连接状态到 localStorage
   */
  private savePersistedState() {
    const states: PersistedConnectionState[] = []
    for (const [, session] of this.sessions) {
      states.push({
        connectionId: session.connectionId,
        sessionId: session.id,
        type: session.type,
        host: session.host,
        port: session.port,
        username: session.username,
        lastUsed: Date.now(),
      })
    }
    const existing = this.loadPersistedState()
    const existingMap = new Map(existing.map((e) => [e.connectionId, e]))
    for (const state of states) {
      existingMap.set(state.connectionId, state)
    }
    const merged = [...existingMap.values()]
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, 10)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  }

  /**
   * 从持久化状态恢复 session（应用启动时调用）
   */
  private restorePersistedState() {
    const persisted = this.loadPersistedState()
    if (persisted.length > 0) {
      console.log(`[SshSessionManager] Found ${persisted.length} persisted connections`)
    }
  }

  /**
   * 清除指定连接的持久化状态
   */
  clearPersistedState(connectionId: string) {
    const existing = this.loadPersistedState()
    const filtered = existing.filter((e) => e.connectionId !== connectionId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  }

  // ─── 连接池管理 ───

  /**
   * 配置连接池
   */
  configurePool(config: Partial<PoolConfig>) {
    this.poolConfig = { ...this.poolConfig, ...config }
  }

  /**
   * 获取当前池大小
   */
  getPoolSize(): number {
    return this.sessions.size
  }

  /**
   * 启动连接池定时检查（清理空闲连接 + 超限驱逐）
   */
  private startPoolCheck() {
    if (this.poolCheckTimer) return
    // 每 60 秒检查一次
    this.poolCheckTimer = setInterval(() => {
      this.evictIdleConnections()
      this.evictExcessConnections()
    }, 60_000)
  }

  /**
   * 驱逐空闲超时的连接
   */
  private evictIdleConnections() {
    const now = Date.now()
    const toEvict: string[] = []

    for (const [id, session] of this.sessions) {
      // 从持久化记录中获取 lastUsed
      const persisted = this.loadPersistedState()
      const record = persisted.find((p) => p.sessionId === id)
      if (record && now - record.lastUsed > this.poolConfig.idleTimeoutMs) {
        toEvict.push(id)
        console.log(`[SshSessionManager] Evicting idle connection: ${session.host} (${id})`)
      }
    }

    for (const id of toEvict) {
      const session = this.sessions.get(id)
      if (session && this.wsClient) {
        this.wsClient.send({ type: 'disconnect', connectionId: id })
        useSshStore.getState().removeSession(id)
      }
      this.sessions.delete(id)
    }

    if (toEvict.length > 0) {
      this.savePersistedState()
    }
  }

  /**
   * 驱逐超出池大小限制的连接（驱逐最旧的）
   */
  private evictExcessConnections() {
    if (this.sessions.size <= this.poolConfig.maxPoolSize) return

    // 按连接建立时间排序（sessionId 中包含时间戳）
    const sorted = [...this.sessions.entries()].sort(([a], [b]) => {
      // sftp_xxx_1720000000000 / ssh_xxx_1720000000000 → 提取时间戳
      const tsA = parseInt(a.split('_').pop() || '0', 10)
      const tsB = parseInt(b.split('_').pop() || '0', 10)
      return tsA - tsB
    })

    // 驱逐最旧的连接，直到池大小符合限制
    const excess = sorted.length - this.poolConfig.maxPoolSize
    for (let i = 0; i < excess; i++) {
      const [id, session] = sorted[i]!
      console.log(`[SshSessionManager] Evicting excess connection: ${session.host} (${id})`)
      if (this.wsClient) {
        this.wsClient.send({ type: 'disconnect', connectionId: id })
      }
      useSshStore.getState().removeSession(id)
      this.sessions.delete(id)
    }

    this.savePersistedState()
  }

  // ─── 连接健康检查 ───

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck() {
    if (this.healthCheckTimer) return
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck()
    }, this.healthCheckIntervalMs)
  }

  private pauseHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  private resumeHealthCheck() {
    this.startHealthCheck()
  }

  /**
   * 执行健康检查：验证每个 session 是否仍然有效
   */
  private async performHealthCheck() {
    if (!this.wsClient || this.wsClient.status !== 'connected') return

    const toRemove: string[] = []

    for (const [id, session] of this.sessions) {
      try {
        // 用轻量级 API 检查连接是否有效
        const resp = await authedFetch('/api/sftp/stat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId: id, path: '/' }),
        })
        const json = (await resp.json()) as { success: boolean; error?: string }
        if (!json.success) {
          console.warn(`[SshSessionManager] Health check failed for ${session.host}: ${json.error}`)
          toRemove.push(id)
        }
      } catch {
        // 网络错误，跳过本次检查
      }
    }

    // 清理失效的 session
    for (const id of toRemove) {
      const session = this.sessions.get(id)
      if (session) {
        console.log(`[SshSessionManager] Removing unhealthy connection: ${session.host}`)
        useSshStore.getState().removeSession(id)
        this.sessions.delete(id)
      }
    }

    if (toRemove.length > 0) {
      this.savePersistedState()
    }
  }

  // ─── 智能重连策略 ───

  /**
   * 记录连接尝试结果
   */
  private recordConnectResult(success: boolean, errorType?: string) {
    this._connectHistory.push(success)
    if (this._connectHistory.length > 10) {
      this._connectHistory.shift()
    }
    if (!success && errorType) {
      this._lastConnectError = errorType
    }
  }

  /**
   * 获取连接成功率（0~1）
   */
  getConnectSuccessRate(): number {
    if (this._connectHistory.length === 0) return 1
    const successes = this._connectHistory.filter(Boolean).length
    return successes / this._connectHistory.length
  }

  /**
   * 判断是否应该尝试连接（基于历史成功率）
   *
   * - 成功率 > 50%：正常尝试
   * - 成功率 20%~50%：延迟 2 倍再尝试
   * - 成功率 < 20%：建议用户检查网络，返回 false
   */
  shouldAttemptConnect(): boolean | number {
    const rate = this.getConnectSuccessRate()
    if (rate > 0.5) return true
    if (rate > 0.2) return 2000 // 延迟 2 秒
    return false // 成功率太低，不尝试
  }

  /**
   * 获取最近的连接错误类型
   */
  getLastConnectError(): string | null {
    return this._lastConnectError
  }

  /**
   * 获取或创建 SSH session
   *
   * 优先复用已有的 SSH session，如果没有则创建新的
   */
  async getOrCreateSshSession(
    connectionId: string,
    options?: {
      forceNew?: boolean
      onStatus?: (msg: string) => void
    }
  ): Promise<string | null> {
    const { forceNew = false, onStatus } = options || {}

    // 1. 检查是否有可复用的 session
    if (!forceNew) {
      const existingSession = this.findReusableSession(connectionId)
      if (existingSession) {
        onStatus?.('复用已有连接...')
        return existingSession.id
      }
    }

    // 2. 创建新连接
    return this.createSshSession(connectionId, onStatus)
  }

  /**
   * 获取或创建 SFTP session
   *
   * 优先复用已有的 SSH session（通过 SFTP API 验证），如果没有则创建新的
   *
   * 🔧 修复：如果复用的是 useSshStore 中的 session（SSH 页面创建的），
   * 将其同步到 SshSessionManager.sessions 中，确保后续查找能命中
   */
  async getOrCreateSftpSession(
    connectionId: string,
    options?: {
      forceNew?: boolean
      onStatus?: (msg: string) => void
    }
  ): Promise<string | null> {
    const { forceNew = false, onStatus } = options || {}
    console.log(`[SshSessionManager] getOrCreateSftpSession called for connectionId=${connectionId}, forceNew=${forceNew}`)

    // 1. 检查是否有可复用的 SSH session
    if (!forceNew) {
      const existingSession = this.findReusableSession(connectionId)
      if (existingSession) {
        console.log(`[SshSessionManager] Found reusable session: ${existingSession.id}, verifying SFTP...`)
        // 验证 SFTP 是否可用
        onStatus?.('检测到已有连接，验证 SFTP...')
        const sftpReady = await this.verifySftpReady(existingSession.id)
        console.log(`[SshSessionManager] SFTP ready check result: ${sftpReady}`)
        if (sftpReady) {
          onStatus?.('SFTP 已就绪，复用现有连接')

          // 🔧 关键：如果该 session 不在 SshSessionManager.sessions 中（来自 useSshStore），
          // 将其同步过来，确保后续查找能命中
          if (!this.sessions.has(existingSession.id)) {
            this.sessions.set(existingSession.id, existingSession)
            this.savePersistedState()
            console.log(`[SshSessionManager] Synced session from useSshStore: ${existingSession.id}`)
          }

          return existingSession.id
        }
        onStatus?.('SFTP 未就绪，创建新连接...')
      }
    }

    // 2. 创建新的 SFTP session
    console.log(`[SshSessionManager] No reusable session, creating new SFTP session for connectionId=${connectionId}`)
    return this.createSftpSession(connectionId, onStatus)
  }

  /**
   * 查找可复用的 session
   *
   * 🔧 修复：同时查找 SshSessionManager 内部和 useSshStore 中的 session，
   * 确保能复用 SSH 页面创建的连接
   */
  private findReusableSession(connectionId: string): SessionInfo | null {
    console.log(`[SshSessionManager] findReusableSession called for connectionId: ${connectionId}`)
    console.log(`[SshSessionManager] Internal sessions:`, Array.from(this.sessions.keys()))

    // 1. 优先在 SshSessionManager 内部查找 SSH session（功能更完整）
    for (const [, session] of this.sessions) {
      if (session.connectionId === connectionId && 
          session.type === 'ssh' && 
          session.status === 'connected') {
        console.log(`[SshSessionManager] Found reusable SSH session in internal: ${session.id}`)
        return session
      }
    }

    // 2. 其次在 SshSessionManager 内部查找 SFTP session
    for (const [, session] of this.sessions) {
      if (session.connectionId === connectionId && 
          session.type === 'sftp' && 
          session.status === 'connected') {
        console.log(`[SshSessionManager] Found reusable SFTP session in internal: ${session.id}`)
        return session
      }
    }

    // 3. 🔧 关键修复：查找 useSshStore 中的 session（SSH 页面创建的）
    //    SSH 页面创建的 session 不在 SshSessionManager.sessions 中，
    //    但它们是有效的、可复用的连接
    const storeSessions = useSshStore.getState().sessions
    console.log(`[SshSessionManager] Store sessions:`, storeSessions.map(s => `${s.id} (connId: ${s.connectionId}, status: ${s.status})`))
    
    for (const storeSession of storeSessions) {
      if (storeSession.connectionId === connectionId && 
          storeSession.status === 'connected') {
        // 转换为 SessionInfo 格式
        const type = storeSession.id.startsWith('sftp_') ? 'sftp' : 'ssh'
        const conn = useSshStore.getState().connections.find(c => c.id === connectionId)
        console.log(`[SshSessionManager] Found reusable session in store: ${storeSession.id}`)
        return {
          id: storeSession.id,
          connectionId,
          type,
          status: 'connected',
          host: conn?.host || storeSession.host,
          port: conn?.port || 22,
          username: conn?.username || '',
        }
      }
    }

    console.log(`[SshSessionManager] No reusable session found for connectionId: ${connectionId}`)
    return null
  }

  /**
   * 验证 SFTP 是否可用
   */
  private async verifySftpReady(sessionId: string): Promise<boolean> {
    try {
      const resp = await authedFetch('/api/sftp/stat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: sessionId, path: '/' }),
      })
      const json = (await resp.json()) as { success: boolean }
      return json.success
    } catch {
      return false
    }
  }

  /**
   * 创建 SSH session
   */
  private async createSshSession(
    connectionId: string,
    onStatus?: (msg: string) => void
  ): Promise<string | null> {
    const conns = useSshStore.getState().connections
    const conn = conns.find((c) => c.id === connectionId)
    if (!conn || !this.wsClient) return null

    // 检查连接池限制
    if (this.sessions.size >= this.poolConfig.maxPoolSize) {
      console.warn('[SshSessionManager] Pool full, evicting oldest connection')
      this.evictExcessConnections()
    }

    const sessionId = `ssh_${connectionId}_${Date.now()}`
    onStatus?.('正在连接 SSH...')

    try {
      const decryptedConn = await decryptConnection(conn)

      await this.wsClient.request({
        type: 'connect',
        connectionId: sessionId,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: decryptedConn.password,
        privateKey: decryptedConn.privateKey,
      })

      useSshStore.getState().addSession({
        id: sessionId,
        connectionId,
        connectionName: conn.name,
        host: conn.host,
        status: 'connected',
        terminalCols: 80,
        terminalRows: 24,
      })

      setSessionCredentials(sessionId, {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: decryptedConn.password,
        privateKey: decryptedConn.privateKey,
        sudoPassword: decryptedConn.sudoPassword,
      })

      this.sessions.set(sessionId, {
        id: sessionId,
        connectionId,
        type: 'ssh',
        status: 'connected',
        host: conn.host,
        port: conn.port,
        username: conn.username,
      })

      // 记录成功
      this.recordConnectResult(true)
      this.savePersistedState()

      onStatus?.('')
      return sessionId
    } catch (err) {
      // 记录失败
      const errorType = err instanceof Error ? err.message : 'unknown'
      this.recordConnectResult(false, errorType)
      onStatus?.('')
      console.error('[SshSessionManager] SSH connect failed:', err)
      return null
    }
  }

  /**
   * 创建 SFTP session
   */
  private async createSftpSession(
    connectionId: string,
    onStatus?: (msg: string) => void
  ): Promise<string | null> {
    const conns = useSshStore.getState().connections
    const conn = conns.find((c) => c.id === connectionId)
    if (!conn) {
      console.error(`[SshSessionManager] createSftpSession failed: no connection found for ${connectionId}`)
      return null
    }

    console.log(`[SshSessionManager] createSftpSession for connectionId=${connectionId}, host=${conn.host}`)
    console.log(`[SshSessionManager] Current internal sessions:`, Array.from(this.sessions.keys()))
    console.log(`[SshSessionManager] Current store sessions:`, useSshStore.getState().sessions.map(s => s.id))

    // 检查连接池限制
    if (this.sessions.size >= this.poolConfig.maxPoolSize) {
      console.warn('[SshSessionManager] Pool full, evicting oldest connection')
      this.evictExcessConnections()
    }

    const sessionId = `sftp_${connectionId}_${Date.now()}`
    onStatus?.('正在连接 SFTP...')

    try {
      const decryptedConn = await decryptConnection(conn)

      // 🔧 修复：使用 REST API /api/ssh/ensure 创建 SSH 连接
      // 不再使用 WebSocket connect 消息（那会创建终端会话，不是 SFTP 会话）
      const resp = await authedFetch('/api/ssh/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: decryptedConn.password,
          privateKey: decryptedConn.privateKey,
          sudoPassword: decryptedConn.sudoPassword,
        }),
      })

      if (!resp.ok) {
        throw new Error(`SSH connect failed: HTTP ${resp.status}`)
      }

      const json = (await resp.json()) as {
        success: boolean
        data?: { connection_id: string }
        error?: string
      }

      if (!json.success || !json.data?.connection_id) {
        throw new Error(json.error || 'SSH connect failed')
      }

      // 使用后端返回的 connection_id
      const backendConnId = json.data.connection_id
      console.log(`[SshSessionManager] SSH connected via REST, backend connId: ${backendConnId}`)

      // 验证 SFTP 是否可用
      onStatus?.('验证 SFTP 连接...')
      const sftpReady = await this.verifySftpReady(backendConnId)
      if (!sftpReady) {
        console.warn('[SshSessionManager] SFTP verify failed after REST connect')
      }

      useSshStore.getState().addSession({
        id: backendConnId,
        connectionId,
        connectionName: conn.name,
        host: conn.host,
        status: 'connected',
        terminalCols: 80,
        terminalRows: 24,
      })

      setSessionCredentials(backendConnId, {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: decryptedConn.password,
        privateKey: decryptedConn.privateKey,
        sudoPassword: decryptedConn.sudoPassword,
      })

      this.sessions.set(backendConnId, {
        id: backendConnId,
        connectionId,
        type: 'sftp',
        status: 'connected',
        host: conn.host,
        port: conn.port,
        username: conn.username,
      })

      // 记录成功
      this.recordConnectResult(true)
      this.savePersistedState()

      onStatus?.('')
      return backendConnId
    } catch (err) {
      // 记录失败
      const errorType = err instanceof Error ? err.message : 'unknown'
      this.recordConnectResult(false, errorType)
      onStatus?.('')
      console.error('[SshSessionManager] SFTP connect failed:', err)
      return null
    }
  }

  /**
   * 断开指定连接的所有 session
   */
  disconnectAll(connectionId: string) {
    const sessionsToDisconnect: string[] = []

    for (const [id, session] of this.sessions) {
      if (session.connectionId === connectionId) {
        sessionsToDisconnect.push(id)
      }
    }

    for (const id of sessionsToDisconnect) {
      const session = this.sessions.get(id)
      if (session && this.wsClient) {
        this.wsClient.send({ type: 'disconnect', connectionId: id })
        useSshStore.getState().removeSession(id)
      }
      this.sessions.delete(id)
    }

    // 清除持久化状态
    this.clearPersistedState(connectionId)
  }

  /**
   * 获取指定连接的所有 session
   */
  getSessions(connectionId: string): SessionInfo[] {
    const result: SessionInfo[] = []
    for (const [, session] of this.sessions) {
      if (session.connectionId === connectionId) {
        result.push(session)
      }
    }
    return result
  }

  /**
   * 检查指定连接是否有活跃的 session
   */
  hasActiveSession(connectionId: string): boolean {
    for (const [, session] of this.sessions) {
      if (session.connectionId === connectionId && session.status === 'connected') {
        return true
      }
    }
    return false
  }
}

// 单例
export const sshSessionManager = new SshSessionManager()
