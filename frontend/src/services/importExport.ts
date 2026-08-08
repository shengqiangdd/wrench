/**
 * Wrench 配置导入导出服务
 *
 * 功能：
 * - 导出所有可迁移数据（SSH 连接、AI 配置、插件状态、App 设置、凭据、通知渠道）
 * - 导入并智能合并到当前 store / 客户端 SQLite
 * - 支持 AES-GCM 密码加密（复用 crypto.ts）
 * - 导出文件格式：.wrench 加密 JSON
 * - 导入时自动去重，支持"合并"和"覆盖"两种模式
 * - 导入前可预览冲突项
 *
 * 导出的数据范围：
 * - SSH 连接配置（含密码/私钥）
 * - AI 配置（含 API Key）
 * - 插件状态（启用的插件列表）
 * - 告警配置
 * - 凭据保险箱条目
 * - 通知渠道配置
 * - App 状态（主题、UI 偏好）
 */

import { encrypt, decrypt } from './crypto'
import { notify, emit } from './event-bus'
import {
  vaultList,
  vaultUpsert,
  connectionsList,
  connectionsUpsert,
  alertRulesList,
  alertRulesUpsert,
  alertRulesClear,
  notificationChannelsList,
  notificationChannelsUpsert,
  notificationChannelsDelete,
  type VaultEntry,
  type ConnectionRow,
} from './client-db'
import type { SshConnection } from '../types/ssh'

// ─── 导出数据结构 ───

export interface ExportData {
  version: number
  exportedAt: string
  appVersion: string
  data: {
    connections: SshConnection[]
    aiConfig: {
      apiKey: string
      model: string
      baseUrl: string
      provider?: string
      customBaseUrl?: boolean
      enabled: boolean
    }
    enabledPlugins: string[]
    alertConfig?: {
      enabled: boolean
      rules: Array<{
        id: string
        metric: string
        threshold: number
        severity: string
        enabled: boolean
        consecutive: number
      }>
    }
    vault?: VaultEntry[]
    notificationChannels?: Array<{
      id: string
      name: string
      type: string
      enabled: boolean
      config: string
    }>
    appState: {
      theme: 'dark' | 'light' | 'system'
      sidebarCollapsed: boolean
      activeNav: string
      sshSidebarOpen: boolean
      sshSftpOpen: boolean
      fmSidebarOpen: boolean
    }
  }
}

/** 导入预览结果 */
export interface ImportPreview {
  connections: { total: number; new: number; conflict: number; conflictNames: string[] }
  alertRules: { total: number; new: number; conflict: number }
  vault: { total: number; new: number; conflict: number }
  notificationChannels: { total: number; new: number; conflict: number }
  aiConfig: { hasChanges: boolean }
  plugins: { total: number; enabled: number }
}

/** 导入模式 */
export type ImportMode = 'merge' | 'replace'

/** 导入结果统计 */
export interface ImportResult {
  mode: ImportMode
  connections: { imported: number; skipped: number }
  alertRules: { imported: number; skipped: number }
  vault: { imported: number; skipped: number }
  notificationChannels: { imported: number; skipped: number }
  aiConfig: boolean
  plugins: number
}

const EXPORT_VERSION = 2
const EXPORT_MAGIC = 'WRENCH_EXPORT'
const APP_VERSION = 'v0.3.0'

export const EXPORT_EXTENSION = '.wrench'

// ─── 辅助 ───
// notify moved to event-bus

function getStore(name: string): unknown {
  try {
    const raw = localStorage.getItem(name)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.state || parsed
  } catch {
    return null
  }
}

/** Convert SQLite ConnectionRow to local SshConnection */
function rowToLocal(row: ConnectionRow): SshConnection {
  let parsedConfig: Record<string, unknown> = {}
  try {
    parsedConfig = JSON.parse(row.config)
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type as 'password' | 'key',
    password: (parsedConfig.password as string) || undefined,
    privateKey: (parsedConfig.private_key as string) || undefined,
    sudoPassword: (parsedConfig.sudo_password as string) || undefined,
    group: (parsedConfig.group as string) || undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  }
}

/** Convert local SshConnection to SQLite row */
function localToRow(conn: SshConnection): ConnectionRow {
  const config: Record<string, unknown> = {}
  if (conn.password) config.password = conn.password
  if (conn.privateKey) config.private_key = conn.privateKey
  if (conn.sudoPassword) config.sudo_password = conn.sudoPassword
  if (conn.group) config.group = conn.group

  const now = new Date().toISOString()
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    auth_type: conn.authType,
    config: JSON.stringify(config),
    sort_order: 0,
    created_at: conn.createdAt ? new Date(conn.createdAt).toISOString() : now,
    updated_at: now,
  }
}

