import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { useAppStore } from '../../stores/app-store'

// jsdom 没有 localStorage, persist 中间件需要它
beforeAll(() => {
  const store: Record<string, string> = {}
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k])
    },
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  }
})

// 每个测试前重置 store
beforeEach(() => {
  useAppStore.setState({
    activeNav: 'ssh',
    theme: 'dark',
    sidebarCollapsed: false,
    commandPaletteOpen: false,
    sshSessions: [],
  })
})

describe('AppStore - UI Slice', () => {
  it('sets active navigation', () => {
    useAppStore.getState().setActiveNav('docker')
    expect(useAppStore.getState().activeNav).toBe('docker')
  })

  it('toggles sidebar', () => {
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState().sidebarCollapsed).toBe(true)
    useAppStore.getState().toggleSidebar()
    expect(useAppStore.getState().sidebarCollapsed).toBe(false)
  })

  it('manages command palette', () => {
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
    useAppStore.getState().setCommandPaletteOpen(true)
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
  })

  it('manages right panel', () => {
    expect(useAppStore.getState().rightPanelOpen).toBe(false)
    useAppStore.getState().toggleRightPanel()
    expect(useAppStore.getState().rightPanelOpen).toBe(true)

    const content = { title: '测试', component: null }
    useAppStore.getState().setRightPanelContent(content)
    expect(useAppStore.getState().rightPanelOpen).toBe(true)
    expect(useAppStore.getState().rightPanelContent?.title).toBe('测试')
  })
})

describe('AppStore - Theme Slice', () => {
  it('sets theme', () => {
    expect(useAppStore.getState().theme).toBe('dark')
    useAppStore.getState().setTheme('light')
    expect(useAppStore.getState().theme).toBe('light')
    useAppStore.getState().setTheme('system')
    expect(useAppStore.getState().theme).toBe('system')
  })
})

describe('AppStore - SSH Session Slice', () => {
  it('adds and removes SSH sessions', () => {
    useAppStore.getState().addSshSession('session-1')
    useAppStore.getState().addSshSession('session-2')
    expect(useAppStore.getState().sshSessions).toHaveLength(2)
    useAppStore.getState().removeSshSession('session-1')
    expect(useAppStore.getState().sshSessions).toEqual(['session-2'])
  })

  it('manages SSH splits', () => {
    const split = {
      id: 'split-1',
      connectionId: 'conn-1',
      sessionId: 'sess-1',
      direction: 'vertical' as const,
    }
    useAppStore.getState().setSshSplits([split])
    expect(useAppStore.getState().sshSplits).toHaveLength(1)
    useAppStore.getState().setSshSplits((prev) => [...prev, { ...split, id: 'split-2' }])
    expect(useAppStore.getState().sshSplits).toHaveLength(2)
  })
})
