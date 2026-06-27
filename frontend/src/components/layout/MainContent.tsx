import { lazy, Suspense } from 'react'
import { useAppStore } from '../../stores/app-store'

const SshPlaceholder = lazy(() => import('../../modules/ssh/SshPlaceholder'))
const CommandsPage = lazy(() => import('../../modules/commands/CommandsPage'))
const DockerPage = lazy(() => import('../../modules/docker/DockerPage'))
const FileManager = lazy(() => import('../../modules/file-manager/FileManager'))
const MonitorPage = lazy(() => import('../../modules/monitor/MonitorPage'))
const LogsPage = lazy(() => import('../../modules/logs/LogsPage'))
const PluginsPage = lazy(() => import('../../modules/plugins/PluginsPage'))
const SettingsPanel = lazy(() => import('../../modules/settings/SettingsPanel'))

const NAVS = ['ssh', 'commands', 'docker', 'monitor', 'files', 'logs', 'plugins', 'settings'] as const

const PAGES: Record<string, React.ReactNode> = {
  ssh: <SshPlaceholder />,
  commands: <CommandsPage />,
  docker: <DockerPage />,
  monitor: <MonitorPage />,
  files: <FileManager />,
  logs: <LogsPage />,
  plugins: <PluginsPage />,
  settings: <SettingsPanel />,
}

function Loading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
    </div>
  )
}

export default function MainContent() {
  const activeNav = useAppStore((s) => s.activeNav)

  return (
    <main className="flex flex-1 flex-col overflow-hidden min-h-0 pointer-events-none">
      {NAVS.map((nav) => (
        <div
          key={nav}
          className="flex h-full w-full flex-1 flex-col overflow-hidden pointer-events-auto"
          style={{ display: nav === activeNav ? 'flex' : 'none' }}
        >
          <Suspense fallback={<Loading />}>
            {PAGES[nav] || null}
          </Suspense>
        </div>
      ))}
    </main>
  )
}
