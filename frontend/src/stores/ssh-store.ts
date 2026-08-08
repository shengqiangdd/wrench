/**
 * ssh-store.ts — Zustand store for SSH connections and sessions.
 *
 * Connections are persisted in client-side SQLite (via sql.js),
 * each browser/user has their own isolated database.
 * No server-side storage for connection configs.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { decryptSshConnection } from '../services/secure-store'
import {
  connectionsList,
  connectionsUpsert,
  connectionsDelete,
  isDbReady,
} from '../services/client-db'
import type { SshConnection, SshSession, SftpEntry } from '../types/ssh'

/** Convert SQLite ConnectionRow to local SshConnection */
function rowToLocal(row: {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: string
  config: string
  sort_order: number
  created_at: string
  updated_at: string
}): SshConnection {
  let parsedConfig: Record<string, unknown> = {}
  try {
    parsedConfig = JSON.parse(row.config)
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type as 'password' | 'key',
    password: (parsedConfig.password as string) || undefined,
    privateKey: (parsedConfig.private_key as string) || undefined,
    sudoPassword: (parsedConfig.sudo_password as string) || undefined,
    group: (parsedConfig.group as string) || undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  }
}

/** Convert local SshConnection to SQLite row */
function localToRow(conn: SshConnection) {
  const config: Record<string, unknown> = {}
  if (conn.password) config.password = conn.password
  if (conn.privateKey) config.private_key = conn.privateKey
  if (conn.sudoPassword) config.sudo_password = conn.sudoPassword
  if (conn.group) config.group = conn.group

  const now = new Date().toISOString()
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    auth_type: conn.authType,
    config: JSON.stringify(config),
    sort_order: 0,
    created_at: conn.createdAt ? new Date(conn.createdAt).toISOString() : now,
    updated_at: now,
  }
}

interface SshState {
  // 连接配置
  connections: SshConnection[]
  connectionMap: Map<string, SshConnection>  // 新增：O(1) 查找索引
  selectedConnectionId: string | null

  // 活跃会话
  sessions: SshSession[]

  // 当前 SFTP 目录
  currentSftpPath: string
  currentSftpEntries: SftpEntry[]

  // 客户端数据库状态
  dbLoaded: boolean

  // 连接配置操作
  addConnection: (conn: SshConnection) => void
  updateConnection: (id: string, data: Partial<SshConnection>) => void
  deleteConnection: (id: string) => void
  selectConnection: (id: string | null) => void

  // 数据库操作
  loadFromDb: () => void

  // 会话操作
  addSession: (session: SshSession) => void
  updateSession: (id: string, data: Partial<SshSession>) => void
  removeSession: (id: string) => void

  // SFTP 操作
  setCurrentSftpPath: (path: string) => void
  setCurrentSftpEntries: (entries: SftpEntry[]) => void

  // 新增方法
  getConnectionById: (id: string) => SshConnection | undefined
}

export const useSshStore = create<SshState>()(
  persist(
    (set, _get) => ({
      connections: [],
      connectionMap: new Map(),
      selectedConnectionId: null,
      sessions: [],
      currentSftpPath: '/',
      currentSftpEntries: [],
      dbLoaded: false,

      loadFromDb: () => {
        if (!isDbReady()) return
        const rows = connectionsList()
        const connections = rows.map(rowToLocal)
        const connectionMap = new Map(connections.map(c => [c.id, c]))
        set({ connections, connectionMap, dbLoaded: true })
      },

      addConnection: (conn) => {
        set((s) => {
          const newMap = new Map(s.connectionMap)
          newMap.set(conn.id, conn)
          return {
            connections: [...s.connections, conn],
            connectionMap: newMap
          }
        })
        // Persist to client SQLite
        if (isDbReady()) {
          connectionsUpsert(localToRow(conn))
        }
      },

      updateConnection: (id, data) => {
        set((s) => {
          const updated = s.connections.map((c) => (c.id === id ? { ...c, ...data } : c))
          const conn = updated.find((c) => c.id === id)
          const newMap = new Map(s.connectionMap)
          if (conn) {
            newMap.set(id, conn)
          }
          if (conn && isDbReady()) {
            connectionsUpsert(localToRow(conn))
          }
          return { connections: updated, connectionMap: newMap }
        })
      },

      deleteConnection: (id) => {
        set((s) => {
          const newMap = new Map(s.connectionMap)
          newMap.delete(id)
          return {
            connections: s.connections.filter((c) => c.id !== id),
            connectionMap: newMap,
            selectedConnectionId: s.selectedConnectionId === id ? null : s.selectedConnectionId,
          }
        })
        if (isDbReady()) {
          connectionsDelete(id)
        }
      },

      selectConnection: (id) => set({ selectedConnectionId: id }),

      addSession: (session) => set((s) => ({ sessions: [...s.sessions, session] })),

      updateSession: (id, data) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, ...data } : sess)),
        })),

      removeSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((sess) => sess.id !== id),
        })),

      setCurrentSftpPath: (path) => set({ currentSftpPath: path }),
      setCurrentSftpEntries: (entries) => set({ currentSftpEntries: entries }),

      // 新增 O(1) 查找方法
      getConnectionById: (id) => {
        return useSshStore.getState().connectionMap.get(id)
      },
    }),
    {
      name: 'wrench-ssh',
      partialize: (state) => ({
        connections: state.connections,
        selectedConnectionId: state.selectedConnectionId,
      }),
      merge: (persisted: unknown, current: SshState) => {
        const raw = persisted as {
          connections?: SshConnection[]
          selectedConnectionId?: string | null
          state?: {
            connections?: SshConnection[]
            selectedConnectionId?: string | null
          }
        }
        const state = raw.state || raw
        const connections = (state.connections || []) as SshConnection[]
        const connectionMap = new Map(connections.map(c => [c.id, c]))
        return {
          ...current,
          connections,
          connectionMap,
          selectedConnectionId: state.selectedConnectionId ?? null,
        }
      },
    },
  ),
)

/** 从客户端 SQLite 重新加载连接列表 */
export const refreshSshStore = () => {
  if (isDbReady()) {
    const rows = connectionsList()
    const connections = rows.map(rowToLocal)
    const connectionMap = new Map(connections.map(c => [c.id, c]))
    useSshStore.setState({ connections, connectionMap, dbLoaded: true })
  }
}

/**
 * 初始化时解密所有连接的敏感字段
 * 由于 decrypt 是异步的，而 zustand persist 的 merge 是同步的，
 * 我们采用「存加密值，用时才解密」的策略：
 * - 在 ConnectionForm 提交加密值到 store
 * - 在真正需要连接时（wsClient.connect）才解密
 *
 * 因此需要添加一个工具函数来解密单个连接
 */
export async function decryptConnection(conn: SshConnection): Promise<SshConnection> {
  const decrypted = await decryptSshConnection(conn as unknown as Record<string, unknown>)
  return decrypted as unknown as SshConnection
}
