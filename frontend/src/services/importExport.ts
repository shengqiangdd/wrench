/**
 * SmartBox 配置导入导出服务
 *
 * 功能：
 * - 导出所有可迁移数据（SSH 连接、AI 配置、插件状态、App 设置）
 * - 导入并合并到当前 store / IndexedDB
 * - 支持 AES-GCM 密码加密（复用 crypto.ts）
 * - 导出文件格式：.smartbox 加密 JSON
 *
 * 导出的数据范围：
 * - SSH 连接配置（含密码/私钥 — 导出时仍保持原样，导入时不加密额外加一层）
 * - AI 配置（含 API Key）
 * - 插件状态（启用的插件列表）
 * - App 状态（主题、UI 偏好）
 *
 * 不导出的运行时状态：当前会话、终端分屏、编辑器打开的文件
 */

import { encrypt, decrypt } from './crypto'
import type { SshConnection } from '../types/ssh'

// ─── 导出数据结构 ───

export interface ExportData {
  version: number
  exportedAt: string
  appVersion: string
  data: {
    /** SSH 连接配置 */
    connections: SshConnection[]
    /** AI 配置（含 API Key） */
    aiConfig: {
      apiKey: string
      model: string
      baseUrl: string
      provider?: string
      customBaseUrl?: boolean
      enabled: boolean
    }
    /** 已启用的插件列表 */
    enabledPlugins: string[]
    /** 告警配置 */
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
    /** 应用状态 */
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

const EXPORT_VERSION = 1
const EXPORT_MAGIC = 'SMARTBOX_EXPORT'
const APP_VERSION = 'v0.3.0'

/** 导出文件扩展名 */
export const EXPORT_EXTENSION = '.smartbox'

// ─── 辅助：通知 ───

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  window.dispatchEvent(new CustomEvent('smartbox-notification', { detail: { message, type } }))
}

// ─── 导出 ───

/**
 * 收集所有可导出的数据
 */
export function collectExportData(): ExportData['data'] {
  // 从 localStorage 读取 persisted store 数据
  const getStore = (name: string): unknown => {
    try {
      const raw = localStorage.getItem(name)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return parsed?.state || parsed
    } catch {
      return null
    }
  }

  const sshStore = getStore('smartbox-ssh') as {
    connections?: SshConnection[]
  } | null

  const aiStore = getStore('smartbox-ai') as {
    config?: ExportData['data']['aiConfig']
  } | null

  const pluginStore = getStore('smartbox-plugins') as {
    plugins?: Array<{ manifest: { id: string }; enabled: boolean }>
  } | null

  const appStore = getStore('smartbox-app') as {
    theme?: string
    sidebarCollapsed?: boolean
    activeNav?: string
    sshSidebarOpen?: boolean
    sshSftpOpen?: boolean
    fmSidebarOpen?: boolean
  } | null

  const alertStore = getStore('smartbox-alerts') as {
    enabled?: boolean
    rules?: Array<{
      id: string
      metric: string
      threshold: number
      severity: string
      enabled: boolean
      consecutive: number
    }>
  } | null

  return {
    connections: sshStore?.connections || [],
    aiConfig: aiStore?.config || {
      apiKey: '',
      model: 'deepseek/deepseek-v4-flash:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      provider: 'openrouter',
      customBaseUrl: false,
      enabled: false,
    },
    enabledPlugins: pluginStore?.plugins?.filter((p) => p.enabled).map((p) => p.manifest.id) || [],
    alertConfig: alertStore?.rules
      ? { enabled: alertStore.enabled ?? true, rules: alertStore.rules }
      : undefined,
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

  // 构造下载
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
    // 加密导出
    encrypt(jsonStr, password)
      .then((encrypted) => {
        // 格式: 魔数(16 字节 base64) + 加密内容
        const wrapped = `${EXPORT_MAGIC}|${encrypted}`
        performDownload(wrapped, `smartbox-config-encrypted${EXPORT_EXTENSION}`)
        notify('配置已导出（密码加密）✅', 'success')
      })
      .catch((err) => {
        notify('导出失败：加密出错 ' + err.message, 'error')
      })
  } else {
    // 明文导出
    performDownload(jsonStr, `smartbox-config${EXPORT_EXTENSION}`)
    notify('配置已导出（明文）✅', 'success')
  }
}

// ─── 导入 ───

/**
 * 从文件读取导入数据
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })
}

/**
 * 解析导入文件内容
 */
async function parseImportContent(content: string, password?: string): Promise<ExportData> {
  // 检查是否为加密格式
  if (content.startsWith(EXPORT_MAGIC + '|')) {
    if (!password) {
      throw new Error('此文件已加密，请输入密码')
    }
    const encrypted = content.slice(EXPORT_MAGIC.length + 1)
    const decrypted = await decrypt(encrypted, password)
    return JSON.parse(decrypted)
  }

  // 明文格式
  return JSON.parse(content)
}

/**
 * 验证导入数据的合法性
 */
function validateImportData(data: ExportData): string | null {
  if (!data || typeof data !== 'object') return '无效的配置数据'
  if (data.version !== EXPORT_VERSION) return '配置版本不兼容'
  if (!data.data) return '数据缺失'

  const d = data.data
  if (!Array.isArray(d.connections)) return '连接配置格式错误'
  if (!d.aiConfig || typeof d.aiConfig !== 'object') return 'AI 配置格式错误'
  if (!d.appState || typeof d.appState !== 'object') return '应用状态格式错误'

  return null
}

/**
 * 执行导入 — 写入 localStorage stores
 */
function applyImportData(data: ExportData['data']): void {
  const d = data

  // 1. 导入 SSH 连接
  if (d.connections.length > 0) {
    try {
      const raw = localStorage.getItem('smartbox-ssh')
      const store = raw ? JSON.parse(raw) : { state: { connections: [] } }
      store.state = store.state || {}
      // 合并：导入的连接追加到现有连接后，避免覆盖
      const existingIds = new Set(
        (store.state.connections as SshConnection[])?.map((c: SshConnection) => c.id) || [],
      )
      const newConns = d.connections.filter((c) => !existingIds.has(c.id))
      store.state.connections = [...(store.state.connections || []), ...newConns]
      localStorage.setItem('smartbox-ssh', JSON.stringify(store))
    } catch (e) {
      console.warn('[ImportExport] 导入 SSH 连接失败:', e)
    }
  }

  // 2. 导入 AI 配置
  if (d.aiConfig) {
    try {
      const raw = localStorage.getItem('smartbox-ai')
      const store = raw ? JSON.parse(raw) : { state: {} }
      store.state = store.state || {}
      store.state.config = { ...store.state.config, ...d.aiConfig }
      localStorage.setItem('smartbox-ai', JSON.stringify(store))
    } catch (e) {
      console.warn('[ImportExport] 导入 AI 配置失败:', e)
    }
  }

  // 3. 导入插件状态
  if (d.enabledPlugins.length > 0) {
    try {
      const raw = localStorage.getItem('smartbox-plugins')
      const store = raw ? JSON.parse(raw) : { state: { plugins: [] } }
      store.state = store.state || { plugins: [] }
      const plugins = store.state.plugins || []
      for (const pid of d.enabledPlugins) {
        const existing = plugins.find((p: { manifest: { id: string } }) => p.manifest?.id === pid)
        if (existing) {
          existing.enabled = true
        } else {
          plugins.push({ manifest: { id: pid }, enabled: true })
        }
      }
      store.state.plugins = plugins
      localStorage.setItem('smartbox-plugins', JSON.stringify(store))
    } catch (e) {
      console.warn('[ImportExport] 导入插件状态失败:', e)
    }
  }

  // 4. 导入告警配置
  if (d.alertConfig) {
    try {
      const raw = localStorage.getItem('smartbox-alerts')
      const store = raw ? JSON.parse(raw) : { state: {} }
      store.state = store.state || {}
      store.state.enabled = d.alertConfig.enabled
      store.state.rules = d.alertConfig.rules
      localStorage.setItem('smartbox-alerts', JSON.stringify(store))
    } catch (e) {
      console.warn('[ImportExport] 导入告警配置失败:', e)
    }
  }

  // 5. 导入 App 状态（仅覆盖 UI 偏好）
  if (d.appState) {
    try {
      const raw = localStorage.getItem('smartbox-app')
      const store = raw ? JSON.parse(raw) : { state: {} }
      store.state = store.state || {}
      Object.assign(store.state, d.appState)
      localStorage.setItem('smartbox-app', JSON.stringify(store))
    } catch (e) {
      console.warn('[ImportExport] 导入 App 状态失败:', e)
    }
  }
}

/**
 * 从文件导入配置
 * @param file 用户选择的文件
 * @param password 解密密码（如果文件加密）
 */
export async function importConfig(file: File, password?: string): Promise<void> {
  const content = await readFileAsText(file)

  let data: ExportData
  try {
    data = await parseImportContent(content, password)
  } catch (err: any) {
    if (err.message?.includes('密码错误') || err.message?.includes('请输入密码')) {
      throw err
    }
    throw new Error('解析文件失败：' + (err.message || '格式错误'))
  }

  // 验证
  const validationError = validateImportData(data)
  if (validationError) {
    throw new Error(validationError)
  }

  // 执行导入
  applyImportData(data.data)
}

/**
 * 显示文件选择对话框并执行导入
 */
export async function importConfigFromFile(): Promise<void> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = EXPORT_EXTENSION

