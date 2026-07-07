import { lazy, Suspense, useEffect, useState } from 'react'
import { useAppStore } from '../../stores/app-store'

const SshPlaceholder = lazy(() => import('../../modules/ssh/SshPlaceholder'))
const CommandsPage = lazy(() => import('../../modules/commands/CommandsPage'))
const DockerPage = lazy(() => import('../../modules/docker/DockerPage'))
const FileManager = lazy(() => import('../../modules/file-manager/FileManager'))
const MonitorPage = lazy(() => import('../../modules/monitor/MonitorPage'))
const LogsPage = lazy(() => import('../../modules/logs/LogsPage'))
const PluginsPage = lazy(() => import('../../modules/plugins/PluginsPage'))
const SettingsPanel = lazy(() => import('../../modules/settings/SettingsPanel'))
const VaultPage = lazy(() => import('../../modules/vault/VaultPage'))
const NotificationsPage = lazy(() => import('../../modules/notifications/NotificationsPage'))
const AuditLogPage = lazy(() => import('../../modules/audit/AuditLogPage'))

const PAGES: Record<string, React.LazyExoticComponent<React.ComponentType<unknown>>> = {
  ssh: SshPlaceholder,
  commands: CommandsPage,
  docker: DockerPage,
  monitor: MonitorPage,
  files: FileManager,
  logs: LogsPage,
  plugins: PluginsPage,
  settings: SettingsPanel,
  vault: VaultPage,
  notifications: NotificationsPage,
  audit: AuditLogPage,
}

/**
 * Import factories keyed by nav id for manual preloading.
 * Keeping these separate avoids double-wrapping lazy() components.
 */
const PAGE_IMPORTS: Record<string, () => Promise<unknown>> = {
  ssh: () => import('../../modules/ssh/SshPlaceholder'),
  commands: () => import('../../modules/commands/CommandsPage'),
  docker: () => import('../../modules/docker/DockerPage'),
  monitor: () => import('../../modules/monitor/MonitorPage'),
  files: () => import('../../modules/file-manager/FileManager'),
  logs: () => import('../../modules/logs/LogsPage'),
  plugins: () => import('../../modules/plugins/PluginsPage'),
  settings: () => import('../../modules/settings/SettingsPanel'),
  vault: () => import('../../modules/vault/VaultPage'),
  notifications: () => import('../../modules/notifications/NotificationsPage'),
  audit: () => import('../../modules/audit/AuditLogPage'),
}

/** Adjacent nav pages to preload after the active page finishes loading,
 *  so side-by-side navigation feels instant. */
const NAV_ORDER = [
  'ssh',
  'commands',
  'docker',
  'monitor',
  'files',
  'logs',
  'plugins',
  'vault',
  'notifications',
  'audit',
  'settings',
]

function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
    </div>
  )
}

/** 需要保持活跃的页面（切换标签后不卸载，保持终端连接等状态） */
const KEEP_ALIVE_PAGES = new Set(['ssh'])

export default function MainContent() {
  const activeNav = useAppStore((s) => s.activeNav)
  // 记录已访问过的页面，用于 keep-alive
  const [visitedPages, setVisitedPages] = useState<Set<string>>(new Set([activeNav]))

  // 当切换页面时，如果是 keep-alive 页面，添加到已访问集合
  useEffect(() => {
    if (KEEP_ALIVE_PAGES.has(activeNav)) {
      setVisitedPages((prev) => new Set([...prev, activeNav]))
    }
  }, [activeNav])

  // Preload adjacent pages after mount for instant navigation
  useEffect(() => {
    const idx = NAV_ORDER.indexOf(activeNav)
    if (idx === -1) return

    const toPreload: string[] = []
    if (idx > 0) {
      const prev = NAV_ORDER[idx - 1]
      if (prev) toPreload.push(prev)
    }
    if (idx < NAV_ORDER.length - 1) {
      const next = NAV_ORDER[idx + 1]
      if (next) toPreload.push(next)
    }

    for (const id of toPreload) {
      const loader = PAGE_IMPORTS[id]
      if (!loader) continue
      // Schedule preload at idle time (requestIdleCallback or setTimeout fallback)
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => {
          loader().catch(() => {})
        })
      } else {
        setTimeout(() => {
          loader().catch(() => {})
        }, 200)
      }
    }
  }, [activeNav])

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 渲染所有 keep-alive 页面，使用 display 控制可见性 */}
      {Array.from(visitedPages).map((pageId) => {
        const PageComponent = PAGES[pageId]
        if (!PageComponent) return null
        const isActive = pageId === activeNav
        const isKeepAlive = KEEP_ALIVE_PAGES.has(pageId)

        // 非 keep-alive 页面只在活跃时渲染
        if (!isKeepAlive && !isActive) return null

        return (
          <div
            key={pageId}
            className="flex h-full flex-1 flex-col overflow-hidden"
            style={{
              display: isActive ? 'flex' : 'none',
            }}
          >
            <Suspense fallback={<Loading />}>
              <PageComponent />
            </Suspense>
          </div>
        )
      })}
      {/* 当前活跃页面如果不是 keep-alive 且未访问过，直接渲染 */}
      {!visitedPages.has(activeNav) && PAGES[activeNav] && (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <Suspense fallback={<Loading />}>
            {(() => {
              const PageComponent = PAGES[activeNav]
              return PageComponent ? <PageComponent /> : null
            })()}
          </Suspense>
        </div>
      )}
    </main>
  )
}
