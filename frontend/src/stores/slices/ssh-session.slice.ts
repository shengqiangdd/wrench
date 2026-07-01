import type { StateCreator } from 'zustand'
import type { SplitDef } from '../types'

export interface SshSessionSlice {
  /** SSH 页面持久化状态（切换标签页后恢复） */
  sshSessions: string[]
  addSshSession: (id: string) => void
  removeSshSession: (id: string) => void

  sshSidebarOpen: boolean
  setSshSidebarOpen: (open: boolean) => void
  sshSftpOpen: boolean
  setSshSftpOpen: (open: boolean) => void
  sshSplits: SplitDef[]
  setSshSplits: (splits: SplitDef[] | ((prev: SplitDef[]) => SplitDef[])) => void
  sshActiveSplitId: string | null
  setSshActiveSplitId: (id: string | null) => void
}

export const createSshSessionSlice: StateCreator<SshSessionSlice, [], [], SshSessionSlice> = (set) => ({
  sshSessions: [],
  addSshSession: (id) => set((s) => ({ sshSessions: [...s.sshSessions, id] })),
  removeSshSession: (id) => set((s) => ({ sshSessions: s.sshSessions.filter((sid) => sid !== id) })),

  sshSidebarOpen: false,
  setSshSidebarOpen: (open) => set({ sshSidebarOpen: open }),
  sshSftpOpen: false,
  setSshSftpOpen: (open) => set({ sshSftpOpen: open }),
  sshSplits: [],
  setSshSplits: (splits) =>
    set((s) => ({
      sshSplits: typeof splits === 'function' ? splits(s.sshSplits) : splits,
    })),
  sshActiveSplitId: null,
  setSshActiveSplitId: (id) => set({ sshActiveSplitId: id }),
})
