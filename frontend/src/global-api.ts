/**
 * SmartBox 全局 API
 *
 * 暴露在 window.SmartBox 上，供插件 plugin.js 调用。
 * 为插件提供注册命令、面板、访问编辑器内容、显示通知等能力。
 */

import { usePluginStore } from './stores/plugin-store'
import { useFileStore } from './stores/file-store'
import type { PluginCommand, PluginPanel } from './types/plugin'

interface PluginAPIReturn {
  registerCommand: (command: PluginCommand, handler: (...args: unknown[]) => void) => void
  registerPanel: (panel: PluginPanel, component: React.ComponentType) => void
  getEditorContent: () => string | null
  setEditorContent: (content: string) => void
  getCurrentFileLanguage: () => string | null
  showNotification: (message: string, type: 'info' | 'success' | 'error') => void
}

/** 存储插件命令处理函数 */
const commandHandlers = new Map<string, (...args: unknown[]) => void>()

/** 存储插件面板组件 */
const panelComponents = new Map<string, React.ComponentType>()

/** 获取插件 API 实例 */
function getPluginAPI(): PluginAPIReturn {
  return {
    registerCommand: (command: PluginCommand, handler: (...args: unknown[]) => void) => {
      commandHandlers.set(command.id, handler)
      const store = usePluginStore.getState()
      store.registerPlugin(
        {
          id: '__plugin__' + command.id,
          name: command.id,
          version: '1.0.0',
          description: '',
          author: '',
          entry: '',
          commands: [command],
        },
        {} as any,
      )
    },

    registerPanel: (_panel: PluginPanel, _component: React.ComponentType) => {
      panelComponents.set(_panel.id, _component)
    },

    getEditorContent: () => {
      const state = useFileStore.getState()
      const activeTab = state.openTabs.find((t) => t.id === state.activeTabId)
      return activeTab?.content ?? null
    },

    setEditorContent: (content: string) => {
      const state = useFileStore.getState()
      if (state.activeTabId) {
        state.updateFileContent(state.activeTabId, content)
      }
    },

    getCurrentFileLanguage: () => {
      const state = useFileStore.getState()
      const activeTab = state.openTabs.find((t) => t.id === state.activeTabId)
      return activeTab?.language ?? null
    },

    showNotification: (message: string, type: 'info' | 'success' | 'error') => {
      // 使用自定义事件触发通知
      window.dispatchEvent(
        new CustomEvent('smartbox-notification', {
          detail: { message, type },
        }),
      )
    },
  }
}

/**
 * 执行已注册的插件命令
 */
export function executePluginCommand(commandId: string): boolean {
  const handler = commandHandlers.get(commandId)
  if (handler) {
    handler()
    return true
  }
  return false
}

/**
 * 获取已注册的插件面板组件
 */
export function getPluginPanelComponent(panelId: string): React.ComponentType | undefined {
  return panelComponents.get(panelId)
}

/**
 * 初始化全局 SmartBox API
 */
export function initGlobalAPI() {
  if (typeof window !== 'undefined') {
    ;(window as any).SmartBox = {
      getPluginAPI,
      getCommandHandlers: () => commandHandlers,
      getPanelComponents: () => panelComponents,
    }
  }
}
