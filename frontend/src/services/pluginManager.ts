/**
 * Wrench 插件管理器 (沙箱版)
 *
 * 使用 iframe 沙箱隔离执行插件代码，替代原有的 new Function() 方式。
 *
 * 负责：
 * 1. 从后端 /api/plugins 获取插件清单
 * 2. 下载插件 JS 代码
 * 3. 创建 iframe 沙箱并在其中执行
 * 4. 通过 postMessage 与沙箱通信
 * 5. 在插件 Store 中注册/注销插件
 */

import { usePluginStore } from '../stores/plugin-store'
import { pluginSandboxManager } from './pluginSandboxManager'
import { authedFetch } from './auth'
import { notify } from './event-bus'
import type { PluginSandboxHandle } from '../components/PluginSandbox'
import type { PluginManifest } from '../types/plugin'

export interface PluginCatalogItem {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon: string
  commands: Array<{
    id: string
    label: string
    description?: string
    icon?: string
    keywords?: string[]
  }>
  panels: Array<{
    id: string
    title: string
    icon?: string
  }>
  entry: string
}

export interface PluginLoadResult {
  id: string
  success: boolean
  error?: string
}

/**
 * 从后端获取所有可用插件清单
 */
export async function fetchPlugins(): Promise<PluginCatalogItem[]> {
  try {
    const response = await authedFetch(`/api/plugins`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const json = await response.json()
    // 后端返回 ApiResponse<Vec<PluginManifest>>，即 { success, data: [...] }
    const rawPlugins = json.data || []
    return rawPlugins.map((p: Record<string, unknown>) => ({
      id: p.id as string,
      name: p.name as string,
      version: p.version as string,
      description: (p.description as string) || '',
      author: (p.author as string) || 'Unknown',
      icon: (p.icon as string) || 'puzzle',
      entry: `/api/plugins/${p.id}/plugin.js`,
      commands: Array.isArray(p.commands)
        ? (p.commands as Array<Record<string, unknown>>).map((c) => ({
            id: c.id as string,
            label: (c.label as string) || (c.id as string),
            description: (c.description as string) || '',
            icon: (c.icon as string) || 'play',
          }))
        : [],
      panels: Array.isArray(p.panels)
        ? (p.panels as Array<Record<string, unknown>>).map((p2) => ({
            id: p2.id as string,
            title: (p2.title as string) || (p2.id as string),
            icon: (p2.icon as string) || 'layout',
          }))
        : [],
    }))
  } catch (err) {
    console.error('[PluginManager] Failed to fetch plugins:', err)
    return []
  }
}

/**
 * 获取插件 JS 代码
 */
export async function fetchPluginCode(entry: string): Promise<string> {
  const response = await authedFetch(entry)
  if (!response.ok) {
    throw new Error(`Failed to load plugin JS: HTTP ${response.status}`)
  }
  return await response.text()
}

/**
 * 获取插件 manifest（从后端）
 */
export async function fetchPluginManifest(pluginId: string): Promise<PluginManifest> {
  const response = await authedFetch(`/api/plugins/${pluginId}/manifest.json`)
  if (!response.ok) {
    throw new Error(`Failed to load manifest: HTTP ${response.status}`)
  }
  return await response.json()
}

/**
 * 加载单个插件到沙箱
 *
 * @param plugin 插件清单条目
 * @param onSandboxReady 沙箱就绪回调（用于组件绑定 iframe 引用）
 * @returns 加载结果
 */
export async function loadPluginToSandbox(plugin: PluginCatalogItem): Promise<PluginLoadResult> {
  try {
    // 1. 下载插件代码（预留：未来可直接注入到沙箱中执行）
    await fetchPluginCode(plugin.entry)

    // 2. 构建 PluginManifest
    const manifest: PluginManifest = {
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      icon: plugin.icon,
      entry: plugin.entry,
      commands: plugin.commands.map((c) => ({
        id: c.id,
        name: c.label || c.id,
        description: c.description,
        icon: c.icon,
      })),
      panels: plugin.panels.map((p) => ({
        id: p.id,
        name: p.title || p.id,
        icon: p.icon,
        position: 'main' as const,
      })),
    }

    // 3. 将插件注册到 Store（标记为已加载，后续由 PluginSandbox 组件执行）
    const store = usePluginStore.getState()
    if (!store.getPlugin(plugin.id)) {
      store.registerPlugin(manifest, {} as never)
    }

    return { id: plugin.id, success: true }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[PluginManager] Failed to load plugin "${plugin.name}":`, err)
    return { id: plugin.id, success: false, error: errMsg }
  }
}

/**
 * 创建沙箱回调处理器
 * 返回一组回调函数，用于 PluginSandbox 组件
 */
export function createSandboxHandlers(pluginId: string) {
  return {
    onCommandRegistered: (_command: { id: string; label?: string; description?: string }) => {
      // 命令已通过 pluginAPI.registerCommand 在沙箱内注册
    },
    onPanelRegistered: (_panel: { id: string; name?: string }) => {
      // 面板已通过 pluginAPI.registerPanel 在沙箱内注册
    },
    onNotification: (message: string, type: 'info' | 'success' | 'error') => {
      notify(message, type)
    },
    onError: (error: string) => {
      console.error(`[Plugin:${pluginId}] Sandbox error:`, error)
    },
    onReady: (handle: PluginSandboxHandle) => {
      pluginSandboxManager.register(
        {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: '',
          author: '',
          entry: '',
          commands: [],
          panels: [],
        } as PluginManifest,
        handle,
      )
    },
  }
}

/**
 * 卸载插件（销毁沙箱）
 */
export function unloadPlugin(pluginId: string) {
  // 从 Store 注销
  const store = usePluginStore.getState()
  store.unregisterPlugin(pluginId)
  // 销毁沙箱
  pluginSandboxManager.unregister(pluginId)
}

/**
 * 执行沙箱中的插件命令
 */
export function executeSandboxCommand(pluginId: string, commandId: string): boolean {
  pluginSandboxManager.executeCommand(pluginId, commandId)
  return pluginSandboxManager.isRegistered(pluginId)
}

/**
 * 同步编辑器内容到插件的沙箱
 */
export function syncEditorToSandbox(
  content: string | null,
  language: string | null,
  _pluginId?: string,
) {
  pluginSandboxManager.syncEditorContent(content ?? '', language)
}
