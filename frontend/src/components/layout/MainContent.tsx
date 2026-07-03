import { lazy, Suspense, useEffect } from 'react'
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

export default function MainContent() {
  const activeNav = useAppStore((s) => s.activeNav)

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

  const PageComponent = PAGES[activeNav]

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense fallback={<Loading />}>{PageComponent ? <PageComponent /> : null}</Suspense>
    </main>
  )
}
