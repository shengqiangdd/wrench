import { describe, it, expect, beforeEach, vi } from 'vitest'
import { usePluginStore, refreshPluginStore } from '../../stores/plugin-store'
import type { PluginManifest } from '../../types/plugin'

const mockManifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  description: 'A test plugin',
  author: 'Tester',
  icon: '🧪',
  entry: '/plugins/test/index.js',
  commands: [
    { id: 'cmd-1', name: 'Command One', label: 'Cmd1', description: 'First command' },
    { id: 'cmd-2', name: 'Command Two', label: 'Cmd2', description: 'Second command' },
  ],
  panels: [{ id: 'panel-1', name: 'Panel One', icon: '📋', position: 'sidebar' }],
}

const mockManifest2: PluginManifest = {
  id: 'test-plugin-2',
  name: 'Test Plugin 2',
  version: '2.0.0',
  description: 'Another test plugin',
  author: 'Tester',
  entry: '/plugins/test2/index.js',
  commands: [{ id: 'cmd-3', name: 'Command Three', label: 'Cmd3' }],
}

const mockApi = {
  registerCommand: vi.fn(),
  registerPanel: vi.fn(),
  getFileContent: vi.fn(),
  setFileContent: vi.fn(),
  getCurrentFileLanguage: vi.fn(),
  showNotification: vi.fn(),
} as any

describe('plugin-store', () => {
  beforeEach(() => {
    usePluginStore.setState({ plugins: [], commands: [], panels: [] })
    refreshPluginStore()
  })

  describe('registerPlugin', () => {
    it('registers plugin with commands and panels', () => {
      const id = usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      expect(id).toBe('test-plugin')

      const state = usePluginStore.getState()
      expect(state.plugins).toHaveLength(1)
      expect(state.plugins[0]!.manifest.id).toBe('test-plugin')
      expect(state.plugins[0]!.enabled).toBe(true)
      expect(state.commands).toHaveLength(2)
      expect(state.commands[0]!.id).toBe('cmd-1')
      expect(state.panels).toHaveLength(1)
      expect(state.panels[0]!.id).toBe('panel-1')
    })

    it('registers multiple plugins', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      usePluginStore.getState().registerPlugin(mockManifest2, mockApi)

      const state = usePluginStore.getState()
      expect(state.plugins).toHaveLength(2)
      expect(state.commands).toHaveLength(3) // 2 + 1
    })
  })

  describe('unregisterPlugin', () => {
    it('removes plugin and its commands/panels', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      expect(usePluginStore.getState().plugins).toHaveLength(1)

      usePluginStore.getState().unregisterPlugin('test-plugin')
      const state = usePluginStore.getState()
      expect(state.plugins).toHaveLength(0)
      expect(state.commands).toHaveLength(0)
      expect(state.panels).toHaveLength(0)
    })

    it('does nothing for unknown plugin id', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      usePluginStore.getState().unregisterPlugin('nonexistent')
      expect(usePluginStore.getState().plugins).toHaveLength(1)
    })
  })

  describe('enablePlugin / disablePlugin', () => {
    it('disables and re-enables a plugin', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)

      usePluginStore.getState().disablePlugin('test-plugin')
      expect(usePluginStore.getState().plugins[0]!.enabled).toBe(false)

      usePluginStore.getState().enablePlugin('test-plugin')
      expect(usePluginStore.getState().plugins[0]!.enabled).toBe(true)
    })

    it('does not affect other plugins', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      usePluginStore.getState().registerPlugin(mockManifest2, mockApi)

      usePluginStore.getState().disablePlugin('test-plugin')
      expect(usePluginStore.getState().plugins[0]!.enabled).toBe(false)
      expect(usePluginStore.getState().plugins[1]!.enabled).toBe(true)
    })
  })

  describe('getPlugin', () => {
    it('returns plugin by id', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      const plugin = usePluginStore.getState().getPlugin('test-plugin')
      expect(plugin).toBeDefined()
      expect(plugin?.manifest.name).toBe('Test Plugin')
    })

    it('returns undefined for unknown id', () => {
      expect(usePluginStore.getState().getPlugin('nonexistent')).toBeUndefined()
    })
  })

  describe('getCommands / getPanels', () => {
    it('returns all registered commands', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      const cmds = usePluginStore.getState().getCommands()
      expect(cmds).toHaveLength(2)
      expect(cmds[0]!.name).toBe('Command One')
    })

    it('returns all registered panels', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      const panels = usePluginStore.getState().getPanels()
      expect(panels).toHaveLength(1)
      expect(panels[0]!.name).toBe('Panel One')
    })
  })

  describe('mapCommandToPlugin', () => {
    it('maps command to plugin and executeCommand delegates', () => {
      usePluginStore.getState().registerPlugin(mockManifest, mockApi)
      usePluginStore.getState().mapCommandToPlugin('cmd-1', 'test-plugin')

      // executeCommand should not throw
      expect(() => usePluginStore.getState().executeCommand('cmd-1')).not.toThrow()
    })
  })
})
