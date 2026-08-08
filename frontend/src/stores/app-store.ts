import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { createUISlice, type UISlice } from './slices/ui.slice'
import { createThemeSlice, type ThemeSlice } from './slices/theme.slice'
import { createSshSessionSlice, type SshSessionSlice } from './slices/ssh-session.slice'
import { createFileManagerSlice, type FileManagerSlice } from './slices/file-manager.slice'
import type { Theme, NavId, SplitDef, SftpState } from './types'

// ── 合并后的完整 AppState 类型 ──
export type AppState = UISlice & ThemeSlice & SshSessionSlice & FileManagerSlice

// ── 重新导出类型（保持向后兼容） ──
export type { Theme, NavId, SplitDef, SftpState }

// ── 创建 store（Slice 模式组合） ──
export const useAppStore = create<AppState>()(
  persist(
    (...a) => ({
      ...createUISlice(...a),
      ...createThemeSlice(...a),
      ...createSshSessionSlice(...a),
      ...createFileManagerSlice(...a),
    }),
    {
      name: 'wrench-app',
      partialize: (state) => ({
        // 只持久化需要跨会话保留的状态
        activeNav: state.activeNav,
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        // SSH 页面持久化状态
        sshSidebarOpen: state.sshSidebarOpen,
        sshSftpOpen: state.sshSftpOpen,
        sshSplits: state.sshSplits,
        sshActiveSplitId: state.sshActiveSplitId,
        // 文件管理页面持久化状态
        fmSidebarOpen: state.fmSidebarOpen,
        fmSftpState: state.fmSftpState,
      }),
    },
  ),
)

/** 重新加载 AppStore 数据（用于导入配置后刷新） */
export const refreshAppStore = () => {
  useAppStore.persist.rehydrate()
}
