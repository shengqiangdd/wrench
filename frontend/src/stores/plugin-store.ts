import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedPlugin, PluginCommand, PluginPanel, PluginManifest } from '../types/plugin'
import { pluginSandboxManager } from '../services/pluginSandboxManager'

/** 命令到插件的反向映射：commandId → pluginId */
const commandToPlugin: Record<string, string> = {}

/**
 * 从已持久化的插件列表重建 commandToPlugin 映射。
 * 页面刷新后 Zustand 从 localStorage 恢复 plugins/commands，
 * 但模块级 commandToPlugin 为空，需要此函数重建映射。
 */
function rebuildCommandMap(plugins: LoadedPlugin[]) {
  for (const p of plugins) {
    if (p.manifest.commands) {
      for (const cmd of p.manifest.commands) {
        commandToPlugin[cmd.id] = p.manifest.id
      }
    }
  }
}

interface PluginState {
  // 已加载插件
  plugins: LoadedPlugin[]
  // 全局注册表
  commands: PluginCommand[]
  panels: PluginPanel[]

  // 插件操作
  registerPlugin: (manifest: PluginManifest, api: LoadedPlugin['api']) => string
  unregisterPlugin: (pluginId: string) => void
  enablePlugin: (pluginId: string) => void
  disablePlugin: (pluginId: string) => void
  getPlugin: (pluginId: string) => LoadedPlugin | undefined

  // 命令操作
  executeCommand: (commandId: string) => void
  getCommands: () => PluginCommand[]
  /** 注册命令到插件映射 */
  mapCommandToPlugin: (commandId: string, pluginId: string) => void

  // 面板操作
  getPanels: () => PluginPanel[]
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      plugins: [],
      commands: [],
      panels: [],

      registerPlugin: (manifest, api) => {
        const plugin: LoadedPlugin = {
          manifest,
          api,
          enabled: true,
        }
        set((s) => {
          // 去重：如果已存在同 ID 插件，先移除旧的
          const existingIdx = s.plugins.findIndex((p) => p.manifest.id === manifest.id)
          const existing = existingIdx >= 0 ? s.plugins[existingIdx] : null
          const existingCmdIds = existing
            ? new Set(existing.manifest.commands?.map((c) => c.id) || [])
            : new Set<string>()
          const existingPanelIds = existing
            ? new Set(existing.manifest.panels?.map((p) => p.id) || [])
            : new Set<string>()

          // 清理旧的命令/面板映射
          for (const cid of existingCmdIds) {
            delete commandToPlugin[cid]
          }

          // 注册新的命令映射
          if (manifest.commands) {
            for (const cmd of manifest.commands) {
              commandToPlugin[cmd.id] = manifest.id
            }
          }

          const plugins = existing
            ? s.plugins.map((p) => (p.manifest.id === manifest.id ? plugin : p))
            : [...s.plugins, plugin]

          const commands = existing
            ? [
                ...s.commands.filter((c) => !existingCmdIds.has(c.id)),
                ...(manifest.commands?.map((c) => ({ ...c })) || []),
              ]
            : [...s.commands, ...(manifest.commands?.map((c) => ({ ...c })) || [])]

          const panels = existing
            ? [
                ...s.panels.filter((p) => !existingPanelIds.has(p.id)),
                ...(manifest.panels?.map((p) => ({ ...p })) || []),
              ]
            : [...s.panels, ...(manifest.panels?.map((p) => ({ ...p })) || [])]

          return { plugins, commands, panels }
        })
        return manifest.id
      },

      unregisterPlugin: (pluginId) =>
        set((s) => {
          const plugin = s.plugins.find((p) => p.manifest.id === pluginId)
          if (!plugin) return s
          const commandIds = new Set(plugin.manifest.commands?.map((c) => c.id) || [])
          const panelIds = new Set(plugin.manifest.panels?.map((p) => p.id) || [])
          // 清理映射
          for (const cid of commandIds) {
            delete commandToPlugin[cid]
          }
          return {
            plugins: s.plugins.filter((p) => p.manifest.id !== pluginId),
            commands: s.commands.filter((c) => !commandIds.has(c.id)),
            panels: s.panels.filter((p) => !panelIds.has(p.id)),
          }
        }),

      enablePlugin: (pluginId) =>
        set((s) => ({
          plugins: s.plugins.map((p) => (p.manifest.id === pluginId ? { ...p, enabled: true } : p)),
        })),

      disablePlugin: (pluginId) =>
        set((s) => ({
          plugins: s.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, enabled: false } : p,
          ),
        })),

      getPlugin: (pluginId) => get().plugins.find((p) => p.manifest.id === pluginId),

      executeCommand: (commandId) => {
        const pluginId = commandToPlugin[commandId]
        if (pluginId) {
          pluginSandboxManager.executeCommand(pluginId, commandId)
        } else {
          console.warn(`[PluginStore] No plugin found for command: ${commandId}`)
        }
      },

      getCommands: () => get().commands,
      getPanels: () => get().panels,

      mapCommandToPlugin: (commandId, pluginId) => {
        commandToPlugin[commandId] = pluginId
      },
    }),
    {
      name: 'wrench-plugins',
      partialize: (state) => ({
        plugins: state.plugins.map((p) => ({
          manifest: p.manifest,
          enabled: p.enabled,
        })),
      }),
      onRehydrateStorage: () => {
        // Zustand persist 完成 rehydration 后，从持久化的 plugins 重建 commandToPlugin
        return (_state, error) => {
          if (!error) {
            const current = usePluginStore.getState()
            rebuildCommandMap(current.plugins)
          }
        }
      },
    },
  ),
)

/** 触发 store 重新从 localStorage 读取 */
export const refreshPluginStore = () => {
  const raw = localStorage.getItem('wrench-plugins')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const state = parsed.state || parsed
    const plugins = state.plugins || usePluginStore.getState().plugins
    usePluginStore.setState({
      plugins,
      commands: state.commands || usePluginStore.getState().commands,
      panels: state.panels || usePluginStore.getState().panels,
    })
    // 重建命令映射
    rebuildCommandMap(plugins)
  } catch {
    /* ignore */
  }
}
