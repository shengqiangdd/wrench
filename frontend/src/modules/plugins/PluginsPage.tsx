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
  const [activePlugin, setActivePlugin] = useState<string | null>(null)
  const _commandOutput = useState<string | null>(null)[0]

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
    setActivePlugin(null)
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

  const handleExecuteCommand = useCallback(
    (pluginId: string, commandId: string, _commandLabel: string) => {
      const enabled = enabledMap[pluginId]
      if (!enabled) return

      // 监听通知事件来捕获命令输出
      const handleNotification = (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (detail?.message) {
          setCommandOutput(detail.message)
        }
      }
      window.addEventListener('wrench-notification', handleNotification)

      pluginSandboxManager.executeCommand(pluginId, commandId)

      // 延迟移除监听
      setTimeout(() => {
        window.removeEventListener('wrench-notification', handleNotification)
      }, 5000)

      // 设置活跃插件
      setActivePlugin(pluginId)
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

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

  const activePluginData = useMemo(
    () => catalog.find((p) => p.id === activePlugin),
    [catalog, activePlugin],
  )

  return (
    <div className="flex h-full flex-col p-4 sm:p-6">
      {/* ── 隐藏的沙箱挂载点：所有插件沙箱始终在这里执行 ── */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {catalog
          .filter((p) => sandboxCodes[p.id] && sandboxKeys[p.id])
          .map((plugin) => (
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
              onError={(err) => console.error(`[Plugins] ${plugin.name} error:`, err)}
            />
          ))}
      </div>

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
                  const isActive = activePlugin === plugin.id
                  return (
                    <div
                      key={plugin.id}
                      className={`rounded-lg border p-4 transition-colors ${
                        isActive
                          ? 'border-blue-500/50 bg-blue-500/5'
                          : enabled
                            ? 'border-slate-600/50 bg-slate-800/50'
                            : 'border-slate-700/30 bg-slate-900/50'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setActivePlugin(isActive ? null : plugin.id)}
                              className="text-sm font-medium text-slate-200 transition-colors hover:text-blue-400"
                            >
                              {plugin.name}
                            </button>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                              v{plugin.version}
                            </span>
                            {sandboxCodes[plugin.id] && !ready && (
                              <Loader2 size={12} className="animate-spin text-amber-400" />
                            )}
                            {ready && (
                              <span className="text-[10px] text-emerald-500/70">✓ 就绪</span>
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
                            {plugin.panels?.length > 0 && (
                              <span>{plugin.panels.length} 个面板</span>
                            )}
                          </div>
                          {plugin.commands && plugin.commands.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {plugin.commands.map((cmd) => (
                                <button
                                  key={cmd.id}
                                  onClick={() =>
                                    handleExecuteCommand(plugin.id, cmd.id, cmd.label || cmd.id)
                                  }
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
                          className={`ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
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

              {/* 右侧：插件面板区域 */}
              <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-slate-700/30 bg-slate-900/30">
                {activePlugin && activePluginData ? (
                  <>
                    {/* 面板头部 */}
                    <div className="flex shrink-0 items-center justify-between border-b border-slate-700/30 px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-200">
                          {activePluginData.name}
                        </span>
                        {activePluginData.panels && activePluginData.panels.length > 0 && (
                          <span className="text-[10px] text-slate-500">
                            — {activePluginData.panels[0]?.title || activePluginData.panels[0]?.id}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-emerald-500/70">
                          <Shield size={10} className="mr-1 inline" />
                          沙箱隔离
                        </span>
                        <button
                          onClick={() => setActivePlugin(null)}
                          className="text-slate-500 hover:text-slate-300"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* 插件命令列表 */}
                    {activePluginData.commands && activePluginData.commands.length > 0 && (
                      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-slate-700/30 p-3">
                        {activePluginData.commands.map((cmd) => (
                          <button
                            key={cmd.id}
                            onClick={() =>
                              handleExecuteCommand(activePluginData.id, cmd.id, cmd.label || cmd.id)
                            }
                            disabled={!enabledMap[activePluginData.id]}
                            title={cmd.description || cmd.label || cmd.id}
                            className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${
                              enabledMap[activePluginData.id]
                                ? 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 hover:text-slate-100'
                                : 'cursor-not-allowed bg-slate-800/30 text-slate-600'
                            }`}
                          >
                            <Play size={11} className="shrink-0" />
                            {cmd.label || cmd.id}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 插件面板内容 */}
                    <div className="flex-1 overflow-y-auto p-3 sm:p-4">
                      {activePluginData.panels && activePluginData.panels.length > 0 ? (
                        <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
                          <div className="mb-3 flex items-center gap-2">
                            <Shield size={14} className="text-emerald-500/70" />
                            <h3 className="text-sm font-medium text-slate-300">
                              {activePluginData.panels[0]?.title || activePluginData.panels[0]?.id}
                            </h3>
                          </div>
                          <p className="text-xs text-slate-500">
                            插件面板将在编辑器中显示。请在文件管理器中打开文件后使用插件命令。
                          </p>
                          <div className="mt-3 space-y-1.5">
                            {(activePluginData.commands || []).map((cmd) => (
                              <div
                                key={cmd.id}
                                className="flex items-center justify-between rounded bg-slate-800/50 px-3 py-2"
                              >
                                <div>
                                  <span className="text-xs text-slate-300">
                                    {cmd.label || cmd.id}
                                  </span>
                                  {cmd.description && (
                                    <span className="ml-2 text-[10px] text-slate-600">
                                      {cmd.description}
                                    </span>
                                  )}
                                </div>
                                <button
                                  onClick={() =>
                                    handleExecuteCommand(
                                      activePluginData.id,
                                      cmd.id,
                                      cmd.label || cmd.id,
                                    )
                                  }
                                  disabled={!enabledMap[activePluginData.id]}
                                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                                    enabledMap[activePluginData.id]
                                      ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  执行
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center text-center">
                          <div>
                            <Puzzle size={32} className="mx-auto mb-2 text-slate-600" />
                            <p className="text-xs text-slate-500">此插件没有面板</p>
                            <p className="mt-1 text-[10px] text-slate-600">
                              使用左侧命令按钮执行插件功能
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  /* 未选中插件时的默认状态 */
                  <div className="flex flex-1 flex-col">
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
                        <div className="space-y-2">
                          {catalog
                            .filter((p) => sandboxCodes[p.id])
                            .map((plugin) => (
                              <div
                                key={plugin.id}
                                className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-900/50 px-3 py-2"
                              >
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setActivePlugin(plugin.id)}
                                    className="text-xs font-medium text-slate-400 transition-colors hover:text-blue-400"
                                  >
                                    {plugin.name}
                                  </button>
                                  {plugin.commands && plugin.commands.length > 0 && (
                                    <span className="text-[10px] text-slate-600">
                                      {plugin.commands.length} 命令
                                    </span>
                                  )}
                                </div>
                                <span className="flex items-center gap-1 text-[10px] text-emerald-500/70">
                                  <Shield size={10} />
                                  {sandboxReady[plugin.id] ? '就绪' : '加载中'}
                                </span>
                              </div>
                            ))}
                          <p className="pt-2 text-center text-[11px] text-slate-600">
                            点击插件名称查看详情，或点击命令按钮执行
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
