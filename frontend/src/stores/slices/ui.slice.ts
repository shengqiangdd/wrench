import type { StateCreator } from 'zustand'
import type { NavId } from '../types'

export interface UISlice {
  activeNav: NavId
  setActiveNav: (nav: NavId) => void

  sidebarCollapsed: boolean
  toggleSidebar: () => void

  rightPanelOpen: boolean
  rightPanelContent: { title: string; component: React.ReactNode | null } | null
  toggleRightPanel: () => void
  setRightPanelContent: (content: { title: string; component: React.ReactNode | null } | null) => void

  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
}

export const createUISlice: StateCreator<UISlice, [], [], UISlice> = (set) => ({
  activeNav: 'ssh',
  setActiveNav: (nav) => set({ activeNav: nav }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  rightPanelOpen: false,
  rightPanelContent: null,
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setRightPanelContent: (content) => set({ rightPanelContent: content, rightPanelOpen: !!content }),

  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
})
