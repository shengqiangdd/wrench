/**
 * Wrench IndexedDB 通用数据库层
 *
 * 基于 idb 封装，提供类型安全的 CRUD 操作。
 * 数据库版本管理 + 自动迁移。
 */

import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'wrench'
const DB_VERSION = 1

export type StoreName = 'connections' | 'plugin_data' | 'settings' | 'ai_sessions'

interface StoreSchema {
  connections: {
    key: string
    value: {
      id: string
      name: string
      host: string
      port: number
      username: string
      authType: 'password' | 'key'
      password?: string
      privateKey?: string
      group?: string
      createdAt: number
    }
  }
  plugin_data: {
    key: string
    value: {
      pluginId: string
      key: string
      value: unknown
      updatedAt: number
    }
    indexes: { 'by-plugin': string }
  }
  settings: {
    key: string
    value: {
      key: string
      value: unknown
      updatedAt: number
    }
  }
  ai_sessions: {
    key: string
    value: {
      id: string
      title: string
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      createdAt: number
      updatedAt: number
    }
  }
}

type Db = IDBPDatabase<StoreSchema>

let _db: Db | null = null

async function getDb(): Promise<Db> {
  if (_db) return _db

  _db = await openDB<StoreSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion) {
      // 连接配置表
      if (!db.objectStoreNames.contains('connections')) {
        db.createObjectStore('connections', { keyPath: 'id' })
      }

      // 插件数据表
      if (!db.objectStoreNames.contains('plugin_data')) {
        const store = db.createObjectStore('plugin_data', {
          keyPath: ['pluginId', 'key'],
        })
        store.createIndex('by-plugin', 'pluginId')
      }

      // 设置表
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' })
      }

      // AI 对话历史表
      if (!db.objectStoreNames.contains('ai_sessions')) {
        db.createObjectStore('ai_sessions', { keyPath: 'id' })
      }
    },
  })

  return _db
}

// ─── 通用 CRUD ───

export async function getAll<T extends StoreName>(
  store: T,
): Promise<Array<StoreSchema[T]['value']>> {
  const db = await getDb()
  return db.getAll(store as string)
}

export async function get<T extends StoreName>(
  store: T,
  key: StoreSchema[T]['key'],
): Promise<StoreSchema[T]['value'] | undefined> {
  const db = await getDb()
  return db.get(store as string, key)
}

export async function put<T extends StoreName>(
  store: T,
  value: StoreSchema[T]['value'],
): Promise<void> {
  const db = await getDb()
  await db.put(store as string, value)
}

export async function del<T extends StoreName>(
  store: T,
  key: StoreSchema[T]['key'],
): Promise<void> {
  const db = await getDb()
  await db.delete(store as string, key)
}

export async function clear(store: string): Promise<void> {
  const db = await getDb()
  await db.clear(store)
}

// ─── 索引查询 ───

export async function getByIndex<T extends StoreName>(
  store: T,
  indexName: string,
  value: string,
): Promise<Array<StoreSchema[T]['value']>> {
  const db = await getDb()
  return db.getAllFromIndex(store as string, indexName, value)
}

// ─── 批量操作 ───

export async function putMany<T extends StoreName>(
  store: T,
  values: Array<StoreSchema[T]['value']>,
): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(store as string, 'readwrite')
  await Promise.all(values.map((v) => tx.store.put(v)))
  await tx.done
}

// ─── 设置快捷操作 ───

export async function getSetting(key: string): Promise<unknown> {
  const db = await getDb()
  const record = await db.get('settings', key)
  return record?.value
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put('settings', { key, value, updatedAt: Date.now() })
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDb()
  await db.delete('settings', key)
}

// ─── 连接配置快捷操作 ───

export async function saveConnection(conn: StoreSchema['connections']['value']): Promise<void> {
  return put('connections', conn)
}

export async function listConnections(): Promise<Array<StoreSchema['connections']['value']>> {
  return getAll('connections')
}

export async function deleteConnection(id: string): Promise<void> {
  return del('connections', id)
}

// ─── 数据库信息 ───

export async function getDbInfo(): Promise<{
  version: number
  stores: string[]
  counts: Record<string, number>
}> {
  const db = await getDb()
  const stores = Array.from(db.objectStoreNames)
  const counts: Record<string, number> = {}

  for (const store of stores) {
    counts[store] = await db.count(store)
  }

  return { version: DB_VERSION, stores, counts }
}

// 默认导出
export default {
  getAll,
  get,
  put,
  del,
  clear,
  getByIndex,
  putMany,
  getSetting,
  setSetting,
  deleteSetting,
  saveConnection,
  listConnections,
  deleteConnection,
  getDbInfo,
}
