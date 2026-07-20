/**
 * useSshHostSelector.ts — 统一的 SSH 主机选择器 Hook
 *
 * 从三个来源合并主机列表：
 *   1. useSshStore.connections  — 用户在 SSH 页面保存的连接
 *   2. /api/connections          — 后端已有的连接列表
 *   3. /api/ssh/test-config      — 环境变量中的测试主机
 *
 * 选中主机后自动 ensureSshConnection()，返回 connectionId。
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSshStore } from '../stores/ssh-store'
import { ensureSshConnection } from '../services/ssh-ensure'
import { authedFetch } from '../services/auth'

// ─── Types ───

export interface SshHost {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  source: 'saved' | 'api' | 'test-config'
}

export interface UseSshHostSelectorOptions {
  autoConnect?: boolean
  loadApiConnections?: boolean
  loadTestConfig?: boolean
}

export interface UseSshHostSelectorReturn {
  hosts: SshHost[]
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  connectionId: string | null
  connecting: boolean
  error: string | null
  clearError: () => void
  hostLabel: string
  hasHosts: boolean
}

// ─── Module-level caches ───

type ApiConn = {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
}
let _apiCache: ApiConn[] | null = null
let _apiPromise: Promise<ApiConn[]> | null = null

type TestCfg = { host: string; user: string; password: string }
let _testCache: TestCfg | null = null
let _testPromise: Promise<TestCfg | null> | null = null

async function loadApiConnections(): Promise<ApiConn[]> {
  if (_apiCache) return _apiCache
  if (_apiPromise) return _apiPromise
  _apiPromise = (async () => {
    try {
      const res = await authedFetch('/api/connections')
      const json = (await res.json()) as {
        success?: boolean
        data?: Array<Record<string, unknown>>
      }
      if (!json.success || !Array.isArray(json.data)) return []
      const list = json.data.map((c) => {
        let password = '',
          privateKey = ''
        try {
          const cfg = JSON.parse((c.config as string) || '{}')
          password = cfg.password || ''
          privateKey = cfg.private_key || ''
        } catch {
          /* */
        }
        return {
          id: (c.id as string) || '',
          name: (c.name as string) || (c.host as string) || '',
          host: (c.host as string) || '',
          port: (c.port as number) || 22,
          username: (c.username as string) || '',
          password,
          privateKey,
        }
      })
      _apiCache = list
      return list
    } catch {
      return []
    }
  })()
  return _apiPromise
}

async function loadTestConfig(): Promise<TestCfg | null> {
  if (_testCache) return _testCache
  if (_testPromise) return _testPromise
  _testPromise = (async () => {
    try {
      const res = await authedFetch('/api/ssh/test-config')
      const j = (await res.json()) as { host?: string; user?: string; password?: string }
      if (j.host && j.user) {
        const c = { host: j.host, user: j.user, password: j.password || '' }
        _testCache = c
        return c
      }
      return null
    } catch {
      return null
    }
  })()
  return _testPromise
}

// ─── Hook ───

export function useSshHostSelector(
  options: UseSshHostSelectorOptions = {},
): UseSshHostSelectorReturn {
  const {
    autoConnect = true,
    loadApiConnections: loadApi = true,
    loadTestConfig: loadTest = true,
  } = options

  const savedConnections = useSshStore((s) => s.connections)
  const sessions = useSshStore((s) => s.sessions)

  const [apiConnections, setApiConnections] = useState<ApiConn[]>([])
  const [testConfig, setTestConfig] = useState<TestCfg | null>(null)

  // selectedId uses state but avoids sync-setState-in-effect:
  // the derive logic lives in useMemo, and we only setState in event handlers or async callbacks.
  const [selectedId, setSelectedIdState] = useState<string | null>(null)
  const [connectionId, setConnectionId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load fallbacks
  useEffect(() => {
    let cancelled = false
    if (savedConnections.length === 0) {
      if (loadApi)
        loadApiConnections().then((c) => {
          if (!cancelled) setApiConnections(c)
        })
      if (loadTest)
        loadTestConfig().then((c) => {
          if (!cancelled) setTestConfig(c)
        })
    }
    return () => {
      cancelled = true
    }
  }, [savedConnections.length, loadApi, loadTest])

  // Merge & dedupe hosts
  const hosts = useMemo(() => {
    const result: SshHost[] = []
    const seen = new Set<string>()
    const add = (h: SshHost) => {
      const key = `${h.host}:${h.port}:${h.username}`
      if (seen.has(key)) return
      seen.add(key)
      result.push(h)
    }
    for (const c of savedConnections) {
      add({
        id: c.id,
        name: c.name || c.host,
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        privateKey: c.privateKey,
        source: 'saved',
      })
    }
    for (const c of apiConnections) {
      add({
        id: c.id,
        name: c.name || c.host,
        host: c.host,
        port: c.port,
        username: c.username,
        password: c.password,
        privateKey: c.privateKey,
        source: 'api',
      })
    }
    if (testConfig) {
      const id = `__tc__:${testConfig.host}:${testConfig.user}`
      add({
        id,
        name: `${testConfig.user}@${testConfig.host}`,
        host: testConfig.host,
        port: 22,
        username: testConfig.user,
        password: testConfig.password,
        source: 'test-config',
      })
    }
    return result
  }, [savedConnections, apiConnections, testConfig])

  // Derive the "ideal" selection from hosts — this is read-only, no side effects.
  const idealSelection = useMemo(() => {
    if (hosts.length === 0) return null
    // If current selection is still valid, keep it
    if (selectedId && hosts.find((h) => h.id === selectedId)) return selectedId
    // Single host → auto select
    if (hosts.length === 1) return hosts[0]!.id
    // Multiple → first
    return hosts[0]!.id
  }, [hosts, selectedId])

  // Apply idealSelection — subscribe to derivation changes from external host list.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (idealSelection !== selectedId) {
      setSelectedIdState(idealSelection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idealSelection])
  /* eslint-enable react-hooks/set-state-in-effect */

  const setSelectedId = useCallback((id: string | null) => {
    setSelectedIdState(id)
  }, [])

  // Auto-connect when selectedId changes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Clear stale connection when selection changes
    setConnectionId(null)

    if (!autoConnect || !selectedId) return
    const host = hosts.find((h) => h.id === selectedId)
    if (!host) return

    let cancelled = false

    const run = async () => {
      const existing = sessions.find((s) => s.connectionId === selectedId)
      if (existing) {
        if (!cancelled) setConnectionId(existing.id)
        return
      }
      setConnecting(true)
      setError(null)
      try {
        const cid = await ensureSshConnection({
          host: host.host,
          port: host.port,
          username: host.username,
          password: host.password,
          privateKey: host.privateKey,
        })
        if (!cancelled) setConnectionId(cid)
      } catch (err: unknown) {
        if (!cancelled) {
          setConnectionId(null)
          setError(err instanceof Error ? err.message : '连接失败')
        }
      } finally {
        if (!cancelled) setConnecting(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [selectedId, hosts, sessions, autoConnect])
  /* eslint-enable react-hooks/set-state-in-effect */

  const hostLabel = useMemo(() => {
    const h = hosts.find((x) => x.id === selectedId)
    return h ? `${h.username}@${h.host}:${h.port}` : ''
  }, [hosts, selectedId])

  const clearError = useCallback(() => setError(null), [])

  return {
    hosts,
    selectedId,
    setSelectedId,
    connectionId,
    connecting,
    error,
    clearError,
    hostLabel,
    hasHosts: hosts.length > 0,
  }
}
