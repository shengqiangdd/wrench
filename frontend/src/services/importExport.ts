/**
 * Wrench 配置导入导出服务
 *
 * 功能：
 * - 导出所有可迁移数据（SSH 连接、AI 配置、插件状态、App 设置、凭据、通知渠道）
 * - 导入并合并到当前 store / 客户端 SQLite
 * - 支持 AES-GCM 密码加密（复用 crypto.ts）
 * - 导出文件格式：.wrench 加密 JSON
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
import {
  vaultList,
  vaultUpsert,
  connectionsList,
  connectionsUpsert,
  alertRulesList,
  alertRulesUpsert,
  notificationChannelsList,
  notificationChannelsUpsert,
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

const EXPORT_VERSION = 2
const EXPORT_MAGIC = 'WRENCH_EXPORT'
const APP_VERSION = 'v0.3.0'

export const EXPORT_EXTENSION = '.wrench'

// ─── 辅助 ───

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('wrench-notification', { detail: { message, type } }))
}

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
  // SSH 连接：从客户端 SQLite
  const connections = connectionsList().map(rowToLocal)

  // 告警规则：从客户端 SQLite
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

  // 凭据保险箱：从客户端 SQLite
  const vault = vaultList()

  // 通知渠道：从客户端 SQLite
  const notifyRows = notificationChannelsList()
  const notificationChannels = notifyRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    enabled: r.enabled === 1,
    config: r.config,
  }))

  // AI 配置：从 localStorage（不迁移到 SQLite）
  const aiStore = getStore('wrench-ai') as {
    config?: ExportData['data']['aiConfig']
  } | null

  // 插件状态：从 localStorage
  const pluginStore = getStore('wrench-plugins') as {
    plugins?: Array<{ manifest: { id: string }; enabled: boolean }>
  } | null

  // App 状态：从 localStorage
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

// ─── 导入 ───

/**
 * 导入配置（从文件内容）
 */
export async function importConfig(content: string): Promise<void> {
  let jsonStr = content

  // 检测是否加密文件
  if (content.startsWith(EXPORT_MAGIC + '|')) {
    const encrypted = content.slice(EXPORT_MAGIC.length + 1)
    const password = prompt('此备份文件已加密，请输入解密密码：')
    if (!password) {
      notify('导入已取消', 'info')
      return
    }
    try {
      jsonStr = await decrypt(encrypted, password)
    } catch {
      notify('解密失败，密码可能不正确', 'error')
      return
    }
  }

  let payload: ExportData
  try {
    payload = JSON.parse(jsonStr)
  } catch {
    notify('文件格式无效', 'error')
    return
  }

  if (payload.version !== EXPORT_VERSION && payload.version !== 1) {
    notify(`不支持的导出版本: ${payload.version}`, 'error')
    return
  }

  const data = payload.data

  // 导入 SSH 连接到 SQLite
  if (data.connections && Array.isArray(data.connections)) {
    for (const conn of data.connections) {
      connectionsUpsert(localToRow(conn))
    }
    // 触发 ssh-store 刷新
    window.dispatchEvent(new Event('wrench-config-imported'))
  }

  // 导入告警规则到 SQLite
  if (data.alertConfig?.rules && Array.isArray(data.alertConfig.rules)) {
    for (const rule of data.alertConfig.rules) {
      alertRulesUpsert({
        id: rule.id,
        metric: rule.metric,
        threshold: rule.threshold,
        severity: rule.severity,
        enabled: rule.enabled ? 1 : 0,
        consecutive: rule.consecutive,
      })
    }
  }

  // 导入凭据到 SQLite
  if (data.vault && Array.isArray(data.vault)) {
    for (const entry of data.vault) {
      vaultUpsert(entry)
    }
  }

  // 导入通知渠道到 SQLite
  if (data.notificationChannels && Array.isArray(data.notificationChannels)) {
    for (const ch of data.notificationChannels) {
      notificationChannelsUpsert({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        enabled: ch.enabled ? 1 : 0,
        config: ch.config,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
    }
  }

  // 导入 AI 配置到 localStorage
  if (data.aiConfig) {
    const aiStore = getStore('wrench-ai') as { config?: Record<string, unknown> } | null
    const merged = { ...((aiStore?.config as Record<string, unknown>) || {}), ...data.aiConfig }
    localStorage.setItem('wrench-ai', JSON.stringify({ state: { config: merged } }))
  }

  // 导入插件状态
  if (data.enabledPlugins) {
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
  }

  // 导入 App 状态
  if (data.appState) {
    localStorage.setItem('wrench-app', JSON.stringify({ state: data.appState }))
  }

  notify('配置导入成功，页面将刷新', 'success')
  setTimeout(() => window.location.reload(), 1500)
}

/**
 * 从 File 对象导入配置
 */
export async function importConfigFromFile(file: File): Promise<void> {
  const text = await file.text()
  await importConfig(text)
}

/**
 * 导入加密文件（带密码）
 */
export async function importEncryptedFile(file: File, password: string): Promise<void> {
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

  // 直接调用 importConfig（会再次尝试解密，但因为已经是明文所以跳过加密检测）
  await importConfig(jsonStr)
}
