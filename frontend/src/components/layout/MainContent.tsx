import { useAppStore } from '../../stores/app-store'
import SshPlaceholder from '../../modules/ssh/SshPlaceholder'
import FileManagerPlaceholder from '../../modules/file-manager/FileManagerPlaceholder'
import PluginsPage from '../../modules/plugins/PluginsPage'
import SettingsPanel from '../../modules/settings/SettingsPanel'

export default function MainContent() {
  const activeNav = useAppStore((s) => s.activeNav)

  const sections: Record<string, React.ReactNode> = {
    ssh: <SshPlaceholder />,
    files: <FileManagerPlaceholder />,
    plugins: <PluginsPage />,
    settings: <SettingsPanel />,
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      {sections[activeNav] || <SshPlaceholder />}
    </main>
  )
}
