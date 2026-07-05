import { useState, useEffect, useCallback } from 'react'
import {
  Download,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Globe,
  ExternalLink,
  Search,
  ChevronDown,
  X,
  Puzzle,
} from 'lucide-react'
import { usePluginStore } from '../../stores/plugin-store'

// ─── 类型定义 ───

interface MarketPlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  tags?: string[]
  manifestUrl: string
  pluginUrl: string
  updatedAt?: string
  downloads?: number
}

interface MarketIndex {
  plugins: MarketPlugin[]
  updatedAt?: string
  message?: string
}

// 默认市场源（可被 env 覆盖）
const MARKET_API = '/api/market/index'

// ─── 状态定义 ───

type InstallStatus = 'idle' | 'installing' | 'success' | 'error'

interface InstallState {
  status: InstallStatus
  message?: string
}

// ─── 工具函数 ───

function getDifficultyColor(tag?: string): string {
  switch (tag?.toLowerCase()) {
    case 'easy':
    case '入门':
      return 'text-emerald-400 bg-emerald-500/10'
    case 'medium':
    case '中级':
      return 'text-amber-400 bg-amber-500/10'
    case 'hard':
    case '高级':
      return 'text-red-400 bg-red-500/10'
    default:
      return 'text-slate-500 bg-slate-800'
  }
}

// ─── 主组件 ───

