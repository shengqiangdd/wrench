import { describe, it, expect, beforeEach } from 'vitest'
import { useFileStore } from '../../stores/file-store'
import type { FileTab } from '../../types/file'

const mockTab: FileTab = {
  id: 'tab-1',
  name: 'index.ts',
  path: '/home/admin/index.ts',
  source: 'local',
  language: 'typescript',
  content: 'const x = 1;',
  isDirty: false,
}

const mockTab2: FileTab = {
  id: 'tab-2',
  name: 'README.md',
  path: '/home/admin/README.md',
  source: 'local',
  language: 'markdown',
  content: '# Hello',
  isDirty: false,
}

function resetFileStore() {
  useFileStore.setState({
    openTabs: [],
    activeTabId: null,
    localFiles: [],
    currentLocalPath: '',
  })
}

describe('useFileStore', () => {
  beforeEach(() => {
    resetFileStore()
  })

  describe('tabs', () => {
    it('starts with no open tabs', () => {
      expect(useFileStore.getState().openTabs).toHaveLength(0)
      expect(useFileStore.getState().activeTabId).toBeNull()
    })

    it('opens a new tab', () => {
      useFileStore.getState().openFile(mockTab)
      const state = useFileStore.getState()
      expect(state.openTabs).toHaveLength(1)
      expect(state.activeTabId).toBe('tab-1')
    })

    it('reuses existing tab on open', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab) // same tab again
      const state = useFileStore.getState()
      expect(state.openTabs).toHaveLength(1) // no duplicate
      expect(state.activeTabId).toBe('tab-1')
    })

    it('opens multiple tabs and sets the last as active', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab2)
      const state = useFileStore.getState()
      expect(state.openTabs).toHaveLength(2)
      expect(state.activeTabId).toBe('tab-2')
    })

    it('closes a tab', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab2)
      useFileStore.getState().closeFile('tab-1')
      expect(useFileStore.getState().openTabs).toHaveLength(1)
      expect(useFileStore.getState().openTabs[0]!.id).toBe('tab-2')
    })

    it('activates the last tab when closing active tab', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab2)
      useFileStore.getState().closeFile('tab-2') // close active tab
      expect(useFileStore.getState().activeTabId).toBe('tab-1')
    })

    it('sets activeTabId to null when closing last tab', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().closeFile('tab-1')
      expect(useFileStore.getState().activeTabId).toBeNull()
    })

    it('sets active tab manually', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab2)
      useFileStore.getState().setActiveTab('tab-1')
      expect(useFileStore.getState().activeTabId).toBe('tab-1')
    })

    it('updates file content and marks dirty', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().updateFileContent('tab-1', 'const y = 2;')
      const tab = useFileStore.getState().openTabs[0]!
      expect(tab.content).toBe('const y = 2;')
      expect(tab.isDirty).toBe(true)
    })

    it('marks tab as clean', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().updateFileContent('tab-1', 'modified')
      useFileStore.getState().markTabClean('tab-1')
      const tab = useFileStore.getState().openTabs[0]!
      expect(tab.isDirty).toBe(false)
      expect(tab.originalContent).toBe('modified')
    })
  })

  describe('getActiveTab', () => {
    it('returns undefined when no tabs', () => {
      expect(useFileStore.getState().getActiveTab()).toBeUndefined()
    })

    it('returns the active tab', () => {
      useFileStore.getState().openFile(mockTab)
      useFileStore.getState().openFile(mockTab2)
      useFileStore.getState().setActiveTab('tab-1')
      const active = useFileStore.getState().getActiveTab()
      expect(active?.id).toBe('tab-1')
      expect(active?.name).toBe('index.ts')
    })
  })

  describe('local files', () => {
    it('sets local files', () => {
      useFileStore.getState().setLocalFiles('/home/admin', [
        { name: 'src', path: '/home/admin/src', type: 'directory', isDirectory: true },
        { name: 'package.json', path: '/home/admin/package.json', type: 'file', isDirectory: false },
      ])
      const state = useFileStore.getState()
      expect(state.currentLocalPath).toBe('/home/admin')
      expect(state.localFiles).toHaveLength(2)
      expect(state.localFiles[1]!.name).toBe('package.json')
    })
  })
})
