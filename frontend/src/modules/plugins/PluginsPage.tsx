import { useState, useEffect } from 'react'
import { Puzzle, Check, X, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { fetchPlugins, loadPluginScript, unloadPlugin } from '../../services/pluginManager'
import { usePluginStore } from '../../stores/plugin-store'
import type { PluginCatalogItem } from '../../services/pluginManager'

export default function PluginsPage() {
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({})

  const storePlugins = usePluginStore((s) => s.plugins)
  const enablePlugin = usePluginStore((s) => s.enablePlugin)
  const disablePlugin = usePluginStore((s) => s.disablePlugin)

  const loadPlugins = async () => {
    setLoading(true)
    setError(null)
    try {
      const plugins = await fetchPlugins()
      setCatalog(plugins)

      // 自动加载所有插件
      for (const plugin of plugins) {
        setLoadState((s) => ({ ...s, [plugin.id]: 'loading' }))
        try {
          const result = await loadPluginScript(plugin)
          setLoadState((s) => ({
            ...s,
            [plugin.id]: result.success ? 'loaded' : 'error',
          }))
        } catch {
          setLoadState((s) => ({ ...s, [plugin.id]: 'error' }))
        }
      }
    } catch (err: any) {
      setError(err.message || '加载插件失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPlugins()
  }, [])

  const isPluginEnabled = (pluginId: string) => {
    return storePlugins.some((p) => p.manifest.id === pluginId && p.enabled)
  }

  const handleToggle = (pluginId: string, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      disablePlugin(pluginId)
    } else {
      enablePlugin(pluginId)
    }
  }

  const handleReload = () => {
    // 先卸载所有已加载的
    for (const plugin of catalog) {
      unloadPlugin(plugin.id)
    }
    loadPlugins()
  }

  const getCommandCount = (plugin: PluginCatalogItem) => plugin.commands?.length || 0

  return (
    <div className="flex h-full flex-col p-6">
      {/* 标题栏 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle size={20} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-slate-200">插件</h2>
          {catalog.length > 0 && (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
              {catalog.length} 个
            </span>
          )}
        </div>
        <button
          onClick={handleReload}
          disabled={loading}
          className="btn-secondary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 加载中 */}
      {loading && catalog.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 size={32} className="mx-auto mb-3 animate-spin text-slate-500" />
            <p className="text-sm text-slate-500">正在加载插件...</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
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

      {/* 空状态 */}
      {!loading && !error && catalog.length === 0 && (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
          <div className="text-center">
            <Puzzle size={48} className="mx-auto mb-3 text-slate-600" />
            <p className="text-sm text-slate-500">没有安装任何插件</p>
            <p className="mt-1 text-xs text-slate-600">将插件放入 plugins/ 目录后自动识别</p>
          </div>
        </div>
      )}

      {/* 插件列表 */}
      {catalog.length > 0 && (
        <div className="grid gap-3 overflow-auto">
          {catalog.map((plugin) => {
            const state = loadState[plugin.id]
            const enabled = isPluginEnabled(plugin.id)

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
                  {/* 插件信息 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-slate-200">{plugin.name}</h3>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                        v{plugin.version}
                      </span>
                      {state === 'loading' && (
                        <Loader2 size={12} className="animate-spin text-amber-400" />
                      )}
                      {state === 'error' && (
                        <span className="flex items-center gap-1 text-[11px] text-red-400">
                          <AlertCircle size={11} /> 加载失败
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{plugin.description}</p>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-600">
                      <span>作者: {plugin.author}</span>
                      {getCommandCount(plugin) > 0 && (
                        <span>{getCommandCount(plugin)} 个命令</span>
                      )}
                      {plugin.panels?.length > 0 && (
                        <span>{plugin.panels.length} 个面板</span>
                      )}
                    </div>

                    {/* 命令列表 */}
                    {plugin.commands && plugin.commands.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {plugin.commands.map((cmd) => (
                          <span
                            key={cmd.id}
                            className="rounded bg-slate-800/50 px-2 py-0.5 text-[10px] text-slate-400"
                          >
                            {cmd.label || cmd.id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 启用/禁用开关 */}
                  <button
                    onClick={() => handleToggle(plugin.id, enabled)}
                    disabled={state !== 'loaded'}
                    className={`ml-4 flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
                      enabled
                        ? 'border-emerald-600/50 bg-emerald-500/10 text-emerald-400'
                        : 'border-slate-700 text-slate-600 hover:border-slate-600 hover:text-slate-400'
                    } ${state !== 'loaded' ? 'cursor-not-allowed opacity-50' : ''}`}
                    title={enabled ? '禁用' : '启用'}
                  >
                    {enabled ? <Check size={14} /> : <X size={14} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