// ─── 导出 ───

/**
 * 收集所有可导出的数据
 */
export function collectExportData(): ExportData['data'] {
  const connections = connectionsList().map(rowToLocal)

  const alertRuleRows = alertRulesList()
  const alertConfig = {
    enabled: true,
    rules: alertRuleRows.map((r) => ({
      id: r.id,
      metric: r.metric,
      threshold: r.threshold,
      severity: r.severity,
      enabled: r.enabled === 1,
      consecutive: r.consecutive,
    })),
  }

  const vault = vaultList()

  const notifyRows = notificationChannelsList()
  const notificationChannels = notifyRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    enabled: r.enabled === 1,
    config: r.config,
  }))

  const aiStore = getStore('wrench-ai') as {
    config?: ExportData['data']['aiConfig']
  } | null

  const pluginStore = getStore('wrench-plugins') as {
    plugins?: Array<{ manifest: { id: string }; enabled: boolean }>
  } | null

  const appStore = getStore('wrench-app') as {
    theme?: string
    sidebarCollapsed?: boolean
    activeNav?: string
    sshSidebarOpen?: boolean
    sshSftpOpen?: boolean
    fmSidebarOpen?: boolean
  } | null

  return {
    connections,
    aiConfig: aiStore?.config || {
      apiKey: '',
      model: 'deepseek/deepseek-v4-flash:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      provider: 'openrouter',
      customBaseUrl: false,
      enabled: false,
    },
    enabledPlugins: pluginStore?.plugins?.filter((p) => p.enabled).map((p) => p.manifest.id) || [],
    alertConfig,
    vault,
    notificationChannels,
    appState: {
      theme: (appStore?.theme as 'dark' | 'light' | 'system') || 'dark',
      sidebarCollapsed: appStore?.sidebarCollapsed ?? false,
      activeNav: appStore?.activeNav || 'ssh',
      sshSidebarOpen: appStore?.sshSidebarOpen ?? true,
      sshSftpOpen: appStore?.sshSftpOpen ?? true,
      fmSidebarOpen: appStore?.fmSidebarOpen ?? true,
    },
  }
}

/**
 * 构建并导出配置（触发文件下载）
 * @param password 可选，如果提供则用 AES-GCM 加密
 */
export function exportConfig(password?: string): void {
  const payload: ExportData = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data: collectExportData(),
  }

  const jsonStr = JSON.stringify(payload, null, 2)

  const performDownload = async (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (password) {
    encrypt(jsonStr, password)
      .then((encrypted) => {
        const magic = EXPORT_MAGIC + '|'
        const content = magic + encrypted
        performDownload(content, `wrench-backup${EXPORT_EXTENSION}`)
        notify('配置已加密导出', 'success')
      })
      .catch((err) => {
        notify('加密失败: ' + (err instanceof Error ? err.message : '未知错误'), 'error')
      })
  } else {
    performDownload(jsonStr, `wrench-backup.json`)
    notify('配置已导出', 'success')
  }
}

// ─── 导入预览 ───

/**
 * 解析导入文件内容，返回 ExportData（不执行导入）
 */
export async function parseImportContent(content: string): Promise<ExportData | null> {
  let jsonStr = content

  if (content.startsWith(EXPORT_MAGIC + '|')) {
    const encrypted = content.slice(EXPORT_MAGIC.length + 1)
    const password = prompt('此备份文件已加密，请输入解密密码：')
    if (!password) return null
    try {
      jsonStr = await decrypt(encrypted, password)
    } catch {
      notify('解密失败，密码可能不正确', 'error')
      return null
    }
  }

  let payload: ExportData
  try {
    payload = JSON.parse(jsonStr)
  } catch {
    notify('文件格式无效', 'error')
    return null
  }

  if (payload.version !== EXPORT_VERSION && payload.version !== 1) {
    notify(`不支持的导出版本: ${payload.version}`, 'error')
    return null
  }

  return payload
}

/**
 * 预览导入内容：统计新增/冲突项数量
 */
