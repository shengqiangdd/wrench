import { useSyncExternalStore } from 'react'
import { useAppStore } from '../../stores/app-store'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import MainContent from './MainContent'
import RightPanel from './RightPanel'

/** 订阅 navigator.onLine 变化 */
function getOnlineSnapshot() {
  return navigator.onLine
}

export default function Layout() {
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)
  const isOnline = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    getOnlineSnapshot,
    () => true, // SSR fallback
  )

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 dark:bg-slate-950">
      {/* 离线提示条 */}
      {!isOnline && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-600/20 px-3 py-1 text-xs text-amber-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
          网络已断开 — 部分功能不可用（SSH连接、文件传输、插件市场）
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* 桌面端侧边栏 */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* 主内容区域 */}
        <MainContent />

        {/* 右侧面板 */}
        {rightPanelOpen && <RightPanel />}
      </div>

      {/* 移动端底部导航 */}
      <BottomNav />
    </div>
  )
}
