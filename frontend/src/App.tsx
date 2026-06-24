import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import CommandPalette from './components/CommandPalette'
import ShortcutHelpModal from './components/ShortcutHelpModal'
import Toast from './components/Toast'
import { useAppStore } from './stores/app-store'
import { initGlobalAPI } from './global-api'

// 初始化插件全局 API
initGlobalAPI()

function AppContent() {
  const theme = useAppStore((s) => s.theme)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)

  // 注册快捷键列表命令到命令面板
  useEffect(() => {
    import('./components/CommandPalette').then(({ registerCommand }) => {
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

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else if (theme === 'light') {
      root.classList.remove('dark')
    } else {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      root.classList.toggle('dark', mq.matches)
      const handler = (e: MediaQueryListEvent) => root.classList.toggle('dark', e.matches)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
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
    <Routes>
      <Route path="/*" element={<AppContent />} />
    </Routes>
  )
}
