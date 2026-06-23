import { useAppStore } from '../../stores/app-store'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import MainContent from './MainContent'
import RightPanel from './RightPanel'

export default function Layout() {
  const rightPanelOpen = useAppStore((s) => s.rightPanelOpen)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
      <div className="flex flex-1 overflow-hidden">
        {/* 桌面端侧边栏 */}
        <div className="hidden md:flex">
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
