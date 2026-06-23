import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'
export type NavId = 'ssh' | 'files' | 'plugins' | 'settings'

interface RightPanelContent {
  title: string
  component: React.ReactNode | null
}

interface AppState {
  // 导航
  activeNav: NavId
  setActiveNav: (nav: NavId) => void

  // 主题
  theme: Theme
  setTheme: (theme: Theme) => void

  // 侧栏
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  // 右侧面板
  rightPanelOpen: boolean
  rightPanelContent: RightPanelContent | null
  toggleRightPanel: () => void
  setRightPanelContent: (content: RightPanelContent | null) => void

  // SSH 会话
  sshSessions: string[]
  addSshSession: (id: string) => void
  removeSshSession: (id: string) => void

  // 命令面板
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      activeNav: 'ssh',
      setActiveNav: (nav) => set({ activeNav: nav }),

      theme: 'dark',
      setTheme: (theme) => set({ theme }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      rightPanelOpen: false,
      rightPanelContent: null,
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setRightPanelContent: (content) => set({ rightPanelContent: content, rightPanelOpen: !!content }),

      sshSessions: [],
      addSshSession: (id) => set((s) => ({ sshSessions: [...s.sshSessions, id] })),
      removeSshSession: (id) => set((s) => ({ sshSessions: s.sshSessions.filter((sid) => sid !== id) })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'smartbox-app',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        activeNav: state.activeNav,
      }),
    },
  ),
)
