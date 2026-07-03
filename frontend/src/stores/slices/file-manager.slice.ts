import type { StateCreator } from 'zustand'
import type { SftpState } from '../types'

export interface FileManagerSlice {
  fmSidebarOpen: boolean
  setFmSidebarOpen: (open: boolean) => void
  fmSftpState: SftpState
  setFmSftpState: (state: SftpState) => void
}

export const createFileManagerSlice: StateCreator<FileManagerSlice, [], [], FileManagerSlice> = (
  set,
) => ({
  fmSidebarOpen: false,
  setFmSidebarOpen: (open) => set({ fmSidebarOpen: open }),
  fmSftpState: { connId: null, sessionId: null, pathCache: {} },
  setFmSftpState: (state) => set({ fmSftpState: state }),
})
