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
  Search,
  ChevronRight,
  Zap,
  Box,
  Command,
  PanelRightClose,
  ArrowLeft,
  Copy,
  Terminal,
  CheckCircle,
} from 'lucide-react'
import Skeleton from '../../components/Skeleton'
import { fetchPlugins, fetchPluginCode, unloadPlugin } from '../../services/pluginManager'
import { usePluginStore } from '../../stores/plugin-store'
import { getWsClientSync } from '../../services/websocket'
import PluginSandbox from '../../components/PluginSandbox'
import { pluginSandboxManager } from '../../services/pluginSandboxManager'
import { on as onEvent } from '../../services/event-bus'
import type { PluginCatalogItem } from '../../services/pluginManager'
import type { PluginSandboxHandle } from '../../components/PluginSandbox'
import type { PluginManifest } from '../../types/plugin'
import PluginMarket from './PluginMarket'

type TabId = 'installed' | 'market'
type MobileView = 'list' | 'detail' | 'panel'

// ── 最大并行沙箱数（LRU 驱逐） ──
const MAX_SANDBOXES = 8

// ── 已加载插件代码的全局缓存（跨渲染持久） ──
const pluginCodeCache = new Map<string, string>()

// ── 沙箱实例生命周期追踪 ──
interface SandboxSlot {
  pluginId: string
  code: string
  manifest: PluginManifest
  key: number
}

