/**
 * SmartBox 插件管理器
 *
 * 负责：
 * 1. 从后端 /api/plugins 获取插件清单
 * 2. 动态加载插件的 plugin.js
 * 3. 在插件 Store 中注册/注销插件
 */

import { usePluginStore } from '../stores/plugin-store'
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
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    const host = window.location.host
    // 开发环境下直接请求后端端口
    const baseUrl = `http://localhost:3001`

    const response = await fetch(`${baseUrl}/api/plugins`)
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
 * 加载单个插件的 JS 文件
 */
export async function loadPluginScript(plugin: PluginCatalogItem): Promise<PluginLoadResult> {
  try {
    const baseUrl = `http://localhost:3001`
    const response = await fetch(`${baseUrl}${plugin.entry}`)
    if (!response.ok) {
      throw new Error(`Failed to load plugin JS: HTTP ${response.status}`)
    }

    const code = await response.text()

    // 创建并注入 <script> 标签来执行插件代码
    // 插件代码会调用 SmartBox.getPluginAPI() 注册自己
    await executePluginCode(plugin.id, code)

    // 将插件注册到 Store
    const store = usePluginStore.getState()
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
        position: 'main',
      })),
    }

    // 检查是否已经注册（防止重复）
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
 * 执行插件代码（包裹在 IIFE 中以确保作用域隔离）
 */
async function executePluginCode(pluginId: string, code: string): Promise<void> {
  // 先清理可能存在的旧插件全局状态
  cleanupPluginGlobals(pluginId)

  // 使用 Function 构造函数执行（比 eval 更安全，但仍有风险）
  // 插件代码应使用 SmartBox.getPluginAPI() 来注册自身
  try {
    const wrappedCode = `
      (function(pluginId) {
        try {
          ${code}
        } catch (err) {
          console.error('[Plugin:' + pluginId + '] Execution error:', err);
        }
      })("${pluginId}");
    `
    // eslint-disable-next-line no-new-func
    const fn = new Function(wrappedCode)
    fn()
  } catch (err: any) {
    throw new Error(`Plugin execution failed: ${err.message}`)
  }
}

/**
 * 清理插件的全局状态
 */
function cleanupPluginGlobals(pluginId: string) {
  // 从 Store 中注销旧实例
  const store = usePluginStore.getState()
  if (store.getPlugin(pluginId)) {
    store.unregisterPlugin(pluginId)
  }
}

/**
 * 卸载插件
 */
export function unloadPlugin(pluginId: string) {
  const store = usePluginStore.getState()
  store.unregisterPlugin(pluginId)
}

/**
 * 加载所有可用插件
 */
export async function loadAllPlugins(): Promise<PluginLoadResult[]> {
  const plugins = await fetchPlugins()
  const results: PluginLoadResult[] = []

  for (const plugin of plugins) {
    const result = await loadPluginScript(plugin)
    results.push(result)
  }

  return results
}
