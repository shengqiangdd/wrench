import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Puzzle,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
  Shield,
  Play,
  Globe,
} from 'lucide-react'
import { fetchPlugins, fetchPluginCode, unloadPlugin } from '../../services/pluginManager'
import { usePluginStore } from '../../stores/plugin-store'
import { getWsClientSync } from '../../services/websocket'
import PluginSandbox from '../../components/PluginSandbox'
import { pluginSandboxManager } from '../../services/pluginSandboxManager'
import type { PluginCatalogItem } from '../../services/pluginManager'
import type { PluginSandboxHandle } from '../../components/PluginSandbox'
import PluginMarket from './PluginMarket'

type TabId = 'installed' | 'market'

export default function PluginsPage() {
  const [tab, setTab] = useState<TabId>('installed')
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sandboxCodes, setSandboxCodes] = useState<Record<string, string>>({})
  const [sandboxReady, setSandboxReady] = useState<Record<string, boolean>>({})
  const [sandboxKeys, setSandboxKeys] = useState<Record<string, number>>({})

  const storePlugins = usePluginStore((s) => s.plugins)
  const enablePlugin = usePluginStore((s) => s.enablePlugin)
  const disablePlugin = usePluginStore((s) => s.disablePlugin)

  const loadingRef = useRef(false)
  const catalogRef = useRef<PluginCatalogItem[]>([])

  const loadPlugins = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const plugins = await fetchPlugins()
      setCatalog(plugins)
      catalogRef.current = plugins

      const codes: Record<string, string> = {}
      const keys: Record<string, number> = {}

      for (const plugin of plugins) {
        try {
          codes[plugin.id] = await fetchPluginCode(plugin.entry)
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err)
          console.error(`[PluginsPage] Failed to fetch code for "${plugin.id}":`, errMsg)
        }
        keys[plugin.id] = Date.now() + Math.random()
      }

      setSandboxCodes(codes)
      setSandboxKeys(keys)
      setSandboxReady({})

      const store = usePluginStore.getState()
      for (const plugin of plugins) {
        if (!store.getPlugin(plugin.id)) {
          store.registerPlugin(
            {
              id: plugin.id,
              name: plugin.name,
              version: plugin.version,
              description: plugin.description,
              author: plugin.author,
              icon: plugin.icon,
              entry: plugin.entry,
              commands: plugin.commands.map((c) => ({
                id: c.id,
                name: c.label || c.id,
                description: c.description,
                icon: c.icon,
              })),
              panels: plugin.panels.map((p) => ({
                id: p.id,
                name: p.title || p.id,
                icon: p.icon,
                position: 'main' as const,
              })),
            },
            {} as never,
          )
        }
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '加载插件失败'
      setError(errMsg)
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [])

  const handleToggle = useCallback(
    (pluginId: string, currentlyEnabled: boolean) => {
      if (currentlyEnabled) {
        disablePlugin(pluginId)
      } else {
        enablePlugin(pluginId)
      }
    },
    [enablePlugin, disablePlugin],
  )

  const handleReload = useCallback(() => {
    loadingRef.current = false
    for (const plugin of catalogRef.current) {
      unloadPlugin(plugin.id)
    }
    setSandboxCodes({})
    setSandboxReady({})
    setSandboxKeys({})
    setCatalog([])
    loadPlugins()
  }, [loadPlugins])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPlugins()
    const unsub = getWsClientSync().on('plugins-changed', () => {
      handleReload()
    })
    return () => {
      unsub()
    }
  }, [loadPlugins, handleReload])

  // 稳定的 onReady 回调 — 使用 ref 避免重新创建
  const handleSandboxReady = useCallback((pluginId: string, handle: PluginSandboxHandle) => {
    setSandboxReady((prev) => ({ ...prev, [pluginId]: true }))
    const plugin = catalogRef.current.find((p) => p.id === pluginId)
    if (plugin) {
      pluginSandboxManager.register(
        {
          id: plugin.id,
          name: plugin.name,
          version: plugin.version,
          description: plugin.description,
          author: plugin.author,
          icon: plugin.icon,
          entry: plugin.entry,
          commands: (plugin.commands || []).map((c) => ({
            id: c.id,
            name: c.label || c.id,
            label: c.label,
            description: c.description,
            icon: c.icon,
          })),
          panels: (plugin.panels || []).map((p2) => ({
            id: p2.id,
            name: p2.title || p2.id,
            icon: p2.icon,
            position: 'main' as const,
          })),
        },
        handle,
      )
    }
  }, [])

  const enabledMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const p of storePlugins) {
      if (p.enabled) map[p.manifest.id] = true
    }
    return map
  }, [storePlugins])

  const readyCount = useMemo(
    () => Object.values(sandboxReady).filter(Boolean).length,
    [sandboxReady],
  )
  const codesCount = useMemo(() => Object.keys(sandboxCodes).length, [sandboxCodes])

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Puzzle size={20} className="text-slate-400" />
              <h2 className="text-lg font-semibold text-slate-200">插件</h2>
            </div>
            <div className="flex rounded-lg border border-slate-700/50 bg-slate-900 p-0.5">
              <button
                onClick={() => setTab('installed')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === 'installed'
                    ? 'bg-slate-700/60 text-slate-200 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Puzzle size={13} />
                已安装
                {catalog.length > 0 && (
                  <span className="ml-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {catalog.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setTab('market')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === 'market'
                    ? 'bg-slate-700/60 text-slate-200 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <Globe size={13} />
                市场
              </button>
            </div>
          </div>
          {tab === 'installed' && (
            <div className="flex items-center gap-2">
              {catalog.length > 0 && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-500/70">
                  <Shield size={12} />
                  沙箱隔离
                </span>
              )}
              <button
                onClick={handleReload}
                disabled={loading}
                className="btn-secondary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
          )}
        </div>
      </div>

      {tab === 'installed' && (
        <>
          {loading && catalog.length === 0 && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Loader2 size={32} className="mx-auto mb-3 animate-spin text-slate-500" />
                <p className="text-sm text-slate-500">正在加载插件...</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <AlertCircle size={40} className="mx-auto mb-3 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
                <button
                  onClick={handleReload}
                  className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700"
                >
                  重试
                </button>
              </div>
            </div>
          )}

          {!loading && !error && catalog.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
              <div className="text-center">
                <Puzzle size={48} className="mx-auto mb-3 text-slate-600" />
                <p className="text-sm text-slate-500">没有安装任何插件</p>
                <p className="mt-1 text-xs text-slate-600">将插件放入 plugins/ 目录后自动识别</p>
              </div>
            </div>
          )}

          {catalog.length > 0 && (
            <div className="flex flex-1 flex-col gap-4 overflow-hidden sm:flex-row">
              {/* 左侧：插件列表 */}
              <div className="max-h-[40vh] w-full shrink-0 space-y-3 overflow-y-auto sm:max-h-none sm:w-72 sm:pr-2">
                {catalog.map((plugin) => {
                  const enabled = enabledMap[plugin.id] ?? false
                  const ready = sandboxReady[plugin.id]
                  return (
                    <div
                      key={plugin.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        enabled
                          ? 'border-slate-600/50 bg-slate-800/50'
                          : 'border-slate-700/30 bg-slate-900/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium text-slate-200">{plugin.name}</h3>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                              v{plugin.version}
                            </span>
                            {sandboxCodes[plugin.id] && !ready && (
                              <Loader2 size={12} className="animate-spin text-amber-400" />
                            )}
                            {!sandboxCodes[plugin.id] && (
                              <span className="text-[10px] text-slate-600">⏳ 代码未加载</span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{plugin.description}</p>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
                            <span>作者: {plugin.author}</span>
                            {plugin.commands?.length > 0 && (
                              <span>{plugin.commands.length} 个命令</span>
                            )}
                          </div>
                          {plugin.commands && plugin.commands.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {plugin.commands.map((cmd) => (
                                <button
                                  key={cmd.id}
                                  onClick={() => {
                                    if (enabled) {
                                      pluginSandboxManager.executeCommand(plugin.id, cmd.id)
                                      window.dispatchEvent(
                                        new CustomEvent('wrench-notification', {
                                          detail: {
                                            message: `已执行: ${plugin.name} → ${cmd.label || cmd.id}`,
                                            type: 'success',
                                            duration: 3000,
                                          },
                                        }),
                                      )
                                    }
                                  }}
                                  disabled={!enabled}
                                  title={cmd.description || cmd.label || cmd.id}
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                                    enabled
                                      ? 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                                      : 'cursor-not-allowed bg-slate-800/30 text-slate-600'
                                  }`}
                                >
                                  {enabled && <Play size={10} className="shrink-0" />}
                                  {cmd.label || cmd.id}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleToggle(plugin.id, enabled)}
                          disabled={!ready}
                          className={`ml-4 flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                            enabled
                              ? 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400'
                              : 'border-slate-700 text-slate-600 hover:border-slate-600 hover:text-slate-400'
                          } ${!ready ? 'cursor-not-allowed opacity-50' : ''}`}
                          title={enabled ? '禁用' : '启用'}
                        >
                          {enabled ? <Check size={14} /> : <X size={14} />}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* 右侧：沙箱区域 */}
              <div
                data-sandbox-area
                className="flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-700/30 bg-slate-900/30"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-slate-700/30 px-4 py-2">
                  <h3 className="text-xs font-medium text-slate-400">沙箱运行状态</h3>
                  <span className="text-[10px] text-slate-600">
                    {readyCount}/{codesCount} 就绪
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                  {codesCount === 0 ? (
                    <div className="flex items-center justify-center py-12 text-center">
                      <p className="text-xs text-slate-600">沙箱加载中，请稍候...</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                      {catalog
                        .filter((p) => sandboxCodes[p.id])
                        .map((plugin) => (
                          <div
                            key={plugin.id}
                            className="rounded-lg border border-slate-700/30 bg-slate-900/50"
                          >
                            <div className="flex items-center justify-between border-b border-slate-700/30 px-3 py-1.5">
                              <span className="text-xs font-medium text-slate-400">
                                {plugin.name}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] text-emerald-500/70">
                                <Shield size={10} />
                                {sandboxReady[plugin.id] ? '沙箱就绪' : '加载中'}
                              </span>
                            </div>
                            <div className="flex h-48 items-center justify-center sm:h-32">
                              {sandboxKeys[plugin.id] ? (
                                <PluginSandbox
                                  key={sandboxKeys[plugin.id] as number}
                                  manifest={{
                                    id: plugin.id,
                                    name: plugin.name,
                                    version: plugin.version,
                                    description: plugin.description,
                                    author: plugin.author,
                                    icon: plugin.icon,
                                    entry: plugin.entry,
                                  }}
                                  pluginCode={sandboxCodes[plugin.id] || ''}
                                  onReady={(handle) => handleSandboxReady(plugin.id, handle)}
                                  onError={(err) =>
                                    console.error(`[Plugins] ${plugin.name} error:`, err)
                                  }
                                />
                              ) : (
                                <span className="text-[10px] text-slate-600">
                                  点击左侧命令按钮执行
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'market' && (
        <div className="flex-1 overflow-hidden">
          <PluginMarket />
        </div>
      )}
    </div>
  )
}
