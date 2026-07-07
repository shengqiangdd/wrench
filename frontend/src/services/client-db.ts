/**
 * client-db.ts — 客户端 SQLite 数据库服务
 *
 * 使用 sql.js（SQLite compiled to WASM）在浏览器中运行 SQLite 数据库。
 * 数据通过 IndexedDB 持久化，每个浏览器/用户独立存储。
 *
 * 表结构：
 * - vault_entries: 凭据保险箱
 * - connections: SSH 连接配置
 * - alert_rules: 告警规则
 * - alert_history: 告警历史
 * - notification_channels: 通知渠道配置
 */

import initSqlJs, { type Database } from 'sql.js'

// ─── 常量 ───

const DB_NAME = 'smartbox_client_db'
const DB_STORE = 'sqlite'
const DB_KEY = 'main'
const SAVE_DEBOUNCE_MS = 500

// ─── 类型定义 ───

export interface VaultEntry {
  id: string
  name: string
  kind: string
  value: string
  tags: string // JSON array stored as text
  createdAt: string
  updatedAt: string
}

export interface ConnectionRow {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  config: string // JSON string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface AlertRuleRow {
  id: string
  metric: string
  threshold: number
  severity: string
  enabled: number // 0 or 1
  consecutive: number
}

export interface AlertEventRow {
  id: string
  ruleId: string
  hostId: string
  hostName: string
  metric: string
  value: number
  threshold: number
  severity: string
  timestamp: number
  notified: number // 0 or 1
}

export interface NotificationChannelRow {
  id: string
  name: string
  type: string
  enabled: number // 0 or 1
  config: string // JSON string
  created_at: string
  updated_at: string
}

// ─── 数据库实例 ───

let db: Database | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let _initialized = false

/** 数据库是否已初始化 */
export function isDbReady(): boolean {
  return _initialized && db !== null
}

/** 获取数据库大小（字节） */
export function getDbSize(): number {
  if (!db) return 0
  const data = db.export()
  return data.length
}

