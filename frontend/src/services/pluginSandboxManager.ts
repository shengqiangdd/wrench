/**
 * pluginSandboxManager.ts
 *
 * 轻量级插件沙箱管理器 — 管理插件的沙箱实例、命令分发和编辑器内容桥接。
 */

import type { PluginSandboxHandle, RegisteredPanel } from '../components/PluginSandbox'

export interface PluginMeta {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  icon?: string
  entry?: string
  commands?: {
    id: string
    name: string
    label?: string
    description?: string
    icon?: string
  }[]
  panels?: {
    id: string
    name: string
    icon?: string
    position: 'header' | 'sidebar' | 'main' | 'statusbar' | 'modal'
  }[]
}

interface SandboxInstance {
  meta: PluginMeta
  handle: PluginSandboxHandle
  registeredAt: number
}

class PluginSandboxManager {
  private instances = new Map<string, SandboxInstance>()

  /** 编辑器内容缓存 — 供插件 getEditorContent 读取 */
  private editorContent: string | null = null
  private editorLanguage: string | null = null

  /** setEditorContent 回调 — 由编辑器组件注册 */
  private editorSetter: ((content: string) => void) | null = null

  /** 命令结果缓存 — pluginId → { content, commandId, timestamp } */
  private lastEditorWrite: Map<string, { content: string; commandId: string; timestamp: number }> =
    new Map()

  /** 用于订阅命令结果变化的回调列表 */
  private resultListeners: Array<() => void> = []

  /** 执行命令时设置的当前 commandId（由 PluginsPage 设置） */
  private currentCommandId: string | null = null

  register(meta: PluginMeta, handle: PluginSandboxHandle) {
    this.instances.set(meta.id, { meta, handle, registeredAt: Date.now() })
  }

  unregister(pluginId: string) {
    const inst = this.instances.get(pluginId)
    if (inst) {
      try {
        inst.handle.destroy()
      } catch {
        /* */
      }
      this.instances.delete(pluginId)
    }
  }

  getHandle(pluginId: string): PluginSandboxHandle | undefined {
    return this.instances.get(pluginId)?.handle
  }

  executeCommand(pluginId: string, commandId: string, args?: unknown[]) {
    const inst = this.instances.get(pluginId)
    if (inst) {
      inst.handle.executeCommand(commandId, args)
    } else {
      console.warn(`[PluginManager] No sandbox for plugin "${pluginId}"`)
    }
  }

  isRegistered(pluginId: string) {
    return this.instances.has(pluginId)
  }

  /** 编辑器内容同步 — CodeMirrorEditor 每次内容变化时调用 */
  syncEditorContent(content: string, language: string | null) {
    this.editorContent = content
    this.editorLanguage = language
    // 同步到所有已注册的沙箱
    for (const inst of this.instances.values()) {
      try {
        inst.handle.updateEditorContent(content, language)
      } catch {
        /* */
      }
    }
  }

  /** 获取当前编辑器内容 — 供插件 getEditorContent 调用 */
  getEditorContent(): string | null {
    return this.editorContent
  }

  /** 获取当前编辑器语言 */
  getEditorLanguage(): string | null {
    return this.editorLanguage
  }

  /** 注册编辑器写入回调 — 编辑器组件调用 */
  registerEditorSetter(setter: (content: string) => void) {
    this.editorSetter = setter
  }

  /** 注销编辑器写入回调 */
  unregisterEditorSetter() {
    this.editorSetter = null
  }

  /** 将插件的 setEditorContent 调用转发到真实编辑器 */
  writeToEditor(content: string, pluginId?: string) {
    this.editorContent = content
    if (this.editorSetter) {
      this.editorSetter(content)
    }
    // 缓存命令结果
    if (pluginId) {
      this.lastEditorWrite.set(pluginId, {
        content,
        commandId: this.currentCommandId || 'unknown',
        timestamp: Date.now(),
      })
      // 通知监听者
      for (const listener of this.resultListeners) {
        try {
          listener()
        } catch {
          /* */
        }
      }
    }
  }

  /** 获取所有已注册的插件面板定义 */
  getAllPanels(): Array<{
    pluginId: string
    panel: { id: string; name: string; icon?: string; position: string }
  }> {
    const panels: Array<{
      pluginId: string
      panel: { id: string; name: string; icon?: string; position: string }
    }> = []
    for (const inst of this.instances.values()) {
      if (inst.meta.panels) {
        for (const panel of inst.meta.panels) {
          panels.push({ pluginId: inst.meta.id, panel })
        }
      }
    }
    return panels
  }

  /** 获取指定插件已注册的面板（含 render 回调） */
  getRegisteredPanels(pluginId: string): Map<string, RegisteredPanel> | undefined {
    const inst = this.instances.get(pluginId)
    if (inst) {
      return inst.handle.getRegisteredPanels()
    }
    return undefined
  }

  /** 打开指定插件的面板（触发 PluginsPage 中的渲染） */
  openPanel(pluginId: string, panelId: string): void {
    const inst = this.instances.get(pluginId)
    if (inst) {
      inst.handle.renderPanelTo(panelId, document.body)
    }
  }

  /** 将指定插件的指定面板渲染到给定容器 */
  renderPanel(pluginId: string, panelId: string, container: HTMLElement): boolean {
    const inst = this.instances.get(pluginId)
    if (!inst) return false
    return inst.handle.renderPanelTo(panelId, container)
  }

  /** 设置当前正在执行的命令 ID（由 PluginsPage 在执行前调用） */
  setCurrentCommandId(commandId: string | null) {
    this.currentCommandId = commandId
  }

  /** 获取指定插件的最后一次命令结果 */
  getLastEditorWrite(
    pluginId: string,
  ): { content: string; commandId: string; timestamp: number } | null {
    return this.lastEditorWrite.get(pluginId) || null
  }

  /** 订阅命令结果变化 */
  onResultChange(listener: () => void): () => void {
    this.resultListeners.push(listener)
    return () => {
      this.resultListeners = this.resultListeners.filter((l) => l !== listener)
    }
  }
}

export const pluginSandboxManager = new PluginSandboxManager()
