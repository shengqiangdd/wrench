/**
 * PluginSandbox.tsx
 *
 * 插件沙箱容器 — 直接在主线程执行插件代码，通过受限 API 对象隔离。
 * 支持两种插件 API 风格：
 * 1. Wrench API — 旧插件通过 `Wrench.getPluginAPI()` 获取 API
 * 2. wrench API — 新插件通过 `wrench.panels.register()` / `wrench.commands.register()`
 *
 * 关键设计变更（v2）：
 * - 每个沙箱使用独立的 wrench 全局对象（通过命名空间），避免插件间覆盖
 * - 沙箱创建后持久存活，直到显式 destroy()
 * - onReady 通过 useRef 捕获避免 effect 循环
 */

import { useEffect, useRef, useCallback } from 'react'
import type { PluginManifest } from '../types/plugin'
import { pluginSandboxManager } from '../services/pluginSandboxManager'
import { notify, emit } from '../services/event-bus'

export interface PluginSandboxHandle {
  executeCommand: (commandId: string, args?: unknown[]) => void
  updateEditorContent: (content: string | null, language: string | null) => void
  /** 获取已注册的面板信息（id, title, icon, render callback） */
  getRegisteredPanels: () => Map<string, RegisteredPanel>
  /** 将指定面板渲染到目标容器，返回是否成功 */
  renderPanelTo: (panelId: string, container: HTMLElement) => boolean
  destroy: () => void
}

export interface RegisteredPanel {
  id: string
  title: string
  icon?: string
  render: (container: HTMLElement) => void
}

interface PluginSandboxProps {
  manifest: PluginManifest
  pluginCode: string
  onReady?: (handle: PluginSandboxHandle) => void
  onError?: (error: string) => void
}

/** 创建统一的 notify 函数（使用类型安全事件总线） */
function pluginNotify(message: string, type?: string) {
  notify(String(message), (type as 'success' | 'error' | 'info') || 'info')
}

/** 创建插件 localStorage 包装 */
function createStorage(pluginId: string) {
  const PREFIX = `wrench_plugin_${pluginId}_`
  return {
    get: (key: string) => {
      try {
        return localStorage.getItem(PREFIX + key)
      } catch {
        return null
      }
    },
    set: (key: string, value: string) => {
      try {
        localStorage.setItem(PREFIX + key, value)
      } catch {
        /* */
      }
    },
    remove: (key: string) => {
      try {
        localStorage.removeItem(PREFIX + key)
      } catch {
        /* */
      }
    },
    clear: () => {
      try {
        const keys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (k?.startsWith(PREFIX)) keys.push(k)
        }
        keys.forEach((k) => localStorage.removeItem(k))
      } catch {
        /* */
      }
    },
  }
}

