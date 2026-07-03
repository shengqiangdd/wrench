import { useEffect, useState, useRef } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import Layout from './components/layout/Layout'
import CommandPalette, { registerCommand } from './components/CommandPalette'
import ShortcutHelpModal from './components/ShortcutHelpModal'
import Toast from './components/Toast'
import { useAppStore, refreshAppStore, type NavId } from './stores/app-store'
import { refreshAiStore } from './stores/ai-store'
import { refreshSshStore } from './stores/ssh-store'
import { refreshAlertStore } from './stores/alert-store'
import { refreshPluginStore } from './stores/plugin-store'
import { initGlobalAPI } from './global-api'

// 初始化插件全局 API
initGlobalAPI()

/** NavId → URL path 映射 */
const NAV_PATH: Record<NavId, string> = {
  ssh: '/ssh',
  commands: '/commands',
  docker: '/docker',
  monitor: '/monitor',
  files: '/files',
  logs: '/logs',
  plugins: '/plugins',
  settings: '/settings',
  vault: '/vault',
  notifications: '/notifications',
}

const PATH_TO_NAV = Object.fromEntries(
  Object.entries(NAV_PATH).map(([k, v]) => [v, k as NavId]),
)

function AppContent() {
  const theme = useAppStore((s) => s.theme)
  const activeNav = useAppStore((s) => s.activeNav)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const navigate = useNavigate()
  const location = useLocation()
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  // URL ↔ Nav 双向同步
  useEffect(() => {
    const navFromPath = PATH_TO_NAV[location.pathname]
    if (navFromPath && navFromPath !== activeNav) {
      setActiveNav(navFromPath)
    }
  }, [location.pathname])

  // activeNav → URL 推送（初始不推）
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current) {
      // 首次加载：如果当前 path 不是有效 nav，推到当前 nav
      initializedRef.current = true
      if (!PATH_TO_NAV[location.pathname]) {
        navigate(NAV_PATH[activeNav], { replace: true })
      }
      return
    }
    const expectedPath = NAV_PATH[activeNav]
    if (location.pathname !== expectedPath) {
      navigate(expectedPath, { replace: true })
    }
  }, [activeNav])

  // 注册快捷键列表命令到命令面板
  useEffect(() => {
    registerCommand({
      id: 'shortcut-help',
      label: '快捷键列表',
      description: '查看所有可用的快捷键和操作',
      keywords: ['shortcut', '快捷键', 'hotkey', 'help', '帮助', '键盘', 'key'],
      icon: 'Keyboard',
      category: '工具',
      action: () => {
        useAppStore.getState().setCommandPaletteOpen(false)
        setShortcutHelpOpen(true)
      },
    })
  }, [])

  // Shift+? 打开快捷键列表（当命令面板关闭时）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === '?') {
        const paletteOpen = useAppStore.getState().commandPaletteOpen
        if (!paletteOpen) {
          e.preventDefault()
          setShortcutHelpOpen((prev) => !prev)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // 监听导入配置事件，刷新所有 store
  useEffect(() => {
    const handler = () => {
      refreshAppStore()
      refreshAiStore()
      refreshSshStore()
      refreshAlertStore()
      refreshPluginStore()
    }
    window.addEventListener('smartbox-config-imported', handler)
    return () => window.removeEventListener('smartbox-config-imported', handler)
  }, [])

  // 主题同步
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      return
    }
    if (theme === 'light') {
      root.classList.remove('dark')
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    root.classList.toggle('dark', mq.matches)
    const handler = (e: MediaQueryListEvent) => root.classList.toggle('dark', e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  return (
    <>
      <CommandPalette />
      <ShortcutHelpModal open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
      <Layout />
      <Toast />
    </>
  )
}

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/*" element={<AppContent />} />
      </Routes>
    </AuthGate>
  )
}
