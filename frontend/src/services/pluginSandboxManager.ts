/**
 * pluginSandboxManager.ts
 *
 * 沙箱实例管理器。管理多个 iframe 沙箱的生命周期，
 * 为 PluginsPage 提供统一的沙箱操作接口。
 *
 * 职责：
 * - 沙箱创建/销毁/重新加载
 * - 插件命令执行（通过 postMessage 转发到对应沙箱）
 * - 编辑器内容同步
 * - 面板渲染管理
 */

import type { PluginManifest } from '../types/plugin'
import type { PluginSandboxHandle } from '../components/PluginSandbox'

export interface SandboxInstance {
  id: string
  manifest: PluginManifest
  handle: PluginSandboxHandle
  createdAt: number
  commands: Array<{ id: string; label?: string; description?: string }>
  panels: Array<{ id: string; name?: string }>
}

type SandboxListener = {
  onCommandRegistered?: (
    pluginId: string,
    command: { id: string; label?: string; description?: string },
  ) => void
  onPanelRegistered?: (pluginId: string, panel: { id: string; name?: string }) => void
  onNotification?: (pluginId: string, message: string, type: 'info' | 'success' | 'error') => void
  onError?: (pluginId: string, error: string) => void
}

class PluginSandboxManager {
  private sandboxes = new Map<string, SandboxInstance>()
  private listeners = new Map<string, SandboxListener>()

  /**
   * 注册沙箱实例
   */
  register(id: string, manifest: PluginManifest, handle: PluginSandboxHandle): SandboxInstance {
    const instance: SandboxInstance = {
      id,
      manifest,
      handle,
      createdAt: Date.now(),
      commands: [],
      panels: [],
    }
    this.sandboxes.set(id, instance)
    return instance
  }

  /**
   * 注销沙箱实例
   */
  unregister(id: string): void {
    const instance = this.sandboxes.get(id)
    if (instance) {
      instance.handle.destroy()
      this.sandboxes.delete(id)
    }
    this.listeners.delete(id)
  }

  /**
   * 获取沙箱实例
   */
  get(id: string): SandboxInstance | undefined {
    return this.sandboxes.get(id)
  }

  /**
   * 获取所有沙箱实例
   */
  getAll(): SandboxInstance[] {
    return Array.from(this.sandboxes.values())
  }

  /**
   * 获取插件命令列表
   */
  getPluginCommands(pluginId: string): Array<{ id: string; label?: string; description?: string }> {
    const instance = this.sandboxes.get(pluginId)
    return instance?.commands || []
  }

  /**
   * 获取所有已注册的命令
   */
  getAllCommands(): Array<{ id: string; label?: string; description?: string; pluginId: string }> {
    const all: Array<{ id: string; label?: string; description?: string; pluginId: string }> = []
    for (const [pluginId, instance] of this.sandboxes) {
      for (const cmd of instance.commands) {
        all.push({ ...cmd, pluginId })
      }
    }
    return all
  }

  /**
   * 添加命令到沙箱记录
   */
  addCommand(
    pluginId: string,
    command: { id: string; label?: string; description?: string },
  ): void {
    const instance = this.sandboxes.get(pluginId)
    if (instance) {
      if (!instance.commands.some((c) => c.id === command.id)) {
        instance.commands.push(command)
      }
    }
  }

  /**
   * 添加面板到沙箱记录
   */
  addPanel(pluginId: string, panel: { id: string; name?: string }): void {
    const instance = this.sandboxes.get(pluginId)
    if (instance) {
      if (!instance.panels.some((p) => p.id === panel.id)) {
        instance.panels.push(panel)
      }
    }
  }

  /**
   * 执行插件命令
   */
  executeCommand(pluginId: string, commandId: string, args?: unknown[]): boolean {
    const instance = this.sandboxes.get(pluginId)
    if (instance) {
      instance.handle.executeCommand(commandId, args)
      return true
    }
    return false
  }

  /**
   * 同步编辑器内容到所有（或指定）沙箱
   */
  syncEditorContent(content: string | null, language: string | null, pluginId?: string): void {
    if (pluginId) {
      const instance = this.sandboxes.get(pluginId)
      instance?.handle.updateEditorContent(content, language)
    } else {
      for (const instance of this.sandboxes.values()) {
        instance.handle.updateEditorContent(content, language)
      }
    }
  }

  /**
   * 销毁所有沙箱
   */
  destroyAll(): void {
    for (const [id, instance] of this.sandboxes) {
      instance.handle.destroy()
    }
    this.sandboxes.clear()
    this.listeners.clear()
  }

  /**
   * 获取沙箱数量
   */
  get size(): number {
    return this.sandboxes.size
  }
}

// 全局单例
export const pluginSandboxManager = new PluginSandboxManager()
export default pluginSandboxManager
