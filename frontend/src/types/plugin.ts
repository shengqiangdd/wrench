export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  entry: string
  commands?: PluginCommand[]
  panels?: PluginPanel[]
  permissions?: string[]
  settings?: PluginSetting[]
}

export interface PluginCommand {
  id: string
  name: string
  label?: string
  description?: string
  shortcut?: string
  icon?: string
  keywords?: string[]
}

export interface PluginPanel {
  id: string
  name: string
  icon?: string
  position: 'sidebar' | 'main' | 'modal'
}

export interface PluginSetting {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  defaultValue?: string | number | boolean
  options?: { label: string; value: string }[]
}

export interface PluginAPI {
  registerCommand: (command: PluginCommand, handler: (...args: unknown[]) => void) => void
  registerPanel: (panel: PluginPanel, component: React.ComponentType) => void
  getFileContent: () => string | null
  setFileContent: (content: string) => void
  getCurrentFileLanguage: () => string | null
  showNotification: (message: string, type: 'info' | 'success' | 'error') => void
}

export interface LoadedPlugin {
  manifest: PluginManifest
  api: PluginAPI
  enabled: boolean
}
