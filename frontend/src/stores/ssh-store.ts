/**
 * ssh-store.ts — Zustand store for SSH connections and sessions.
 *
 * Connections are persisted both in localStorage (via zustand persist)
 * and on the server (SQLite via API) for cross-device durability.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { decryptSshConnection } from '../services/secure-store'
import { authedFetch } from '../services/auth'
import type { SshConnection, SshSession, SftpEntry } from '../types/ssh'

interface ServerConnection {
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
}

/** Convert server format to local SshConnection format */
function serverToLocal(s: ServerConnection): SshConnection {
  let parsedConfig: Record<string, unknown> = {}
  try {
    parsedConfig = JSON.parse(s.config)
  } catch {
    /* ignore */
  }
  return {
    id: s.id,
    name: s.name,
    host: s.host,
    port: s.port,
    username: s.username,
    authType: s.auth_type === 'vault_ref' ? 'password' : (s.auth_type as 'password' | 'key'),
    password: (parsedConfig.password as string) || undefined,
    privateKey: (parsedConfig.private_key as string) || undefined,
    sudoPassword: (parsedConfig.sudo_password as string) || undefined,
    group: (parsedConfig.group as string) || undefined,
    createdAt: s.created_at ? new Date(s.created_at).getTime() : Date.now(),
  }
}

/** Convert local SshConnection to server payload */
function localToServer(conn: SshConnection): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  if (conn.password) config.password = conn.password
  if (conn.privateKey) config.private_key = conn.privateKey
  if (conn.sudoPassword) config.sudo_password = conn.sudoPassword
  if (conn.group) config.group = conn.group

  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    auth_type: conn.authType,
    config: JSON.stringify(config),
    sort_order: 0,
  }
}

interface SshState {
  // 连接配置
  connections: SshConnection[]
  selectedConnectionId: string | null

  // 活跃会话
  sessions: SshSession[]

  // 当前 SFTP 目录
  currentSftpPath: string
  currentSftpEntries: SftpEntry[]

  // 服务端同步状态
  serverSynced: boolean // true if we've loaded from server
  serverError: string | null

  // 连接配置操作
  addConnection: (conn: SshConnection) => void
  updateConnection: (id: string, data: Partial<SshConnection>) => void
  deleteConnection: (id: string) => void
  selectConnection: (id: string | null) => void

  // 服务端同步操作
  syncFromServer: () => Promise<void>
  pushToServer: (conn: SshConnection) => Promise<void>
  removeFromServer: (id: string) => Promise<void>

  // 会话操作
  addSession: (session: SshSession) => void
  updateSession: (id: string, data: Partial<SshSession>) => void
  removeSession: (id: string) => void

  // SFTP 操作
  setCurrentSftpPath: (path: string) => void
  setCurrentSftpEntries: (entries: SftpEntry[]) => void
}

export const useSshStore = create<SshState>()(
  persist(
    (set, get) => ({
      connections: [],
      selectedConnectionId: null,
      sessions: [],
      currentSftpPath: '/',
      currentSftpEntries: [],
      serverSynced: false,
      serverError: null,

      addConnection: (conn) => {
        set((s) => ({ connections: [...s.connections, conn] }))
        // Async push to server (fire-and-forget)
        get()
          .pushToServer(conn)
          .catch(() => {
            /* best-effort */
          })
      },

      updateConnection: (id, data) => {
        set((s) => {
          const updated = s.connections.map((c) => (c.id === id ? { ...c, ...data } : c))
          const conn = updated.find((c) => c.id === id)
          if (conn)
            get()
              .pushToServer(conn)
              .catch(() => {})
          return { connections: updated }
        })
      },

      deleteConnection: (id) => {
        set((s) => ({
          connections: s.connections.filter((c) => c.id !== id),
          selectedConnectionId: s.selectedConnectionId === id ? null : s.selectedConnectionId,
        }))
        get()
          .removeFromServer(id)
          .catch(() => {})
      },

      selectConnection: (id) => set({ selectedConnectionId: id }),

      syncFromServer: async () => {
        try {
          const res = await authedFetch('/api/connections')
          const json = await res.json()
          const serverConns: ServerConnection[] = json.data || []
          const localConns = get().connections

          // Merge: server data takes priority, but keep local connections that aren't yet on server
          const serverMap = new Map(serverConns.map((c) => [c.id, serverToLocal(c)]))
          const merged = [...serverMap.values()]

          // Add local connections not yet on server
          for (const local of localConns) {
            if (!serverMap.has(local.id)) {
              merged.push(local)
            }
          }

          set({ connections: merged, serverSynced: true, serverError: null })
        } catch (e: any) {
          set({ serverError: e.message || 'Server sync failed', serverSynced: false })
        }
      },

      pushToServer: async (conn: SshConnection) => {
        try {
          await authedFetch('/api/connections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localToServer(conn)),
          })
        } catch (e: any) {
          console.warn('Failed to push connection to server:', e.message)
        }
      },

      removeFromServer: async (id: string) => {
        try {
          await authedFetch(`/api/connections/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          })
        } catch (e: any) {
          console.warn('Failed to remove connection from server:', e.message)
        }
      },

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
    }),
    {
      name: 'smartbox-ssh',
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
        return {
          ...current,
          connections,
          selectedConnectionId: state.selectedConnectionId ?? null,
        }
      },
    },
  ),
)

/** 触发 store 重新从 localStorage 读取 */
export const refreshSshStore = () => {
  const raw = localStorage.getItem('smartbox-ssh')
  if (!raw) return
  try {
    const parsed = JSON.parse(raw)
    const state = parsed.state || parsed
    const connections = (state.connections || []) as SshConnection[]
    useSshStore.setState({
      connections,
      selectedConnectionId: state.selectedConnectionId ?? null,
    })
  } catch {
    /* ignore */
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
