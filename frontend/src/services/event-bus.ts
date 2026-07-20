/**
 * eventBus.ts — 类型安全的全局事件总线
 *
 * 替代散落各处的 CustomEvent + dispatchEvent + addEventListener，
 * 提供编译时类型检查和自动清理能力。
 */

// ── 事件类型映射 ──

export interface WrenchEventMap {
  'wrench-notification': { message: string; type: 'success' | 'error' | 'info' }
  'wrench-panel-opened': { pluginId: string }
  'wrench-open-panel': { pluginId: string; panelId: string; data?: Record<string, unknown> }
  'wrench-config-imported': void
  'wrench:send-to-terminal': { command: string }
  'wrench:send-to-batch': { command: string }
}

export type WrenchEventName = keyof WrenchEventMap

// ── 事件总线实现 ──

type Listener<T> = (payload: T) => void

const listeners = new Map<string, Set<Listener<unknown>>>()

/**
 * 发射事件（类型安全）
 *
 * @example
 * EventBus.emit('wrench-notification', { message: '操作成功', type: 'success' })
 */
export function emit<K extends WrenchEventName>(
  event: K,
  ...args: WrenchEventMap[K] extends void ? [] : [WrenchEventMap[K]]
): void {
  const handlers = listeners.get(event)
  if (!handlers) return
  const payload = args[0] as unknown
  for (const fn of handlers) {
    try {
      fn(payload)
    } catch {
      /* 静默错误，避免一个 listener 崩溃影响其他 */
    }
  }
}

/**
 * 监听事件（类型安全），返回取消监听函数
 *
 * @example
 * const unsub = EventBus.on('wrench-notification', ({ message }) => {
 *   console.log(message)
 * })
 * // later: unsub()
 */
export function on<K extends WrenchEventName>(
  event: K,
  listener: Listener<WrenchEventMap[K]>,
): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set())
  }
  const handlers = listeners.get(event)!
  handlers.add(listener as Listener<unknown>)

  return () => {
    handlers.delete(listener as Listener<unknown>)
    if (handlers.size === 0) listeners.delete(event)
  }
}

/**
 * 监听事件，自动绑定到 React useEffect 的清理函数
 *
 * @example
 * useEffect(() => {
 *   return onMount('wrench-notification', handler)
 * }, [])
 */
export function onMount<K extends WrenchEventName>(
  event: K,
  listener: Listener<WrenchEventMap[K]>,
): () => void {
  return on(event, listener)
}

// ── 便捷函数 ──

/** 发送全局 Toast 通知 */
export function notify(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  emit('wrench-notification', { message, type })
}