  const file = await new Promise<File>((resolve, reject) => {
    input.onchange = () => {
      if (input.files && input.files[0]) {
        resolve(input.files[0])
      } else {
        reject(new Error('未选择文件'))
      }
    }
    input.onerror = () => reject(new Error('文件选择失败'))
    input.click()
  })

  // 尝试明文导入
  const content = await readFileAsText(file)

  if (content.startsWith(EXPORT_MAGIC + '|')) {
    // 加密文件，需要密码 — 通过自定义事件让 UI 弹出密码输入
    return new Promise((resolve, reject) => {
      window.dispatchEvent(
        new CustomEvent('smartbox-import-needs-password', {
          detail: { file, resolve, reject },
        }),
      )
    })
  }

  // 明文导入
  try {
    const data = JSON.parse(content)
    const error = validateImportData(data)
    if (error) throw new Error(error)
    applyImportData(data.data)
    notify(`配置导入成功 ✅（${data.data.connections.length} 个连接，已合并）`, 'success')
  } catch (err: any) {
    notify('导入失败：' + (err.message || '未知错误'), 'error')
    throw err
  }
}

/**
 * 带密码的加密文件导入
 */
export async function importEncryptedFile(file: File, password: string): Promise<void> {
  const content = await readFileAsText(file)
  const data = await parseImportContent(content, password)
  const error = validateImportData(data)
  if (error) throw new Error(error)
  applyImportData(data.data)
  notify(`配置导入成功 ✅（${data.data.connections.length} 个连接，已合并）`, 'success')
}

export default {
  exportConfig,
  importConfig,
  importConfigFromFile,
  importEncryptedFile,
  EXPORT_EXTENSION,
}