export default function PluginMarket() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // 已安装的插件 ID 集合
  const installedPlugins = usePluginStore((s) => s.plugins)
  const installedIds = new Set(installedPlugins.map((p) => p.manifest.id))

  // 加载市场列表
  const fetchMarket = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch(MARKET_API)
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
      }
      const data: MarketIndex = await resp.json()
      setPlugins(data.plugins || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load market plugins'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => fetchMarket(), 0)
    return () => clearTimeout(t)
  }, [fetchMarket])

  // 安装插件
  const handleInstall = async (plugin: MarketPlugin) => {
    setInstallStates((prev) => ({
      ...prev,
      [plugin.id]: { status: 'installing', message: '正在下载...' },
    }))

    try {
      const resp = await fetch('/api/plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pluginId: plugin.id,
          manifestUrl: plugin.manifestUrl,
          pluginUrl: plugin.pluginUrl,
        }),
      })

      const result = await resp.json()

      if (resp.ok) {
        setInstallStates((prev) => ({
          ...prev,
          [plugin.id]: { status: 'success', message: '安装成功，请刷新插件列表' },
        }))
      } else {
        setInstallStates((prev) => ({
          ...prev,
          [plugin.id]: { status: 'error', message: result.error || '安装失败' },
        }))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '网络错误'
      setInstallStates((prev) => ({
        ...prev,
        [plugin.id]: { status: 'error', message: msg },
      }))
    }
  }

  // 卸载插件
  const handleUninstall = async (pluginId: string) => {
    if (!confirm(`确定卸载插件 "${pluginId}" ？\n已安装的插件目录将被删除。`)) return

    setInstallStates((prev) => ({
      ...prev,
      [pluginId]: { status: 'installing', message: '正在卸载...' },
    }))

    try {
      const resp = await fetch('/api/plugins/uninstall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId }),
      })

      if (resp.ok) {
        setInstallStates((prev) => ({
          ...prev,
          [pluginId]: { status: 'success', message: '已卸载' },
        }))
      } else {
        const result = await resp.json()
        setInstallStates((prev) => ({
          ...prev,
          [pluginId]: { status: 'error', message: result.error || '卸载失败' },
        }))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '网络错误'
      setInstallStates((prev) => ({
        ...prev,
        [pluginId]: { status: 'error', message: msg },
      }))
    }
  }

  // 过滤
  const filteredPlugins = plugins.filter((p) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.name.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.tags?.some((t) => t.toLowerCase().includes(q))
    )
  })

  return (
    <div className="flex h-full flex-col">
      {/* 市场标题栏 */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-sky-400" />
          <h3 className="text-sm font-medium text-slate-300">插件市场</h3>
          {plugins.length > 0 && (
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400">
              {plugins.length} 个可用
            </span>
          )}
        </div>
        <button
          onClick={fetchMarket}
          disabled={loading}
          className="btn-ghost flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          <Loader2 size={12} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 搜索栏 */}
      <div className="relative mb-3">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-600"
        />
        <input
          className="w-full rounded-lg border border-slate-700/50 bg-slate-800/50 py-2 pr-3 pl-9 text-xs text-slate-300 placeholder-slate-600 transition-colors outline-none focus:border-sky-500/50 focus:bg-slate-800"
          placeholder="搜索插件名称、标签、作者..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-600 hover:text-slate-400"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 加载中 */}
      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Loader2 size={24} className="mx-auto mb-2 animate-spin text-slate-500" />
            <p className="text-xs text-slate-500">正在加载市场列表...</p>
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {!loading && error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <AlertCircle size={32} className="mx-auto mb-2 text-red-400" />
            <p className="text-xs text-red-400">{error}</p>
            <button
              onClick={fetchMarket}
              className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700"
            >
              重试
            </button>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {!loading && !error && filteredPlugins.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Search size={32} className="mx-auto mb-2 text-slate-600" />
            <p className="text-xs text-slate-500">
              {search ? '没有匹配的插件' : '市场暂无可用插件'}
            </p>
          </div>
        </div>
      )}

      {/* 插件列表 */}
      {!loading && !error && filteredPlugins.length > 0 && (
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredPlugins.map((plugin) => {
            const installed = installedIds.has(plugin.id)
            const installState = installStates[plugin.id]
            const isExpanded = expandedId === plugin.id

            return (
              <div
                key={plugin.id}
                className={`rounded-lg border transition-all ${
                  installed
                    ? 'border-emerald-700/30 bg-emerald-900/10'
                    : 'border-slate-700/30 bg-slate-900/40 hover:border-slate-600/50'
                }`}
              >
                {/* 主行 */}
                <div className="flex items-start gap-3 p-3">
                  {/* 图标占位 */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                    <Puzzle size={16} className="text-slate-400" />
                  </div>

                  {/* 信息 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-slate-200">{plugin.name}</h4>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
                        v{plugin.version}
                      </span>
                      {installed && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                          已安装
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {plugin.description}
                    </p>

                    {/* 标签行 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-slate-600">作者: {plugin.author}</span>
                      {plugin.tags?.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded px-1.5 py-0.5 text-[9px] ${getDifficultyColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                      {plugin.downloads !== undefined && (
                        <span className="text-[10px] text-slate-600">↓ {plugin.downloads}</span>
                      )}
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1">
                    {/* 展开详情 */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : plugin.id)}
                      className="btn btn-ghost rounded-lg p-1.5 text-slate-600 hover:text-slate-400"
                    >
                      <ChevronDown
                        size={14}
                        className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {/* 安装/卸载 */}
                    {installed ? (
                      <button
                        onClick={() => handleUninstall(plugin.id)}
                        disabled={installState?.status === 'installing'}
                        className="btn btn-ghost rounded-lg p-1.5 text-red-500/60 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                        title="卸载"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstall(plugin)}
                        disabled={installState?.status === 'installing'}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                          installState?.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-sky-500/10 text-sky-400 hover:bg-sky-500/20'
                        } disabled:opacity-40`}
                      >
                        {installState?.status === 'installing' ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : installState?.status === 'success' ? (
                          <CheckCircle2 size={12} />
                        ) : (
                          <Download size={12} />
                        )}
                        {installState?.message || '安装'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 展开详情 */}
                {isExpanded && plugin.manifestUrl && (
                  <div className="border-t border-slate-700/30 px-3 py-2">
                    <div className="flex items-center gap-3 text-[11px] text-slate-600">
                      <span>
                        ID: <code className="text-slate-500">{plugin.id}</code>
                      </span>
                      {plugin.updatedAt && (
                        <span>更新: {new Date(plugin.updatedAt).toLocaleDateString('zh-CN')}</span>
                      )}
                      <a
                        href={plugin.manifestUrl.replace('/manifest.json', '')}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto flex items-center gap-1 text-sky-500/60 hover:text-sky-400"
                      >
                        <ExternalLink size={10} />
                        源码
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 底部提示 */}
      {!loading && !error && plugins.length > 0 && (
        <div className="mt-2 text-center text-[10px] text-slate-700">
          插件运行在 iframe 沙箱中，安全隔离
        </div>
      )}
    </div>
  )
}
