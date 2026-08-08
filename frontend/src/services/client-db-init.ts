/**
 * client-db-init.ts — 客户端数据库初始化和 Store 适配
 *
 * 在应用启动时异步初始化 SQLite 数据库，
 * 并提供 React 可用的加载状态。
 */

import { useEffect, useState } from 'react'
import {
  initClientDb,
  cleanupOldLocalStorage,
  type VaultEntry,
  type ConnectionRow,
  type AlertRuleRow,
  type AlertEventRow,
  type NotificationChannelRow,
} from './client-db'

// ─── 加载状态 ───

let _ready = false
const _listeners = new Set<() => void>()

function notifyReady() {
  _ready = true
  for (const fn of _listeners) fn()
}

/** 客户端数据库是否就绪 */
export function isClientDbReady(): boolean {
  return _ready
}

/** React hook：等待客户端数据库就绪 */
export function useClientDbReady(): boolean {
  const [ready, setReady] = useState(_ready)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (_ready) {
      setReady(true)
      return
    }
    const listener = () => setReady(true)
    _listeners.add(listener)
    // 确保初始化已启动
    initClientDb().then(() => notifyReady())
    return () => {
      _listeners.delete(listener)
    }
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  return ready
}

// ─── 启动初始化 ───

let _initStarted = false

/**
 * 在应用启动时调用（通常在 App.tsx 或 main.tsx）。
 * 幂等：多次调用不会重复初始化。
 */
export async function ensureClientDbInit(): Promise<void> {
  if (_initStarted) return
  _initStarted = true
  try {
    await initClientDb()
    cleanupOldLocalStorage()
    notifyReady()
  } catch (e) {
    console.error('[ClientDB] Init failed:', e)
  }
}

// ─── 重新导出数据库操作（带就绪检查） ───

export type { VaultEntry, ConnectionRow, AlertRuleRow, AlertEventRow, NotificationChannelRow }

export {
  vaultList,
  vaultGet,
  vaultUpsert,
  vaultDelete,
  connectionsList,
  connectionsUpsert,
  connectionsDelete,
  alertRulesList,
  alertRulesUpsert,
  alertRulesDelete,
  alertRulesClear,
  alertHistoryList,
  alertHistoryInsert,
  alertHistoryClear,
  notificationChannelsList,
  notificationChannelsUpsert,
  notificationChannelsDelete,
  exportDbJson,
  importDbJson,
} from './client-db'