export function previewImport(data: ExportData['data']): ImportPreview {
  // 连接去重：按 host+port+username 判断冲突
  const existingConns = connectionsList()
  const existingConnKeys = new Set(existingConns.map((c) => `${c.host}:${c.port}:${c.username}`))
  let connNew = 0
  let connConflict = 0
  const connConflictNames: string[] = []
  for (const conn of data.connections || []) {
    const key = `${conn.host}:${conn.port}:${conn.username}`
    if (existingConnKeys.has(key)) {
      connConflict++
      connConflictNames.push(conn.name || key)
    } else {
      connNew++
    }
  }

  // 告警规则去重：按 metric+threshold 判断
  const existingRules = alertRulesList()
  const existingRuleKeys = new Set(existingRules.map((r) => `${r.metric}:${r.threshold}`))
  let ruleNew = 0
  let ruleConflict = 0
  for (const rule of data.alertConfig?.rules || []) {
    if (existingRuleKeys.has(`${rule.metric}:${rule.threshold}`)) {
      ruleConflict++
    } else {
      ruleNew++
    }
  }

  // 凭据去重：按 name+kind 判断
  const existingVault = vaultList()
  const existingVaultKeys = new Set(existingVault.map((v) => `${v.name}:${v.kind}`))
  let vaultNew = 0
  let vaultConflict = 0
  for (const entry of data.vault || []) {
    if (existingVaultKeys.has(`${entry.name}:${entry.kind}`)) {
      vaultConflict++
    } else {
      vaultNew++
    }
  }

  // 通知渠道去重：按 name+type 判断
  const existingChannels = notificationChannelsList()
  const existingChannelKeys = new Set(existingChannels.map((c) => `${c.name}:${c.type}`))
  let chNew = 0
  let chConflict = 0
  for (const ch of data.notificationChannels || []) {
    if (existingChannelKeys.has(`${ch.name}:${ch.type}`)) {
      chConflict++
    } else {
      chNew++
    }
  }

  // AI 配置
  const aiStore = getStore('wrench-ai') as { config?: Record<string, unknown> } | null
  const aiChanged =
    data.aiConfig && JSON.stringify(data.aiConfig) !== JSON.stringify(aiStore?.config || {})

  // 插件
  const pluginStore = getStore('wrench-plugins') as {
    plugins?: Array<{ manifest: { id: string }; enabled: boolean }>
  } | null
  const existingPluginIds = new Set(pluginStore?.plugins?.map((p) => p.manifest.id) || [])
  const pluginsNew = (data.enabledPlugins || []).filter((id) => !existingPluginIds.has(id)).length

  return {
    connections: {
      total: (data.connections || []).length,
      new: connNew,
      conflict: connConflict,
      conflictNames: connConflictNames,
    },
    alertRules: {
      total: (data.alertConfig?.rules || []).length,
      new: ruleNew,
      conflict: ruleConflict,
    },
    vault: {
      total: (data.vault || []).length,
      new: vaultNew,
      conflict: vaultConflict,
    },
    notificationChannels: {
      total: (data.notificationChannels || []).length,
      new: chNew,
      conflict: chConflict,
    },
    aiConfig: { hasChanges: !!aiChanged },
    plugins: {
      total: (data.enabledPlugins || []).length,
      enabled: pluginsNew,
    },
  }
}

// ─── 导入 ───

/**
 * 智能导入配置
 * @param content 原始文件内容
 * @param mode 'merge'=智能合并（跳过已存在的同名项），'replace'=覆盖（删除旧数据后写入）
 */
