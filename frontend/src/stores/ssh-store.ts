import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SshConnection, SshSession, SftpEntry } from '../types/ssh'

interface SshState {
  // 连接配置
  connections: SshConnection[]
  selectedConnectionId: string | null

  // 活跃会话
  sessions: SshSession[]

  // 当前 SFTP 目录
  currentSftpPath: string
  currentSftpEntries: SftpEntry[]

  // 连接配置操作
  addConnection: (conn: SshConnection) => void
  updateConnection: (id: string, data: Partial<SshConnection>) => void
  deleteConnection: (id: string) => void
  selectConnection: (id: string | null) => void

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
    (set) => ({
      connections: [],
      selectedConnectionId: null,
      sessions: [],
      currentSftpPath: '/',
      currentSftpEntries: [],

      addConnection: (conn) =>
        set((s) => ({ connections: [...s.connections, conn] })),

      updateConnection: (id, data) =>
        set((s) => ({
          connections: s.connections.map((c) =>
            c.id === id ? { ...c, ...data } : c,
          ),
        })),

      deleteConnection: (id) =>
        set((s) => ({
          connections: s.connections.filter((c) => c.id !== id),
          selectedConnectionId:
            s.selectedConnectionId === id ? null : s.selectedConnectionId,
        })),

      selectConnection: (id) => set({ selectedConnectionId: id }),

      addSession: (session) =>
        set((s) => ({ sessions: [...s.sessions, session] })),

      updateSession: (id, data) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === id ? { ...sess, ...data } : sess,
          ),
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
    },
  ),
)
