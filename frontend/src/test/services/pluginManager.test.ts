import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchPlugins,
  fetchPluginCode,
  fetchPluginManifest,
  loadPluginToSandbox,
  unloadPlugin,
  executeSandboxCommand,
  syncEditorToSandbox,
} from '../../services/pluginManager'
import { usePluginStore } from '../../stores/plugin-store'
import type { PluginManifest, PluginAPI } from '../../types/plugin'

// Mock auth module — authedFetch wraps this for all /api/ calls
vi.mock('../../services/auth', () => ({
  authedFetch: vi.fn(async (url: string, init?: RequestInit) => {
    return globalThis.fetch(url, init)
  }),
  getToken: vi.fn(async () => 'test-token'),
  buildWsUrl: vi.fn(async (path: string) => `ws://localhost${path}`),
}))

// Mock fetch globally
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock pluginSandboxManager
vi.mock('../../services/pluginSandboxManager', () => ({
  pluginSandboxManager: {
    register: vi.fn(),
    unregister: vi.fn(),
    getHandle: vi.fn(),
    executeCommand: vi.fn(),
    isRegistered: vi.fn(() => true),
    syncEditorContent: vi.fn(),
  },
}))

const mockPluginCatalog = {
  success: true,
  data: [
    {
      id: 'plugin-json-viewer',
      name: 'JSON Viewer',
      version: '1.0.0',
      description: 'View JSON files',
      author: 'Wrench',
      icon: '🔍',
      entry: '/plugins/json-viewer/index.js',
      commands: [{ id: 'format', label: 'Format JSON', description: 'Format JSON content' }],
      panels: [{ id: 'json-panel', title: 'JSON Tree', icon: '🔍' }],
    },
  ],
}

const mockPluginCode = `
(function() {
  return { init: () => console.log('init') }
})()
`

describe('pluginManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store to initial state (plugins is an array, not object)
    usePluginStore.setState({
      plugins: [],
      commands: [],
      panels: [],
    })
  })

  describe('fetchPlugins', () => {
    it('returns plugin list on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPluginCatalog),
      })
      const plugins = await fetchPlugins()
      expect(plugins).toHaveLength(1)
      expect(plugins[0]!.name).toBe('JSON Viewer')
    })

    it('returns empty array on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })
      const plugins = await fetchPlugins()
      expect(plugins).toEqual([])
    })

    it('returns empty array on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'))
      const plugins = await fetchPlugins()
      expect(plugins).toEqual([])
    })
  })

  describe('fetchPluginCode', () => {
    it('returns plugin code on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockPluginCode),
      })
      const code = await fetchPluginCode('/plugins/test/index.js')
      expect(code).toContain('return { init:')
    })

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      await expect(fetchPluginCode('/missing.js')).rejects.toThrow('HTTP 404')
    })
  })

  describe('fetchPluginManifest', () => {
    it('returns manifest on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPluginCatalog.data[0]),
      })
      const manifest = await fetchPluginManifest('/plugins/test/manifest.json')
      expect(manifest?.id).toBe('plugin-json-viewer')
    })

    it('throws on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
      await expect(fetchPluginManifest('/bad/manifest.json')).rejects.toThrow('HTTP 500')
    })
  })

  describe('loadPluginToSandbox', () => {
    it('loads a plugin successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockPluginCode),
      })
      await loadPluginToSandbox(mockPluginCatalog.data[0]!)
      // Verify the plugin was registered
      const stored = usePluginStore.getState().plugins
      expect(stored.length).toBe(1)
      expect(stored[0]!.manifest.id).toBe('plugin-json-viewer')
    })

    it('handles fetch failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))
      const result = await loadPluginToSandbox(mockPluginCatalog.data[0]!)
      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })
  })

  describe('unloadPlugin', () => {
    it('unregisters plugin from store and sandbox', () => {
      // First manually register a plugin
      const { registerPlugin } = usePluginStore.getState()
      registerPlugin(
        mockPluginCatalog.data[0]! as unknown as PluginManifest,
        {
          addCommand: vi.fn(),
          addPanel: vi.fn(),
        } as unknown as PluginAPI,
      )

      expect(usePluginStore.getState().plugins.length).toBe(1)

      unloadPlugin('plugin-json-viewer')
      expect(usePluginStore.getState().plugins.length).toBe(0)
    })
  })

  describe('executeSandboxCommand', () => {
    it('delegates to sandbox manager', () => {
      const result = executeSandboxCommand('plugin-json-viewer', 'format')
      expect(result).toBe(true)
    })
  })

  describe('syncEditorToSandbox', () => {
    it('delegates to sandbox manager', () => {
      syncEditorToSandbox('plugin-id', 'code')
    })
  })
})
