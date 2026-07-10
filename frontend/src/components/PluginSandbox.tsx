/**
 * PluginSandbox.tsx
 *
 * 插件沙箱容器 — 直接在主线程执行插件代码，通过受限 API 对象隔离。
 * 使用 useRef 保持回调稳定，避免 useEffect 频繁重建。
 */

import { useEffect, useRef, useCallback } from 'react'
import type { PluginManifest } from '../types/plugin'

export interface PluginSandboxHandle {
  executeCommand: (commandId: string, args?: unknown[]) => void
  updateEditorContent: (content: string | null, language: string | null) => void
  destroy: () => void
}

interface PluginSandboxProps {
  manifest: PluginManifest
  pluginCode: string
  onReady?: (handle: PluginSandboxHandle) => void
  onError?: (error: string) => void
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

    // 创建插件根元素
    const rootEl = document.createElement('div')
    rootEl.id = 'plugin-root'
    rootEl.className = 'plugin-root'
    rootEl.style.cssText = 'width:100%;height:100%;overflow:auto;padding:8px;'
    container.appendChild(rootEl)

    // 构建受限 API
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
      getEditorContent: () => null,
      setEditorContent: () => {},
      getCurrentFileLanguage: () => null,
      showNotification: (message: string, type?: string) => {
        window.dispatchEvent(
          new CustomEvent('wrench-notification', {
            detail: { message: String(message), type: type || 'info', duration: 4000 },
          }),
        )
      },
      storage: (() => {
        const PREFIX = `wrench_plugin_${manifest.id}_`
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
      })(),
      getRootElement: () => rootEl,
      getPluginId: () => manifest.id,
      getPluginInfo: () => Object.freeze({ ...manifest }),
    }

    // 暴露到全局
    const Wrench = { getPluginAPI: () => pluginAPI }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.Wrench = Wrench
    w.SmartBox = Wrench

    // 执行插件代码
    try {
      const fn = new Function('Wrench', 'SmartBox', 'pluginAPI', 'rootEl', pluginCode)
      fn(Wrench, Wrench, pluginAPI, rootEl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[PluginSandbox] ${manifest.name} error:`, msg)
      onErrorRef.current?.(msg)
      return
    }

    // 构建 handle
    const handle: PluginSandboxHandle = {
      executeCommand: (commandId, args) => {
        const handler = commandHandlers[commandId]
        if (handler) {
          try {
            handler(args || [])
          } catch (err) {
            console.error(`[PluginSandbox] Command ${commandId} error:`, err)
          }
        }
      },
      updateEditorContent: () => {},
      destroy: () => {
        initializedRef.current = false
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