// ─── IndexedDB 持久化 ───

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadFromIdb(): Promise<Uint8Array | null> {
  try {
    const idb = await openIdb()
    return new Promise((resolve) => {
      const tx = idb.transaction(DB_STORE, 'readonly')
      const store = tx.objectStore(DB_STORE)
      const req = store.get(DB_KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function saveToIdb(data: Uint8Array): Promise<void> {
  try {
    const idb = await openIdb()
    const tx = idb.transaction(DB_STORE, 'readwrite')
    const store = tx.objectStore(DB_STORE)
    store.put(data, DB_KEY)
  } catch {
    /* IndexedDB 不可用时静默失败 */
  }
}

/** 防抖保存到 IndexedDB */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (db) {
      const data = db.export()
      saveToIdb(data)
    }
  }, SAVE_DEBOUNCE_MS)
}

// ─── Schema 初始化 ───

function initSchema(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'password',
      value TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL DEFAULT 'root',
      auth_type TEXT NOT NULL DEFAULT 'password',
      config TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      metric TEXT NOT NULL,
      threshold INTEGER NOT NULL DEFAULT 80,
      severity TEXT NOT NULL DEFAULT 'warning',
      enabled INTEGER NOT NULL DEFAULT 1,
      consecutive INTEGER NOT NULL DEFAULT 3
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id TEXT PRIMARY KEY,
      ruleId TEXT NOT NULL,
      hostId TEXT NOT NULL,
      hostName TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      severity TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
}

// ─── localStorage 迁移 ───

function migrateFromLocalStorage(database: Database): void {
  // 迁移 SSH 连接
  try {
    const raw = localStorage.getItem('smartbox-ssh')
    if (raw) {
      const parsed = JSON.parse(raw)
      const state = parsed?.state || parsed
      const connections: Array<{
        id: string
        name: string
        host: string
        port: number
        username: string
        authType: string
        password?: string
        privateKey?: string
        sudoPassword?: string
        group?: string
        createdAt: number
      }> = state?.connections || []

      if (connections.length > 0) {
        const stmt = database.prepare(
          `INSERT OR IGNORE INTO connections (id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        for (const c of connections) {
          const config: Record<string, unknown> = {}
          if (c.password) config.password = c.password
          if (c.privateKey) config.private_key = c.privateKey
          if (c.sudoPassword) config.sudo_password = c.sudoPassword
          if (c.group) config.group = c.group

          const now = new Date().toISOString()
          stmt.run([
            c.id,
            c.name,
            c.host,
            c.port,
            c.username,
            c.authType || 'password',
            JSON.stringify(config),
            c.createdAt ? new Date(c.createdAt).toISOString() : now,
            now,
          ])
        }
        stmt.free()
        console.log(`[ClientDB] Migrated ${connections.length} SSH connections from localStorage`)
      }
    }
  } catch (e) {
    console.warn('[ClientDB] Failed to migrate SSH connections:', e)
  }

  // 迁移告警规则
  try {
    const raw = localStorage.getItem('smartbox-alerts')
    if (raw) {
      const parsed = JSON.parse(raw)
      const state = parsed?.state || parsed
      const rules: Array<{
        id: string
        metric: string
        threshold: number
        severity: string
        enabled: boolean
        consecutive: number
      }> = state?.rules || []
      const history: Array<{
        id: string
        ruleId: string
        hostId: string
        hostName: string
        metric: string
        value: number
        threshold: number
        severity: string
        timestamp: number
        notified: boolean
      }> = state?.history || []

      if (rules.length > 0) {
        const stmt = database.prepare(
          `INSERT OR IGNORE INTO alert_rules (id, metric, threshold, severity, enabled, consecutive)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        for (const r of rules) {
          stmt.run([r.id, r.metric, r.threshold, r.severity, r.enabled ? 1 : 0, r.consecutive])
        }
        stmt.free()
        console.log(`[ClientDB] Migrated ${rules.length} alert rules from localStorage`)
      }
      if (history.length > 0) {
        const stmt = database.prepare(
          `INSERT OR IGNORE INTO alert_history (id, ruleId, hostId, hostName, metric, value, threshold, severity, timestamp, notified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const h of history) {
          stmt.run([
            h.id, h.ruleId, h.hostId, h.hostName, h.metric,
            h.value, h.threshold, h.severity, h.timestamp, h.notified ? 1 : 0,
          ])
        }
        stmt.free()
        console.log(`[ClientDB] Migrated ${history.length} alert events from localStorage`)
      }
    }
  } catch (e) {
    console.warn('[ClientDB] Failed to migrate alert data:', e)
  }
}

// ─── 初始化 ───

let initPromise: Promise<Database> | null = null

/**
 * 初始化客户端 SQLite 数据库。
 * 幂等：多次调用返回同一个实例。
 */
export async function initClientDb(): Promise<Database> {
  if (db) return db
  if (initPromise) return initPromise

  initPromise = (async () => {
    const SQL = await initSqlJs({
      locateFile: (file: string) => `/${file}`,
    })

    // 尝试从 IndexedDB 加载已有数据
    const saved = await loadFromIdb()
    let database: Database
    if (saved) {
      database = new SQL.Database(saved)
      console.log('[ClientDB] Loaded existing database from IndexedDB')
    } else {
      database = new SQL.Database()
      console.log('[ClientDB] Created new database')
    }

    // 初始化 schema
    initSchema(database)

    // 如果是空数据库，从 localStorage 迁移
    const count = database.exec('SELECT COUNT(*) FROM connections')
    const isEmpty = !count.length || count[0]!.values[0]![0] === 0
    if (isEmpty) {
      migrateFromLocalStorage(database)
      // 迁移后保存
      const data = database.export()
      await saveToIdb(data)
    }

    db = database
    _initialized = true
    return database
  })()

  return initPromise
}

// ─── Vault 操作 ───

export function vaultList(): VaultEntry[] {
  if (!db) return []
  const result = db.exec('SELECT * FROM vault_entries ORDER BY createdAt DESC')
  if (!result.length) return []
  return result[0]!.values.map((row: unknown[]) => ({
    id: row[0] as string,
    name: row[1] as string,
    kind: row[2] as string,
    value: row[3] as string,
    tags: row[4] as string,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  }))
}

export function vaultGet(id: string): VaultEntry | null {
  if (!db) return null
  const result = db.exec('SELECT * FROM vault_entries WHERE id = ?', [id])
  if (!result.length || !result[0]!.values.length) return null
  const row = result[0]!.values[0]!
  return {
    id: row[0] as string,
    name: row[1] as string,
    kind: row[2] as string,
    value: row[3] as string,
    tags: row[4] as string,
    createdAt: row[5] as string,
    updatedAt: row[6] as string,
  }
}

export function vaultUpsert(entry: VaultEntry): void {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO vault_entries (id, name, kind, value, tags, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [entry.id, entry.name, entry.kind, entry.value, entry.tags, entry.createdAt, entry.updatedAt],
  )
  scheduleSave()
}

export function vaultDelete(id: string): void {
  if (!db) return
  db.run('DELETE FROM vault_entries WHERE id = ?', [id])
  scheduleSave()
}

// ─── Connection 操作 ───

export function connectionsList(): ConnectionRow[] {
  if (!db) return []
  const result = db.exec('SELECT * FROM connections ORDER BY sort_order ASC, created_at ASC')
  if (!result.length) return []
  return result[0]!.values.map((row: unknown[]) => ({
    id: row[0] as string,
    name: row[1] as string,
    host: row[2] as string,
    port: row[3] as number,
    username: row[4] as string,
    auth_type: row[5] as string,
    config: row[6] as string,
    sort_order: row[7] as number,
    created_at: row[8] as string,
    updated_at: row[9] as string,
  }))
}

export function connectionsUpsert(row: ConnectionRow): void {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO connections (id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.host, row.port, row.username, row.auth_type, row.config, row.sort_order, row.created_at, row.updated_at],
  )
  scheduleSave()
}

export function connectionsDelete(id: string): void {
  if (!db) return
  db.run('DELETE FROM connections WHERE id = ?', [id])
  scheduleSave()
}

// ─── Alert Rules 操作 ───

export function alertRulesList(): AlertRuleRow[] {
  if (!db) return []
  const result = db.exec('SELECT * FROM alert_rules')
  if (!result.length) return []
  return result[0]!.values.map((row: unknown[]) => ({
    id: row[0] as string,
    metric: row[1] as string,
    threshold: row[2] as number,
    severity: row[3] as string,
    enabled: row[4] as number,
    consecutive: row[5] as number,
  }))
}

export function alertRulesUpsert(row: AlertRuleRow): void {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO alert_rules (id, metric, threshold, severity, enabled, consecutive)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.id, row.metric, row.threshold, row.severity, row.enabled, row.consecutive],
  )
  scheduleSave()
}

export function alertRulesDelete(id: string): void {
  if (!db) return
  db.run('DELETE FROM alert_rules WHERE id = ?', [id])
  scheduleSave()
}

export function alertRulesClear(): void {
  if (!db) return
  db.run('DELETE FROM alert_rules')
  scheduleSave()
}

// ─── Alert History 操作 ───

export function alertHistoryList(limit = 100): AlertEventRow[] {
  if (!db) return []
  const result = db.exec(`SELECT * FROM alert_history ORDER BY timestamp DESC LIMIT ${limit}`)
  if (!result.length) return []
  return result[0]!.values.map((row: unknown[]) => ({
    id: row[0] as string,
    ruleId: row[1] as string,
    hostId: row[2] as string,
    hostName: row[3] as string,
    metric: row[4] as string,
    value: row[5] as number,
    threshold: row[6] as number,
    severity: row[7] as string,
    timestamp: row[8] as number,
    notified: row[9] as number,
  }))
}

export function alertHistoryInsert(row: AlertEventRow): void {
  if (!db) return
  db.run(
    `INSERT OR IGNORE INTO alert_history (id, ruleId, hostId, hostName, metric, value, threshold, severity, timestamp, notified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.ruleId, row.hostId, row.hostName, row.metric, row.value, row.threshold, row.severity, row.timestamp, row.notified],
  )
  scheduleSave()
}

export function alertHistoryClear(): void {
  if (!db) return
  db.run('DELETE FROM alert_history')
  scheduleSave()
}

// ─── Notification Channels 操作 ───

export function notificationChannelsList(): NotificationChannelRow[] {
  if (!db) return []
  const result = db.exec('SELECT * FROM notification_channels ORDER BY created_at DESC')
  if (!result.length) return []
  return result[0]!.values.map((row: unknown[]) => ({
    id: row[0] as string,
    name: row[1] as string,
    type: row[2] as string,
    enabled: row[3] as number,
    config: row[4] as string,
    created_at: row[5] as string,
    updated_at: row[6] as string,
  }))
}

export function notificationChannelsUpsert(row: NotificationChannelRow): void {
  if (!db) return
  db.run(
    `INSERT OR REPLACE INTO notification_channels (id, name, type, enabled, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.type, row.enabled, row.config, row.created_at, row.updated_at],
  )
  scheduleSave()
}

export function notificationChannelsDelete(id: string): void {
  if (!db) return
  db.run('DELETE FROM notification_channels WHERE id = ?', [id])
  scheduleSave()
}

// ─── 导出/导入 ───

/** 导出数据库为 JSON（供导入导出功能使用） */
export function exportDbJson(): Record<string, unknown> {
  return {
    vault: vaultList(),
    connections: connectionsList(),
    alertRules: alertRulesList(),
    alertHistory: alertHistoryList(1000),
    notificationChannels: notificationChannelsList(),
  }
}

/** 从 JSON 导入数据（覆盖现有数据） */
export function importDbJson(data: Record<string, unknown>): void {
  if (!db) return

  // 清空所有表
  db.run('DELETE FROM vault_entries')
  db.run('DELETE FROM connections')
  db.run('DELETE FROM alert_rules')
  db.run('DELETE FROM alert_history')
  db.run('DELETE FROM notification_channels')

  // 导入 vault
  if (Array.isArray(data.vault)) {
    for (const entry of data.vault as VaultEntry[]) {
      vaultUpsert(entry)
    }
  }

  // 导入 connections
  if (Array.isArray(data.connections)) {
    for (const row of data.connections as ConnectionRow[]) {
      connectionsUpsert(row)
    }
  }

  // 导入 alert rules
  if (Array.isArray(data.alertRules)) {
    for (const row of data.alertRules as AlertRuleRow[]) {
      alertRulesUpsert(row)
    }
  }

  // 导入 alert history
  if (Array.isArray(data.alertHistory)) {
    for (const row of data.alertHistory as AlertEventRow[]) {
      alertHistoryInsert(row)
    }
  }

  // 导入 notification channels
  if (Array.isArray(data.notificationChannels)) {
    for (const row of data.notificationChannels as NotificationChannelRow[]) {
      notificationChannelsUpsert(row)
    }
  }

  // 强制保存
  if (db) {
    const binary = db.export()
    saveToIdb(binary)
  }
}

// ─── 清理旧 localStorage ───

/** 迁移完成后清理旧的 localStorage 数据 */
export function cleanupOldLocalStorage(): void {
  try {
    // 保留 smartbox-app（主题/UI 状态）和 smartbox-ai（AI 配置）和 smartbox-plugins（插件状态）
    // 清理已迁移到 SQLite 的 store
    if (localStorage.getItem('smartbox-ssh')) {
      localStorage.removeItem('smartbox-ssh')
      console.log('[ClientDB] Cleaned up old smartbox-ssh from localStorage')
    }
    if (localStorage.getItem('smartbox-alerts')) {
      localStorage.removeItem('smartbox-alerts')
      console.log('[ClientDB] Cleaned up old smartbox-alerts from localStorage')
    }
  } catch {
    /* localStorage 不可用时静默失败 */
  }
}
