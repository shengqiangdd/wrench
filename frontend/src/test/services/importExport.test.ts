import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock crypto
vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue({ type: 'secret' }),
    deriveKey: vi.fn().mockResolvedValue({ type: 'secret' }),
    encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
    decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('{"version":2,"exportedAt":"2024","appVersion":"1.0","data":{"connections":[],"aiConfig":{},"appState":{"theme":"dark"},"plugins":[]}}').buffer),
  },
})

import { exportConfig, importConfig, collectExportData } from '../../services/importExport'

// Mock store hooks used by collectExportData
vi.mock('../../stores/ssh-store', () => ({
  useSshStore: Object.assign(
    (selector: (s: any) => any) => selector({ connections: [] }),
    { getState: () => ({ connections: [] }) },
  ),
}))

vi.mock('../../stores/ai-store', () => ({
  useAiStore: Object.assign(
    (selector: (s: any) => any) => selector({ config: { provider: 'openai' } }),
    { getState: () => ({ config: null }) },
  ),
}))

vi.mock('../../stores/plugin-store', () => ({
  usePluginStore: Object.assign(
    (selector: (s: any) => any) => selector({ enabledPlugins: [] }),
    { getState: () => ({ enabledPlugins: [] }) },
  ),
}))

vi.mock('../../stores/app-store', () => ({
  useAppStore: Object.assign(
    (selector: (s: any) => any) => selector({ theme: 'dark', sidebarCollapsed: false }),
    { getState: () => ({ theme: 'dark', sidebarCollapsed: false }) },
  ),
}))

describe('importExport service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('collects export data from stores', () => {
    const data = collectExportData()
    expect(data).toBeDefined()
    expect(data.appState).toBeDefined()
    expect(data.connections).toEqual([])
    expect(data.aiConfig).toBeDefined()
  })

  it('exports configuration as string', () => {
    // exportConfig triggers browser download, verify no error
    expect(() => exportConfig()).not.toThrow()
  })

  it('exports configuration with password (no throw)', () => {
    expect(() => exportConfig('mypassword')).not.toThrow()
  })

  it('rejects import of invalid file', async () => {
    const file = new File(['not-json'], 'config.smartbox', { type: 'application/json' })
    await expect(importConfig(file, '')).rejects.toThrow()
  })

  it('rejects import of corrupted file', async () => {
    const file = new File(['{invalid json}',], 'config.smartbox', { type: 'application/json' })
    await expect(importConfig(file, '')).rejects.toThrow()
  })
})