export default function PluginSandbox({
  manifest,
  pluginCode,
  onReady,
  onError,
}: PluginSandboxProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<PluginSandboxHandle | null>(null)
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  const initializedRef = useRef(false)

  useEffect(() => {
    onReadyRef.current = onReady
    onErrorRef.current = onError
  })

  const initSandbox = useCallback(() => {
    const container = containerRef.current
    if (!container || !pluginCode || initializedRef.current) return

    // 清理旧内容
    container.innerHTML = ''

    const commandHandlers: Record<string, (args: unknown[]) => void> = {}
    const registeredPanels = new Map<string, RegisteredPanel>()

    // 创建插件根元素
    const rootEl = document.createElement('div')
    rootEl.id = `plugin-root-${manifest.id}`
    rootEl.className = 'plugin-root'
    rootEl.style.cssText = 'width:100%;height:100%;overflow:auto;padding:8px;'
    container.appendChild(rootEl)

    // 构建 Wrench/SmartBox API（旧式 API）
    const pluginAPI = {
      registerCommand: (
        idOrDef: string | { id: string; label?: string; description?: string },
        secondArg?: unknown,
      ) => {
        let id: string
        let handler: (args: unknown[]) => void
        if (typeof idOrDef === 'string') {
          id = idOrDef
          const def = secondArg as Record<string, unknown> | undefined
          handler = (def?.execute as (args: unknown[]) => void) || (() => {})
        } else {
          id = idOrDef.id
          handler = (secondArg as (args: unknown[]) => void) || (() => {})
        }
        commandHandlers[id] = handler
      },
      getEditorContent: () => pluginSandboxManager.getEditorContent(),
      setEditorContent: (content: string) =>
        pluginSandboxManager.writeToEditor(content, manifest.id),
      getCurrentFileLanguage: () => pluginSandboxManager.getEditorLanguage(),
      showNotification: pluginNotify,
      storage: createStorage(manifest.id),
      getRootElement: () => rootEl,
      getPluginId: () => manifest.id,
      getPluginInfo: () => Object.freeze({ ...manifest }),
      openPanel: (panelId: string, data?: Record<string, unknown>) => {
        emit('wrench-open-panel', { pluginId: manifest.id, panelId, data })
        emit('wrench-panel-opened', { pluginId: manifest.id })
      },
    }

    // 构建 wrench API（新插件期望的全局对象）
    // 每个插件使用独立的 wrench 对象实例，不共享全局
    const wrenchCommands = new Map<
      string,
      { id: string; label: string; handler: (...args: unknown[]) => void }
    >()
    const wrenchPanels = new Map<
      string,
      { id: string; title: string; icon?: string; render: (container: HTMLElement) => void }
    >()

    const wrenchObj = {
      commands: {
        register: (id: string, label: string, handler: (...args: unknown[]) => void) => {
          wrenchCommands.set(id, { id, label, handler })
          // 同步到 commandHandlers 以便通过 executeCommand 触发
          commandHandlers[id] = handler as (args: unknown[]) => void
        },
        unregister: (id: string) => {
          wrenchCommands.delete(id)
          delete commandHandlers[id]
        },
        list: () => Array.from(wrenchCommands.values()),
      },
      panels: {
        register: (
          id: string,
          config: { title: string; icon?: string; render: (container: HTMLElement) => void },
        ) => {
          wrenchPanels.set(id, {
            id,
            title: config.title,
            icon: config.icon,
            render: config.render,
          })
          registeredPanels.set(id, {
            id,
            title: config.title,
            icon: config.icon,
            render: config.render,
          })
        },
        unregister: (id: string) => {
          wrenchPanels.delete(id)
          registeredPanels.delete(id)
        },
        list: () => Array.from(wrenchPanels.values()),
      },
      // 常用工具方法
      showNotification: pluginNotify,
      getEditorContent: () => pluginSandboxManager.getEditorContent(),
      setEditorContent: (content: string) =>
        pluginSandboxManager.writeToEditor(content, manifest.id),
      storage: createStorage(manifest.id),
    }

    // 暴露全局 — 使用插件 ID 命名空间避免多插件互相覆盖
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const ns = `__wrench_${manifest.id}_`
    const Wrench = { getPluginAPI: () => pluginAPI }
    w[ns + 'Wrench'] = Wrench
    w[ns + 'SmartBox'] = Wrench
    w[ns + 'wrench'] = wrenchObj
    // 向后兼容：同时设置无命名空间版本（最后一个插件的值会覆盖）
    w.Wrench = Wrench
    w.SmartBox = Wrench
    w.wrench = wrenchObj

    // 暴露插件命名空间的 camelCase/PascalCase 变量（用于 init() 查找）
    const segments = manifest.id.split('-')
    const camelId = segments
      .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
      .join('')
    const pascalId = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('')
    // 仅设置命名空间版本，不污染全局
    w[ns + camelId] = pluginAPI
    w[ns + pascalId] = pluginAPI

    // 执行插件代码 — 拦截 [插件] 前缀的 console.log 避免刷屏
    const _origLog = console.log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.log = (...args: any[]) => {
      const first = String(args[0] || '')
      if (first.startsWith('[插件]')) return
      _origLog.apply(console, args)
    }
    try {
      const fn = new Function('Wrench', 'SmartBox', 'wrench', 'pluginAPI', 'rootEl', pluginCode)
      fn(Wrench, Wrench, wrenchObj, pluginAPI, rootEl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[PluginSandbox] ${manifest.name} error:`, msg)
      onErrorRef.current?.(msg)
      // 恢复 console.log
      console.log = _origLog
      return
    } finally {
      console.log = _origLog
    }

    // 查找插件导出的全局对象并调用 init()
    // 优先查找命名空间版本，再回退到全局版本（向后兼容）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w2 = window as any
    const candidates = [
      w2[ns + pascalId],
      w2[ns + camelId],
      w2[pascalId],
      w2[camelId],
      w2[manifest.id],
      w2[manifest.id.replace(/-/g, '_')],
    ]
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && typeof candidate.init === 'function') {
        try {
          candidate.init()
        } catch (err) {
          console.warn(`[PluginSandbox] ${manifest.name}.init() failed:`, err)
        }
        break
      }
    }

    // 构建 handle
    const handle: PluginSandboxHandle = {
      executeCommand: (commandId, args) => {
        // 先从 commandHandlers（Wrench API 注册的）查找
        const handler = commandHandlers[commandId]
        if (handler) {
          try {
            handler(args || [])
          } catch (err) {
            console.error(`[PluginSandbox] Command ${commandId} error:`, err)
          }
          return
        }
        // 再从 wrenchCommands 查找
        const cmd = wrenchCommands.get(commandId)
        if (cmd) {
          try {
            cmd.handler(...(args || []))
          } catch (err) {
            console.error(`[PluginSandbox] Command ${commandId} error:`, err)
          }
        }
      },
      updateEditorContent: () => {},
      getRegisteredPanels: () => registeredPanels,
      renderPanelTo: (panelId: string, container: HTMLElement) => {
        const panel = registeredPanels.get(panelId)
        if (!panel) return false
        // Clear container
        container.innerHTML = ''
        container.style.cssText = 'width:100%;height:100%;overflow:auto;'
        // Inject shared plugin panel CSS if not already present
        if (!container.querySelector('style[data-wp-theme]')) {
          const styleEl = document.createElement('style')
          styleEl.setAttribute('data-wp-theme', 'plugin-panel')
          // Use the same CSS variables from the host app for consistency
          styleEl.textContent = `
            :host, .wp-host {
              --wp-bg: var(--bg-surface, #020617);
              --wp-bg-elevated: var(--bg-elevated, #0f172a);
              --wp-bg-card: var(--bg-card, #1e293b);
              --wp-bg-hover: var(--bg-hover, #334155);
              --wp-text: var(--text-primary, #f1f5f9);
              --wp-text-secondary: var(--text-secondary, #cbd5e1);
              --wp-text-muted: var(--text-muted, #94a3b8);
              --wp-text-dim: var(--text-dim, #64748b);
              --wp-border: var(--border-color, rgba(51,65,85,0.5));
              --wp-accent: #0ea5e9;
            }
          `
          container.appendChild(styleEl)
        }
        try {
          panel.render(container)
          return true
        } catch (err) {
          console.error(`[PluginSandbox] Panel ${panelId} render error:`, err)
          container.innerHTML = `<div style="padding:20px;color:#f44;">面板渲染失败: ${err instanceof Error ? err.message : String(err)}</div>`
          return false
        }
      },
      destroy: () => {
        initializedRef.current = false
        // 清理命名空间变量（只清理自己的，不破坏其他插件的）
        delete w2[ns + 'Wrench']
        delete w2[ns + 'SmartBox']
        delete w2[ns + 'wrench']
        delete w2[ns + camelId]
        delete w2[ns + pascalId]
        // 注意：不清理全局版本（w.Wrench, w.SmartBox, w.wrench）
        // 因为它们可能是其他插件设置的。只在没有其他插件注册时才清理。
        // 但为了简单起见，这里保留全局版本（最后一个插件的值）。
        try {
          container.removeChild(rootEl)
        } catch {
          /* */
        }
      },
    }
    handleRef.current = handle
    initializedRef.current = true

    // 通知 ready
    onReadyRef.current?.(handle)
  }, [manifest, pluginCode])

  useEffect(() => {
    initSandbox()
    return () => {
      handleRef.current?.destroy()
      handleRef.current = null
      initializedRef.current = false
    }
  }, [initSandbox])

  return <div ref={containerRef} style={{ width: '100%', height: '100%', overflow: 'auto' }} />
}
