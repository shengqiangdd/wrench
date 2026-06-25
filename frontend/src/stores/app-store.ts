import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'
export type NavId = 'ssh' | 'files' | 'plugins' | 'settings' | 'docker'

interface RightPanelContent {
  title: string
  component: React.ReactNode | null
}

/** SSH 页面分屏定义 */
export interface SplitDef {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  /** 命令同步组：同一组的分屏会同步输入（空字符串表示不同步） */
  syncGroup?: string
}

/** 文件管理页面连接状态 */
export interface SftpState {
  connId: string | null
  sessionId: string | null
  pathCache: Record<string, string>
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

  // ─── SSH 页面持久化状态（切换标签页后恢复） ───
  sshSidebarOpen: boolean
  setSshSidebarOpen: (open: boolean) => void
  sshSftpOpen: boolean
  setSshSftpOpen: (open: boolean) => void
  sshSplits: SplitDef[]
  setSshSplits: (splits: SplitDef[] | ((prev: SplitDef[]) => SplitDef[])) => void
  sshActiveSplitId: string | null
  setSshActiveSplitId: (id: string | null) => void

  // ─── 文件管理页面持久化状态 ───
  fmSidebarOpen: boolean
  setFmSidebarOpen: (open: boolean) => void
  fmSftpState: SftpState
  setFmSftpState: (state: SftpState) => void
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

      // SSH 页面持久化状态
      sshSidebarOpen: true,
      setSshSidebarOpen: (open) => set({ sshSidebarOpen: open }),
      sshSftpOpen: true,
      setSshSftpOpen: (open) => set({ sshSftpOpen: open }),
      sshSplits: [],
      setSshSplits: (splits) => set((s) => ({ sshSplits: typeof splits === 'function' ? splits(s.sshSplits) : splits })),
      sshActiveSplitId: null,
      setSshActiveSplitId: (id) => set({ sshActiveSplitId: id }),

      // 文件管理页面持久化状态
      fmSidebarOpen: true,
      setFmSidebarOpen: (open) => set({ fmSidebarOpen: open }),
      fmSftpState: { connId: null, sessionId: null, pathCache: {} },
      setFmSftpState: (state) => set({ fmSftpState: state }),
    }),
    {
      name: 'smartbox-app',
      partialize: (state) => ({
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        activeNav: state.activeNav,
        // SSH 页面状态
        sshSidebarOpen: state.sshSidebarOpen,
        sshSftpOpen: state.sshSftpOpen,
        sshSplits: state.sshSplits,
        sshActiveSplitId: state.sshActiveSplitId,
        // 文件管理页面状态
        fmSidebarOpen: state.fmSidebarOpen,
        fmSftpState: state.fmSftpState,
      }),
    },
  ),
)
