import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LoadedPlugin, PluginCommand, PluginPanel, PluginManifest } from '../types/plugin'

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
        set((s) => ({
          plugins: [...s.plugins, plugin],
          commands: [
            ...s.commands,
            ...(manifest.commands?.map((c) => ({ ...c })) || []),
          ],
          panels: [
            ...s.panels,
            ...(manifest.panels?.map((p) => ({ ...p })) || []),
          ],
        }))
        return manifest.id
      },

      unregisterPlugin: (pluginId) =>
        set((s) => {
          const plugin = s.plugins.find((p) => p.manifest.id === pluginId)
          if (!plugin) return s
          const commandIds = new Set(plugin.manifest.commands?.map((c) => c.id) || [])
          const panelIds = new Set(plugin.manifest.panels?.map((p) => p.id) || [])
          return {
            plugins: s.plugins.filter((p) => p.manifest.id !== pluginId),
            commands: s.commands.filter((c) => !commandIds.has(c.id)),
            panels: s.panels.filter((p) => !panelIds.has(p.id)),
          }
        }),

      enablePlugin: (pluginId) =>
        set((s) => ({
          plugins: s.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, enabled: true } : p,
          ),
        })),

      disablePlugin: (pluginId) =>
        set((s) => ({
          plugins: s.plugins.map((p) =>
            p.manifest.id === pluginId ? { ...p, enabled: false } : p,
          ),
        })),

      getPlugin: (pluginId) => get().plugins.find((p) => p.manifest.id === pluginId),

      executeCommand: (_commandId) => {
        // 实际执行由插件系统在 load 时绑定 handler
        console.log('Execute command:', _commandId)
      },

      getCommands: () => get().commands,
      getPanels: () => get().panels,
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
