import { create } from 'zustand'
import type { FileTab, FileEntry, FileSource } from '../types/file'

interface FileState {
  // 当前打开的标签页
  openTabs: FileTab[]
  activeTabId: string | null

  // 本地文件树
  localFiles: FileEntry[]
  currentLocalPath: string

  // 操作
  openFile: (tab: FileTab) => void
  closeFile: (tabId: string) => void
  setActiveTab: (tabId: string | null) => void
  updateFileContent: (tabId: string, content: string) => void
  markTabClean: (tabId: string) => void
  setLocalFiles: (path: string, files: FileEntry[]) => void

  // 工具
  getActiveTab: () => FileTab | undefined
}

export const useFileStore = create<FileState>()((set, get) => ({
  openTabs: [],
  activeTabId: null,
  localFiles: [],
  currentLocalPath: '',

  openFile: (tab) =>
    set((s) => {
      const existing = s.openTabs.find((t) => t.id === tab.id)
      if (existing) {
        return { activeTabId: tab.id }
      }
      return {
        openTabs: [...s.openTabs, tab],
        activeTabId: tab.id,
      }
    }),

  closeFile: (tabId) =>
    set((s) => {
      const tabs = s.openTabs.filter((t) => t.id !== tabId)
      let activeTabId = s.activeTabId
      if (activeTabId === tabId) {
        const lastTab = tabs[tabs.length - 1]
        activeTabId = lastTab ? lastTab.id : null
      }
      return { openTabs: tabs, activeTabId }
    }),

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateFileContent: (tabId, content) =>
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, content, isDirty: true } : t,
      ),
    })),

  markTabClean: (tabId) =>
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: false, originalContent: t.content } : t,
      ),
    })),

  setLocalFiles: (path, files) =>
    set({ currentLocalPath: path, localFiles: files }),

  getActiveTab: () => {
    const state = get()
    return state.openTabs.find((t) => t.id === state.activeTabId)
  },
}))
