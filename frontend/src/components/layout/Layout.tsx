import { useState, useCallback } from 'react'
import { useSyncExternalStore } from 'react'
import { useAppStore } from '../../stores/app-store'
import Sidebar from './Sidebar'
import BottomNav from './BottomNav'
import MainContent from './MainContent'
import RightPanel from './RightPanel'
import AgentDrawer from '../agent/AgentDrawer'
import AgentPanel from '../agent/AgentPanel'
import HostPickerModal from '../agent/HostPickerModal'
import { useSshStore } from '../../stores/ssh-store'
import { ensureSshConnection } from '../../services/ssh-ensure'
import { authedFetch } from '../../services/auth'
import { notify } from '../../services/event-bus'

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

  // ── AI 命令执行：主机选择弹窗状态 ──
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)

  /** 选中主机后执行命令 */
  const handleHostSelected = useCallback(async (connectionId: string, cmd: string) => {
    setPendingCommand(null)
    try {
      const res = await authedFetch('/api/ssh/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, command: cmd }),
      })
      const data = await res.json()
      if (data.success) {
        const output = data.data?.output || '(无输出)'
        notify(`命令已执行：${output.slice(0, 120)}`, 'success')
      } else {
        notify(`执行失败：${data.error || data.msg || '未知错误'}`, 'error')
      }
    } catch (err) {
      notify(`执行异常：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [])

  /** 直接用第一个已连接的主机执行（快捷方式），未连接则自动连接 */
  const handleQuickExecute = useCallback(
    async (cmd: string) => {
      const sshState = useSshStore.getState()
      const sessions = sshState.sessions
      const active = sessions.find((s) => s.status === 'connected')

      // 1. 已有活跃连接 → 直接执行
      if (active?.connectionId) {
        await handleHostSelected(active.connectionId, cmd)
        return
      }

      // 2. 尝试自动连接：从保存的连接 / API / 测试配置中选第一个
      const conn = sshState.connections[0]
      if (conn) {
        try {
          notify('正在自动连接 SSH...', 'info')
          const cid = await ensureSshConnection({
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            privateKey: conn.privateKey,
          })
          await handleHostSelected(cid, cmd)
          return
        } catch (err) {
          // 自动连接失败，弹出选择器
          console.warn('[Layout] Auto-connect failed:', err)
        }
      }

      // 3. 没有可用连接 → 弹出选择器
      setPendingCommand(cmd)
    },
    [handleHostSelected],
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

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* 桌面端侧边栏 */}
        <div className="hidden lg:flex">
          <Sidebar />
        </div>

        {/* 主内容区域 */}
        <MainContent />

        {/* 右侧面板 */}
        {rightPanelOpen && <RightPanel />}

        {/* 全局 AI Agent 抽屉 */}
        <AgentDrawer onExecuteCommand={handleQuickExecute}>
          <AgentPanel />
        </AgentDrawer>
      </div>

      {/* 主机选择弹窗 */}
      {pendingCommand && (
        <HostPickerModal
          command={pendingCommand}
          onClose={() => setPendingCommand(null)}
          onExecute={(connId, conn) => {
            // 如果主机有凭据且未连接，先自动连接再执行
            if (conn?.password || conn?.privateKey) {
              ensureSshConnection({
                host: conn.host,
                port: conn.port,
                username: conn.username,
                password: conn.password,
                privateKey: conn.privateKey,
              })
                .then((cid) => handleHostSelected(cid, pendingCommand))
                .catch(() => handleHostSelected(connId, pendingCommand))
            } else {
              handleHostSelected(connId, pendingCommand)
            }
          }}
        />
      )}

      {/* 移动端底部导航 */}
      <BottomNav />
    </div>
  )
}