function CommandResultPanel({
  commandLabel,
  commandDescription,
  content,
  onCopy,
}: {
  pluginName: string
  commandLabel: string
  commandDescription?: string
  content: string
  onCopy: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-slate-700/30 px-5 py-3">
        <div className="mb-1 flex items-center gap-2">
          <Terminal size={14} className="text-blue-400" />
          <span className="text-sm font-medium text-slate-200">{commandLabel}</span>
        </div>
        {commandDescription && (
          <p className="mt-0.5 text-[11px] text-slate-500">{commandDescription}</p>
        )}
      </div>
      <div className="flex-1 overflow-auto p-5">
        {content ? (
          <div className="group relative">
            <pre className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-slate-300">
              {content}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-slate-700/80 px-2 py-1 text-[10px] text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-600/80"
            >
              {copied ? (
                <>
                  <Check size={10} /> 已复制
                </>
              ) : (
                <>
                  <Copy size={10} /> 复制
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-600">
            <CheckCircle size={32} className="mb-2 text-emerald-500/50" />
            <p className="text-sm">命令已执行</p>
            <p className="mt-1 text-[11px]">结果已写入编辑器</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PluginsPage() {
  const [tab, setTab] = useState<TabId>('installed')
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // 沙箱槽位列表（LRU，最多 MAX_SANDBOXES 个并行沙箱）
  const [sandboxSlots, setSandboxSlots] = useState<SandboxSlot[]>([])
  // 当前激活插件及其沙箱就绪状态
  const [activePlugin, setActivePlugin] = useState<string | null>(null)
  const [sandboxReady, setSandboxReady] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState('')
  // 移动端面板视图状态
  const [mobileView, setMobileView] = useState<MobileView>('list')
  const [mobilePanelTitle, setMobilePanelTitle] = useState('')
  // 命令激活高亮
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [activePanel, setActivePanel] = useState<string | null>(null)
  // 命令执行结果缓存（不再遮盖面板，而是显示在面板区域上方）
  const [commandResult, setCommandResult] = useState<{
    pluginId: string
    commandId: string
    label: string
    description: string
    content: string
  } | null>(null)

  const storePlugins = usePluginStore((s) => s.plugins)
  const enablePlugin = usePluginStore((s) => s.enablePlugin)
  const disablePlugin = usePluginStore((s) => s.disablePlugin)

  const loadingRef = useRef(false)
  const catalogRef = useRef<PluginCatalogItem[]>([])
  const panelContainerRef = useRef<HTMLDivElement>(null)
  const mobilePanelRef = useRef<HTMLDivElement>(null)
  const sandboxSlotsRef = useRef<Map<string, SandboxSlot>>(new Map())
  const activePanelRef = useRef<string | null>(null)
  const activePluginRef = useRef<string | null>(null)

  // 保持 refs 同步
  useEffect(() => {
    activePanelRef.current = activePanel
  })
  useEffect(() => {
    activePluginRef.current = activePlugin
  })

  const enabledMap = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const p of storePlugins) {
      if (p.enabled) map[p.manifest.id] = true
    }
    return map
  }, [storePlugins])

  const enabledMapRef = useRef(enabledMap)
  useEffect(() => {
    enabledMapRef.current = enabledMap
  })

  // ── 沙箱槽位 LRU 管理 ──
  const ensureSandboxSlot = useCallback(async (pluginId: string) => {
    // 已有槽位，移到最新
    const existing = sandboxSlotsRef.current.get(pluginId)
    if (existing) {
      setSandboxSlots((prev) => {
        const filtered = prev.filter((s) => s.pluginId !== pluginId)
        return [...filtered, existing]
      })
      return existing
    }

    // 需要新建槽位 — 先检查是否有缓存代码
    const plugin = catalogRef.current.find((p) => p.id === pluginId)
    if (!plugin) return null

    let code = pluginCodeCache.get(pluginId)
    if (!code) {
      try {
        code = await fetchPluginCode(plugin.entry)
        pluginCodeCache.set(pluginId, code)
      } catch (err) {
        console.error(`[PluginsPage] Failed to load plugin ${pluginId}:`, err)
        return null
      }
    }

    const manifest: PluginManifest = {
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
    }

    const newSlot: SandboxSlot = { pluginId, code, manifest, key: Date.now() }
    sandboxSlotsRef.current.set(pluginId, newSlot)

    setSandboxSlots((prev) => {
      let updated = [...prev, newSlot]
      // LRU 驱逐：超过上限移除最早的
      while (updated.length > MAX_SANDBOXES) {
        const evicted = updated[0]
        if (evicted) {
          sandboxSlotsRef.current.delete(evicted.pluginId)
          pluginSandboxManager.unregister(evicted.pluginId)
          pluginCodeCache.delete(evicted.pluginId)
        }
        updated = updated.slice(1)
      }
      return updated
    })

    return newSlot
  }, [])

  // ── 沙箱就绪回调 ──
  const handleSandboxReady = useCallback((pluginId: string, handle: PluginSandboxHandle) => {
    const plugin = catalogRef.current.find((p) => p.id === pluginId)
    if (!plugin) return

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

    // 如果是当前激活的插件，标记就绪
    if (pluginId === activePluginRef.current) {
      setSandboxReady(true)
    }

    // 读取通过 wrench API 动态注册的面板
    const panels = handle.getRegisteredPanels()
    if (panels.size > 0) {
      setCatalog((prev) =>
        prev.map((p) => {
          if (p.id !== pluginId) return p
          const dynamicPanels = Array.from(panels.values()).map((rp) => ({
            id: rp.id,
            title: rp.title,
            icon: rp.icon || '',
          }))
          const existingIds = new Set(p.panels.map((pp) => pp.id))
          const newPanels = dynamicPanels.filter((dp) => !existingIds.has(dp.id))
          if (newPanels.length === 0) return p
          return { ...p, panels: [...p.panels, ...newPanels] }
        }),
      )
    }
  }, [])

  // ── 渲染面板到目标容器 ──
  const renderPanelTo = useCallback((pluginId: string, container: HTMLElement): boolean => {
    const handle = pluginSandboxManager.getHandle(pluginId)
    if (!handle) return false
    const panels = handle.getRegisteredPanels()
    if (panels.size === 0) return false
    // 优先使用 activePanel 指定的面板，否则渲染第一个
    const panelId = activePanelRef.current
    const panel = (panelId && panels.get(panelId)) || panels.values().next().value
    if (!panel) return false
    return handle.renderPanelTo(panel.id, container)
  }, [])

  // ── 当 activePlugin 或 activePanel 变化时，渲染面板到桌面端右侧抽屉 ──
  useEffect(() => {
    if (!activePlugin || mobileView === 'detail') return
    requestAnimationFrame(() => {
      const container = panelContainerRef.current
      if (container) {
        renderPanelTo(activePlugin, container)
      }
    })
  }, [activePlugin, activePanel, sandboxReady, catalog, mobileView, renderPanelTo])

  // ── 移动端面板视图渲染 ──
  useEffect(() => {
    if (mobileView !== 'panel' || !activePlugin) return
    requestAnimationFrame(() => {
      const container = mobilePanelRef.current
      if (container) {
        renderPanelTo(activePlugin, container)
      }
    })
  }, [mobileView, activePlugin, activePanel, sandboxReady, catalog, renderPanelTo])

  // ── 监听插件 openPanel 事件 ──
  useEffect(() => {
    const unsub = onEvent('wrench-open-panel', ({ pluginId: pid, panelId }) => {
      setActivePlugin(pid)
      setActivePanel(panelId)
      setActiveCommand(null)
      setCommandResult(null)
    })
    return unsub
  }, [])

  // ── 命令执行（桌面端） ──
  const handleExecuteCommand = useCallback(
    async (pluginId: string, commandId: string, _commandLabel: string) => {
      // 如果插件未启用，先自动启用
      if (!enabledMapRef.current[pluginId]) {
        enablePlugin(pluginId)
      }

      setActivePlugin(pluginId)
      setActiveCommand(commandId)
      setActivePanel(null)
      setCommandResult(null)

      // 确保沙箱存在
      const slot = await ensureSandboxSlot(pluginId)
      if (!slot) return

      pluginSandboxManager.setCurrentCommandId(commandId)
      pluginSandboxManager.executeCommand(pluginId, commandId)

      // 检查是否有注册面板 — 有则渲染面板，无则显示结果
      const handle = pluginSandboxManager.getHandle(pluginId)
      if (handle) {
        const panels = handle.getRegisteredPanels()
        if (panels.size > 0) {
          setSandboxReady(true)
          // 面板将由 activePlugin 变化触发的 useEffect 渲染
          return
        }
      }

      // 无面板：捕获命令结果
      requestAnimationFrame(() => {
        const result = pluginSandboxManager.getLastEditorWrite(pluginId)
        const plugin = catalogRef.current.find((p) => p.id === pluginId)
        const cmd = plugin?.commands?.find((c) => c.id === commandId)
        setCommandResult({
          pluginId,
          commandId,
          label: cmd?.label || commandId,
          description: cmd?.description || '',
          content:
            result && result.commandId === commandId
              ? result.content
              : `✅ ${cmd?.label || commandId} 已执行`,
        })
      })
    },
    [ensureSandboxSlot, enablePlugin],
  )

  // ── 命令执行（移动端） ──
  const handleMobileExecuteCommand = useCallback(
    async (pluginId: string, commandId: string, _commandLabel: string) => {
      // 如果插件未启用，先自动启用
      if (!enabledMapRef.current[pluginId]) {
        enablePlugin(pluginId)
      }

      setActiveCommand(commandId)
      setActivePanel(null)
      setCommandResult(null)

      const slot = await ensureSandboxSlot(pluginId)
      if (!slot) return

      pluginSandboxManager.setCurrentCommandId(commandId)
      pluginSandboxManager.executeCommand(pluginId, commandId)

      // 如果插件有面板，打开面板全屏视图
      const handle = pluginSandboxManager.getHandle(pluginId)
      if (handle) {
        const panels = handle.getRegisteredPanels()
        if (panels.size > 0) {
          const firstPanel = panels.values().next().value
          if (firstPanel) {
            setMobileView('panel')
            setMobilePanelTitle(firstPanel.title)
            setActivePlugin(pluginId)
            setActivePanel(firstPanel.id)
            return
          }
        }
      }

      // 无面板：捕获结果
      requestAnimationFrame(() => {
        const result = pluginSandboxManager.getLastEditorWrite(pluginId)
        const plugin = catalogRef.current.find((p) => p.id === pluginId)
        const cmd = plugin?.commands?.find((c) => c.id === commandId)
        setCommandResult({
          pluginId,
          commandId,
          label: cmd?.label || commandId,
          description: cmd?.description || '',
          content:
            result && result.commandId === commandId
              ? result.content
              : `✅ ${cmd?.label || commandId} 已执行`,
        })
      })
    },
    [ensureSandboxSlot, enablePlugin],
  )

  // ── 点击插件卡片（桌面端） → 激活并预加载沙箱 ──
  const handlePluginActivate = useCallback(
    async (pluginId: string) => {
      if (activePlugin === pluginId) {
        setActivePlugin(null)
        setActivePanel(null)
        setSandboxReady(false)
        return
      }
      setActivePlugin(pluginId)
      setActivePanel(null)
      setActiveCommand(null)
      setCommandResult(null)
      setSandboxReady(false)
      await ensureSandboxSlot(pluginId)
      // sandboxReady 将在 handleSandboxReady 中设置
    },
    [activePlugin, ensureSandboxSlot],
  )

  // ── 点击插件卡片（移动端） → 进入详情视图 ──
  const handleMobilePluginClick = useCallback(
    async (pluginId: string) => {
      setActivePlugin(pluginId)
      setMobileView('detail')
      await ensureSandboxSlot(pluginId)
    },
    [ensureSandboxSlot],
  )

  // ── 移动端打开面板 ──
  const handleMobileOpenPanel = useCallback(
    (pluginId: string, panelTitle: string, panelId: string) => {
      setMobileView('panel')
      setMobilePanelTitle(panelTitle)
      setActivePlugin(pluginId)
      setActivePanel(panelId)
      setActiveCommand(null)
      setCommandResult(null)
    },
    [],
  )

  // ── 切换插件启用/禁用 ──
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

  // ── 加载插件列表 ──
  const loadPlugins = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const plugins = await fetchPlugins()
      setCatalog(plugins)
      catalogRef.current = plugins

      const store = usePluginStore.getState()
      for (const plugin of plugins) {
        const existing = store.getPlugin(plugin.id)
        if (!existing) {
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
        } else if (!existing.enabled) {
          store.enablePlugin(plugin.id)
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

  // ── 重新加载 ──
  const handleReload = useCallback(() => {
    loadingRef.current = false
    for (const plugin of catalogRef.current) {
      unloadPlugin(plugin.id)
    }
    pluginCodeCache.clear()
    sandboxSlotsRef.current.clear()
    setSandboxSlots([])
    setSandboxReady(false)
    setCatalog([])
    setActivePlugin(null)
    setMobileView('list')
    loadPlugins()
  }, [loadPlugins])

  // ── 初始化 + WS 监听 ──
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

  // ── 过滤和元数据 ──
  const filteredCatalog = useMemo(() => {
    if (!searchQuery.trim()) return catalog
    const q = searchQuery.toLowerCase()
    return catalog.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.author.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    )
  }, [catalog, searchQuery])

  const activePluginData = useMemo(
    () => catalog.find((p) => p.id === activePlugin),
    [catalog, activePlugin],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── 隐藏的沙箱挂载点（所有已加载的沙箱并行运行） ── */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
        {sandboxSlots.map((slot) => (
          <PluginSandbox
            key={slot.key}
            manifest={slot.manifest}
            pluginCode={slot.code}
            onReady={(handle) => handleSandboxReady(slot.pluginId, handle)}
            onError={(err) => console.error(`[Plugins] ${slot.pluginId} error:`, err)}
          />
        ))}
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* ── 头部 ── */}
      {/* ══════════════════════════════════════════ */}
      <div className="shrink-0 border-b border-slate-700/30 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {mobileView !== 'list' && (
              <button
                onClick={() => {
                  setMobileView('list')
                  setActivePlugin(null)
                  setActivePanel(null)
                }}
                className="flex items-center gap-1 rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 lg:hidden"
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <Puzzle size={20} className="text-blue-400" />
              <h2 className="text-base font-semibold text-slate-200 sm:text-lg">
                {mobileView === 'panel'
                  ? mobilePanelTitle
                  : mobileView === 'detail'
                    ? activePluginData?.name || '插件'
                    : '插件'}
              </h2>
            </div>
            {mobileView === 'list' && (
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
            )}
          </div>
          {tab === 'installed' && mobileView === 'list' && (
            <div className="flex items-center gap-2">
              {catalog.length > 0 && (
                <span className="hidden items-center gap-1 text-[11px] text-emerald-500/70 sm:flex">
                  <Shield size={12} />
                  沙箱隔离 · {sandboxSlots.length} 活跃
                </span>
              )}
              <button
                onClick={handleReload}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700/50 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                刷新
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* ── 已安装 Tab ── */}
      {/* ══════════════════════════════════════════ */}
      {tab === 'installed' && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* ── 移动端：列表视图 ── */}
            {mobileView === 'list' && (
              <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
                {/* 搜索栏 */}
                {catalog.length > 0 && (
                  <div className="shrink-0 px-4 pt-3 sm:px-6">
                    <div className="relative">
                      <Search
                        size={15}
                        className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
                      />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="搜索插件..."
                        className="w-full rounded-lg border border-slate-700/50 bg-slate-900/50 py-2 pr-3 pl-9 text-xs text-slate-300 placeholder-slate-600 transition-colors outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {loading && catalog.length === 0 && (
                  <Skeleton type="card" rows={6} className="flex-1" />
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
                  <div className="m-4 flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
                    <div className="text-center">
                      <Puzzle size={48} className="mx-auto mb-3 text-slate-600" />
                      <p className="text-sm text-slate-500">没有安装任何插件</p>
                      <p className="mt-1 text-xs text-slate-600">
                        将插件放入 plugins/ 目录后自动识别
                      </p>
                      <button
                        onClick={() => setTab('market')}
                        className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-600/20 px-4 py-2 text-xs text-blue-400 transition-colors hover:bg-blue-600/30"
                      >
                        <Globe size={14} /> 浏览插件市场
                      </button>
                    </div>
                  </div>
                )}

                {!loading && !error && catalog.length > 0 && filteredCatalog.length === 0 && (
                  <div className="flex flex-1 items-center justify-center">
                    <div className="text-center">
                      <Search size={36} className="mx-auto mb-3 text-slate-600" />
                      <p className="text-sm text-slate-500">没有匹配的插件</p>
                      <p className="mt-1 text-xs text-slate-600">
                        尝试其他关键词，或
                        <button
                          onClick={() => setSearchQuery('')}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          清除搜索
                        </button>
                      </p>
                    </div>
                  </div>
                )}

                {/* ── 移动端：插件卡片网格 ── */}
                {filteredCatalog.length > 0 && (
                  <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:hidden">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {filteredCatalog.map((plugin) => {
                        const enabled = enabledMap[plugin.id] ?? false
                        const isActive = activePlugin === plugin.id
                        const isReady = isActive && sandboxReady
                        return (
                          <div
                            key={plugin.id}
                            onClick={() => handleMobilePluginClick(plugin.id)}
                            className={`group relative flex cursor-pointer flex-col rounded-xl border p-4 transition-all ${
                              isActive
                                ? 'border-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/5'
                                : enabled
                                  ? 'border-slate-600/50 bg-slate-800/50 hover:border-slate-500/50 hover:bg-slate-800/70'
                                  : 'border-slate-700/30 bg-slate-900/50 hover:border-slate-600/50 hover:bg-slate-800/30'
                            }`}
                          >
                            <div className="mb-3 flex items-start justify-between">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700/50 to-slate-800/50 text-slate-400">
                                <Puzzle size={20} />
                              </div>
                              <div className="flex items-center gap-1.5">
                                {isReady && enabled && (
                                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
                                    <Zap size={10} /> 运行中
                                  </span>
                                )}
                                {isActive && !sandboxReady && (
                                  <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-400">
                                    <Loader2 size={10} className="animate-spin" /> 加载中
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="mb-1 flex items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-slate-200">
                                {plugin.name}
                              </h3>
                              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                                v{plugin.version}
                              </span>
                            </div>
                            <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-slate-500">
                              {plugin.description}
                            </p>
                            <div className="mb-3 flex items-center gap-3 text-[11px] text-slate-600">
                              <span className="flex items-center gap-1">
                                <span className="h-1 w-1 rounded-full bg-slate-600" />{' '}
                                {plugin.author}
                              </span>
                              {plugin.commands?.length > 0 && (
                                <span className="flex items-center gap-1">
                                  <Command size={10} /> {plugin.commands.length} 命令
                                </span>
                              )}
                              {plugin.panels?.length > 0 && (
                                <span className="flex items-center gap-1">
                                  <Box size={10} /> {plugin.panels.length} 面板
                                </span>
                              )}
                            </div>
                            {/* 命令快捷按钮 */}
                            {plugin.commands && plugin.commands.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {plugin.commands.slice(0, 3).map((cmd) => {
                                  return (
                                    <button
                                      key={cmd.id}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleMobileExecuteCommand(
                                          plugin.id,
                                          cmd.id,
                                          cmd.label || cmd.id,
                                        )
                                      }}
                                      title={cmd.description || cmd.label || cmd.id}
                                      className={`inline-flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-slate-600/50 hover:text-slate-200`}
                                    >
                                      {enabled && <Play size={10} className="shrink-0" />}
                                      <span className="max-w-[80px] truncate">
                                        {cmd.label || cmd.id}
                                      </span>
                                    </button>
                                  )
                                })}
                                {plugin.commands.length > 3 && (
                                  <span className="flex items-center px-1.5 text-[10px] text-slate-600">
                                    +{plugin.commands.length - 3}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-auto flex items-center justify-between border-t border-slate-700/30 pt-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleToggle(plugin.id, enabled)
                                }}
                                disabled={!isReady && !sandboxReady}
                                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                                  enabled
                                    ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                                    : 'bg-slate-800/50 text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                                }`}
                              >
                                {enabled ? <Check size={12} /> : <X size={12} />}
                                {enabled ? '已启用' : '已禁用'}
                              </button>
                              <ChevronRight
                                size={14}
                                className={`text-slate-600 transition-transform group-hover:translate-x-0.5 ${isActive ? 'text-blue-400' : ''}`}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── 移动端：详情视图 ── */}
            {mobileView === 'detail' && activePluginData && (
              <div className="flex-1 overflow-y-auto lg:hidden">
                <div className="border-b border-slate-700/30 px-4 py-4 sm:px-6">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700/50 to-slate-800/50 text-slate-400">
                      <Puzzle size={24} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-200">
                        {activePluginData.name}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        v{activePluginData.version} · {activePluginData.author}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    {activePluginData.description}
                  </p>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() =>
                        handleToggle(activePluginData.id, enabledMap[activePluginData.id] ?? false)
                      }
                      disabled={!sandboxReady}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                        enabledMap[activePluginData.id]
                          ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                          : 'bg-slate-800/50 text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                      } ${!sandboxReady ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      {enabledMap[activePluginData.id] ? <Check size={14} /> : <X size={14} />}
                      {enabledMap[activePluginData.id] ? '已启用' : '已禁用'}
                    </button>
                  </div>
                </div>

                {/* 命令列表 */}
                {activePluginData.commands && activePluginData.commands.length > 0 && (
                  <div className="px-4 py-3 sm:px-6">
                    <h4 className="mb-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                      命令
                    </h4>
                    <div className="space-y-1.5">
                      {activePluginData.commands.map((cmd) => {
                        const isActiveCmd = activeCommand === cmd.id
                        return (
                          <button
                            key={cmd.id}
                            onClick={() =>
                              handleMobileExecuteCommand(
                                activePluginData.id,
                                cmd.id,
                                cmd.label || cmd.id,
                              )
                            }
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isActiveCmd
                                ? 'bg-wrench-500/20 text-wrench-300 ring-wrench-500/30 ring-1'
                                : enabledMap[activePluginData.id]
                                  ? 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-100'
                                  : 'cursor-not-allowed bg-slate-900/30 text-slate-600'
                            }`}
                          >
                            <Play size={14} className="shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium">{cmd.label || cmd.id}</div>
                              {cmd.description && (
                                <div className="truncate text-[11px] text-slate-500">
                                  {cmd.description}
                                </div>
                              )}
                            </div>
                            <ChevronRight size={14} className="shrink-0 text-slate-600" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 命令结果 */}
                {commandResult && commandResult.pluginId === activePluginData.id && (
                  <div className="mx-4 mb-3 sm:mx-6">
                    <CommandResultPanel
                      pluginName={activePluginData.name}
                      commandLabel={commandResult.label}
                      commandDescription={commandResult.description}
                      content={commandResult.content}
                      onCopy={() => navigator.clipboard.writeText(commandResult.content)}
                    />
                  </div>
                )}

                {/* 面板列表 */}
                {activePluginData.panels && activePluginData.panels.length > 0 && (
                  <div className="px-4 py-3 sm:px-6">
                    <h4 className="mb-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                      面板
                    </h4>
                    <div className="space-y-1.5">
                      {activePluginData.panels.map((panel) => {
                        const isActivePnl = activePanel === panel.id
                        return (
                          <button
                            key={panel.id}
                            onClick={() =>
                              handleMobileOpenPanel(
                                activePluginData.id,
                                panel.title || panel.id,
                                panel.id,
                              )
                            }
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isActivePnl
                                ? 'bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                                : enabledMap[activePluginData.id]
                                  ? 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:text-slate-100'
                                  : 'cursor-not-allowed bg-slate-900/30 text-slate-600'
                            }`}
                          >
                            <Box size={14} className="shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium">{panel.title || panel.id}</div>
                            </div>
                            <ChevronRight size={14} className="shrink-0 text-slate-600" />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 元信息 */}
                <div className="px-4 py-3 sm:px-6">
                  <h4 className="mb-2 text-[11px] font-medium tracking-wider text-slate-500 uppercase">
                    信息
                  </h4>
                  <div className="space-y-2 rounded-lg bg-slate-800/30 px-3 py-2.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">版本</span>
                      <span className="font-mono text-slate-300">v{activePluginData.version}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">作者</span>
                      <span className="text-slate-300">{activePluginData.author}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">ID</span>
                      <span className="font-mono text-slate-300">{activePluginData.id}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── 移动端：面板全屏视图 ── */}
            {mobileView === 'panel' && (
              <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
                <div
                  ref={mobilePanelRef}
                  className="flex-1 overflow-auto"
                  style={{ padding: '16px', fontFamily: 'system-ui, sans-serif', color: '#e2e8f0' }}
                />
              </div>
            )}

            {/* ── 桌面端：列表 + 右侧抽屉 ── */}
            {mobileView === 'list' && (
              <div className="hidden flex-1 overflow-hidden lg:flex">
                {/* 左侧插件列表 */}
                <div
                  className="flex flex-col overflow-hidden"
                  style={{
                    width: '380px',
                    minWidth: '320px',
                    borderRight: '1px solid rgba(51,65,85,0.3)',
                  }}
                >
                  {catalog.length > 0 && (
                    <div className="shrink-0 px-4 pt-3">
                      <div className="relative">
                        <Search
                          size={15}
                          className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500"
                        />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="搜索插件..."
                          className="w-full rounded-lg border border-slate-700/50 bg-slate-900/50 py-2 pr-3 pl-9 text-xs text-slate-300 placeholder-slate-600 transition-colors outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery('')}
                            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {loading && catalog.length === 0 && (
                    <Skeleton type="card" rows={6} className="flex-1" />
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
                    <div className="m-4 flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50">
                      <div className="text-center">
                        <Puzzle size={48} className="mx-auto mb-3 text-slate-600" />
                        <p className="text-sm text-slate-500">没有安装任何插件</p>
                        <p className="mt-1 text-xs text-slate-600">
                          将插件放入 plugins/ 目录后自动识别
                        </p>
                        <button
                          onClick={() => setTab('market')}
                          className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-600/20 px-4 py-2 text-xs text-blue-400 transition-colors hover:bg-blue-600/30"
                        >
                          <Globe size={14} /> 浏览插件市场
                        </button>
                      </div>
                    </div>
                  )}

                  {!loading && !error && catalog.length > 0 && filteredCatalog.length === 0 && (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="text-center">
                        <Search size={36} className="mx-auto mb-3 text-slate-600" />
                        <p className="text-sm text-slate-500">没有匹配的插件</p>
                      </div>
                    </div>
                  )}

                  {/* 插件列表 */}
                  {filteredCatalog.length > 0 && (
                    <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
                      {filteredCatalog.map((plugin) => {
                        const enabled = enabledMap[plugin.id] ?? false
                        const isActive = activePlugin === plugin.id
                        return (
                          <button
                            key={plugin.id}
                            onClick={() => handlePluginActivate(plugin.id)}
                            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                              isActive
                                ? 'bg-wrench-500/15 text-wrench-300'
                                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                            }`}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-500">
                              <Puzzle size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium">{plugin.name}</span>
                                <span className="shrink-0 rounded bg-slate-800 px-1 py-0.5 font-mono text-[9px] text-slate-500">
                                  v{plugin.version}
                                </span>
                              </div>
                              <div className="truncate text-[11px] text-slate-600">
                                {plugin.description}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {isActive && sandboxReady && enabled && (
                                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                              )}
                              <ChevronRight
                                size={14}
                                className={`text-slate-600 ${isActive ? 'text-wrench-400' : ''}`}
                              />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 右侧：详情面板 */}
                <div className="flex flex-1 flex-col overflow-hidden">
                  {activePluginData ? (
                    <>
                      {/* 插件信息头 + 命令按钮 */}
                      <div className="shrink-0 border-b border-slate-700/30 px-5 py-4">
                        <div className="mb-2 flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700/50 to-slate-800/50 text-slate-400">
                            <Puzzle size={20} />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-slate-200">
                              {activePluginData.name}
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              v{activePluginData.version} · {activePluginData.author}
                            </p>
                          </div>
                          <div className="ml-auto">
                            <button
                              onClick={() =>
                                handleToggle(
                                  activePluginData.id,
                                  enabledMap[activePluginData.id] ?? false,
                                )
                              }
                              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                                enabledMap[activePluginData.id]
                                  ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                                  : 'bg-slate-800/50 text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                              }`}
                            >
                              {enabledMap[activePluginData.id] ? (
                                <Check size={14} />
                              ) : (
                                <X size={14} />
                              )}
                              {enabledMap[activePluginData.id] ? '已启用' : '已禁用'}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs leading-relaxed text-slate-400">
                          {activePluginData.description}
                        </p>

                        {/* 命令列表 */}
                        {activePluginData.commands && activePluginData.commands.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {activePluginData.commands.map((cmd) => {
                              const isActiveCmd = activeCommand === cmd.id
                              return (
                                <button
                                  key={cmd.id}
                                  onClick={() =>
                                    handleExecuteCommand(
                                      activePluginData.id,
                                      cmd.id,
                                      cmd.label || cmd.id,
                                    )
                                  }
                                  title={cmd.description || cmd.label || cmd.id}
                                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                                    isActiveCmd
                                      ? 'bg-wrench-500/20 text-wrench-300 ring-wrench-500/30 ring-1'
                                      : enabledMap[activePluginData.id]
                                        ? 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50 hover:text-slate-200'
                                        : 'cursor-not-allowed bg-slate-800/30 text-slate-600'
                                  }`}
                                >
                                  <Play size={10} className="shrink-0" />
                                  <span className="max-w-[120px] truncate">
                                    {cmd.label || cmd.id}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* 右侧内容：命令结果（如果有）或 插件面板 */}
                      <div className="flex flex-1 flex-col overflow-hidden">
                        {commandResult && commandResult.pluginId === activePluginData.id && (
                          <div
                            className="shrink-0 border-b border-slate-700/30"
                            style={{ maxHeight: '40%' }}
                          >
                            <CommandResultPanel
                              pluginName={activePluginData.name}
                              commandLabel={commandResult.label}
                              commandDescription={commandResult.description}
                              content={commandResult.content}
                              onCopy={() => navigator.clipboard.writeText(commandResult.content)}
                            />
                          </div>
                        )}
                        <div ref={panelContainerRef} className="flex-1 overflow-auto" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-slate-600">
                      <div className="text-center">
                        <PanelRightClose size={40} className="mx-auto mb-3 text-slate-700" />
                        <p className="text-sm">选择一个插件查看详情</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* ── 市场 Tab ── */}
      {/* ══════════════════════════════════════════ */}
      {tab === 'market' && (
        <div className="flex-1 overflow-hidden">
          <PluginMarket />
        </div>
      )}
    </div>
  )
}
