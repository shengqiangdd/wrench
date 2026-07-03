import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedPlugin, PluginCommand, PluginPanel, PluginManifest } from '../types/plugin'
import { pluginSandboxManager } from '../services/pluginSandboxManager'

/** 命令到插件的反向映射：commandId → pluginId */
const commandToPlugin: Record<string, string> = {}

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
          // 注册命令到插件映射
          if (manifest.commands) {
            for (const cmd of manifest.commands) {
              commandToPlugin[cmd.id] = manifest.id
            }
          }
          return {
            plugins: [...s.plugins, plugin],
            commands: [...s.commands, ...(manifest.commands?.map((c) => ({ ...c })) || [])],
            panels: [...s.panels, ...(manifest.panels?.map((p) => ({ ...p })) || [])],
          }
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
      name: 'smartbox-plugins',
      partialize: (state) => ({
        plugins: state.plugins.map((p) => ({
          manifest: p.manifest,
          enabled: p.enabled,
        })),
      }),
    },
  ),
)

/** 触发 store 重新从 localStorage 读取 */
export const refreshPluginStore = () => {
  const raw = localStorage.getItem('smartbox-plugins')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const state = parsed.state || parsed
    usePluginStore.setState({
      plugins: state.plugins || usePluginStore.getState().plugins,
      commands: state.commands || usePluginStore.getState().commands,
      panels: state.panels || usePluginStore.getState().panels,
    })
  } catch {
    /* ignore */
  }
}
