/**
 * SmartBox 插件管理器 (沙箱版)
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
    const response = await fetch(`/api/plugins`)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    const data = await response.json()
    return data.plugins || []
  } catch (err) {
    console.error('[PluginManager] Failed to fetch plugins:', err)
    return []
  }
}

/**
 * 获取插件 JS 代码
 */
export async function fetchPluginCode(entry: string): Promise<string> {
  const response = await fetch(entry)
  if (!response.ok) {
    throw new Error(`Failed to load plugin JS: HTTP ${response.status}`)
  }
  return await response.text()
}

/**
 * 获取插件 manifest（从后端）
 */
export async function fetchPluginManifest(pluginId: string): Promise<any> {
  const response = await fetch(`/api/plugins/${pluginId}/manifest.json`)
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
    // 1. 下载插件代码
    const code = await fetchPluginCode(plugin.entry)

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
      store.registerPlugin(manifest, {} as any)
    }

    return { id: plugin.id, success: true }
  } catch (err: any) {
    console.error(`[PluginManager] Failed to load plugin "${plugin.name}":`, err)
    return { id: plugin.id, success: false, error: err.message }
  }
}

/**
 * 创建沙箱回调处理器
 * 返回一组回调函数，用于 PluginSandbox 组件
 */
export function createSandboxHandlers(pluginId: string) {
  return {
    onCommandRegistered: (command: { id: string; label?: string; description?: string }) => {
      pluginSandboxManager.addCommand(pluginId, command)
    },
    onPanelRegistered: (panel: { id: string; name?: string }) => {
      pluginSandboxManager.addPanel(pluginId, panel)
    },
    onNotification: (message: string, type: 'info' | 'success' | 'error') => {
      window.dispatchEvent(
        new CustomEvent('smartbox-notification', {
          detail: { message, type },
        }),
      )
    },
    onError: (error: string) => {
      console.error(`[Plugin:${pluginId}] Sandbox error:`, error)
    },
    onReady: (handle: PluginSandboxHandle) => {
      pluginSandboxManager.register(
        pluginId,
        {
          id: pluginId,
          name: pluginId,
          version: '1.0.0',
          description: '',
          author: '',
          entry: '',
          commands: [],
          panels: [],
        } as any,
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
  return pluginSandboxManager.executeCommand(pluginId, commandId)
}

/**
 * 同步编辑器内容到插件的沙箱
 */
export function syncEditorToSandbox(
  content: string | null,
  language: string | null,
  pluginId?: string,
) {
  pluginSandboxManager.syncEditorContent(content, language, pluginId)
}