export async function importConfig(
  content: string,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const payload = await parseImportContent(content)
  if (!payload) throw new Error('文件解析失败')

  const data = payload.data
  const result: ImportResult = {
    mode,
    connections: { imported: 0, skipped: 0 },
    alertRules: { imported: 0, skipped: 0 },
    vault: { imported: 0, skipped: 0 },
    notificationChannels: { imported: 0, skipped: 0 },
    aiConfig: false,
    plugins: 0,
  }

  // ── replace 模式：先清空旧数据 ──
  if (mode === 'replace') {
    alertRulesClear()
    for (const ch of notificationChannelsList()) {
      notificationChannelsDelete(ch.id)
    }
  }

  // ── SSH 连接 ──
  if (data.connections && Array.isArray(data.connections)) {
    const existingConns = mode === 'merge' ? connectionsList() : []
    const existingKeys = new Set(existingConns.map((c) => `${c.host}:${c.port}:${c.username}`))
    for (const conn of data.connections) {
      const key = `${conn.host}:${conn.port}:${conn.username}`
      if (mode === 'merge' && existingKeys.has(key)) {
        result.connections.skipped++
        continue
      }
      connectionsUpsert(localToRow(conn))
      result.connections.imported++
    }
    emit('wrench-config-imported')
  }

  // ── 告警规则 ──
  if (data.alertConfig?.rules && Array.isArray(data.alertConfig.rules)) {
    const existingRules = mode === 'merge' ? alertRulesList() : []
    const existingKeys = new Set(existingRules.map((r) => `${r.metric}:${r.threshold}`))
    for (const rule of data.alertConfig.rules) {
      const key = `${rule.metric}:${rule.threshold}`
      if (mode === 'merge' && existingKeys.has(key)) {
        result.alertRules.skipped++
        continue
      }
      alertRulesUpsert({
        id: rule.id,
        metric: rule.metric,
        threshold: rule.threshold,
        severity: rule.severity,
        enabled: rule.enabled ? 1 : 0,
        consecutive: rule.consecutive,
      })
      result.alertRules.imported++
    }
  }

  // ── 凭据 ──
  if (data.vault && Array.isArray(data.vault)) {
    const existingVault = mode === 'merge' ? vaultList() : []
    const existingKeys = new Set(existingVault.map((v) => `${v.name}:${v.kind}`))
    for (const entry of data.vault) {
      const key = `${entry.name}:${entry.kind}`
      if (mode === 'merge' && existingKeys.has(key)) {
        result.vault.skipped++
        continue
      }
      vaultUpsert(entry)
      result.vault.imported++
    }
  }

  // ── 通知渠道 ──
  if (data.notificationChannels && Array.isArray(data.notificationChannels)) {
    const existingChannels = mode === 'merge' ? notificationChannelsList() : []
    const existingKeys = new Set(existingChannels.map((c) => `${c.name}:${c.type}`))
    for (const ch of data.notificationChannels) {
      const key = `${ch.name}:${ch.type}`
      if (mode === 'merge' && existingKeys.has(key)) {
        result.notificationChannels.skipped++
        continue
      }
      notificationChannelsUpsert({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        enabled: ch.enabled ? 1 : 0,
        config: ch.config,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      result.notificationChannels.imported++
    }
  }

  // ── AI 配置（合并模式：浅合并；覆盖模式：直接替换）──
  if (data.aiConfig) {
    if (mode === 'replace') {
      localStorage.setItem('wrench-ai', JSON.stringify({ state: { config: data.aiConfig } }))
    } else {
      const aiStore = getStore('wrench-ai') as { config?: Record<string, unknown> } | null
      const merged = { ...((aiStore?.config as Record<string, unknown>) || {}), ...data.aiConfig }
      localStorage.setItem('wrench-ai', JSON.stringify({ state: { config: merged } }))
    }
    result.aiConfig = true
  }

  // ── 插件状态 ──
  if (data.enabledPlugins) {
    const pluginStore = getStore('wrench-plugins') as {
      plugins?: Array<{ manifest: { id: string }; enabled: boolean }>
    } | null

    if (mode === 'replace') {
      // 覆盖：直接写入
      localStorage.setItem(
        'wrench-plugins',
        JSON.stringify({
          state: {
            plugins: (data.enabledPlugins as string[]).map((id) => ({
              manifest: { id },
              enabled: true,
            })),
          },
        }),
      )
      result.plugins = (data.enabledPlugins as string[]).length
    } else {
      // 合并：保留现有插件状态，只追加新的
      const existingPlugins = pluginStore?.plugins || []
      const existingMap = new Map(existingPlugins.map((p) => [p.manifest.id, p]))
      const newPluginIds = data.enabledPlugins as string[]

      for (const id of newPluginIds) {
        if (!existingMap.has(id)) {
          existingMap.set(id, { manifest: { id }, enabled: true })
          result.plugins++
        }
        // 已存在的插件保持其当前 enabled 状态，不覆盖
      }

      localStorage.setItem(
        'wrench-plugins',
        JSON.stringify({
          state: {
            plugins: Array.from(existingMap.values()),
          },
        }),
      )
    }
  }

  // ── App 状态 ──
  if (data.appState) {
    localStorage.setItem('wrench-app', JSON.stringify({ state: data.appState }))
  }

  return result
}

/**
 * 从 File 对象导入配置
 */
export async function importConfigFromFile(
  file: File,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const text = await file.text()
  return await importConfig(text, mode)
}

/**
 * 导入加密文件（带密码）
 */
export async function importEncryptedFile(file: File, password: string): Promise<ImportResult> {
  const text = await file.text()
  let jsonStr = text

  if (text.startsWith(EXPORT_MAGIC + '|')) {
    const encrypted = text.slice(EXPORT_MAGIC.length + 1)
    try {
      jsonStr = await decrypt(encrypted, password)
    } catch {
      throw new Error('解密失败，密码不正确')
    }
  }

  return await importConfig(jsonStr)
}
