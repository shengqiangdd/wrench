import { useState } from 'react'
import {
  Plus,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  FolderOpen,
  Terminal,
  Search,
  Zap,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Play,
  Upload,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import ConnectionForm from './ConnectionForm'
import BatchExecPanel from './BatchExecPanel'
import BatchFilePanel from './BatchFilePanel'
import type { SshConnection } from '../../types/ssh'

interface Props {
  onConnect?: (connectionId: string) => void
}

export default function ConnectionList({ onConnect }: Props) {
  const connections = useSshStore((s) => s.connections)
  const deleteConnection = useSshStore((s) => s.deleteConnection)
  const selectConnection = useSshStore((s) => s.selectConnection)
  const sessions = useSshStore((s) => s.sessions)

  const [showForm, setShowForm] = useState(false)
  const [showBatch, setShowBatch] = useState(false)
  const [showFileBatch, setShowFileBatch] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const QUICK_PREFIX = 'quick_'

  // 按分组归类（过滤掉快速连接，它在快速连接栏里展示）
  const grouped = connections.reduce<
    Record<string, { label: string; items: SshConnection[] }>
  >((acc, conn) => {
    if (conn.id.startsWith(QUICK_PREFIX)) return acc
    const key = conn.group || '_ungrouped'
    if (!acc[key]) {
      acc[key] = {
        label: conn.group || '未分组',
        items: [],
      }
    }
    acc[key].items.push(conn)
    return acc
  }, {})

  const filtered = (items: SshConnection[]) =>
    filter
      ? items.filter(
          (c) =>
            c.name.toLowerCase().includes(filter.toLowerCase()) ||
            c.host.toLowerCase().includes(filter.toLowerCase()),
        )
      : items

  const isActive = (connId: string) =>
    sessions.some((s) => s.connectionId === connId && s.status === 'connected')

  const handleConnect = (connId: string) => {
    if (onConnect) {
      onConnect(connId)
    } else {
      selectConnection(connId)
    }
  }

  const [quickOpen, setQuickOpen] = useState(false)
  const [quickHost, setQuickHost] = useState('')
  const [quickPort, setQuickPort] = useState('22')
  const [quickUser, setQuickUser] = useState('root')
  const [quickPassword, setQuickPassword] = useState('')
  const [quickShowPwd, setQuickShowPwd] = useState(false)

  const doQuickConnect = () => {
    if (!quickHost.trim() || !quickUser.trim()) return
    const tempId = `${QUICK_PREFIX}${Date.now()}`
    // 先清理旧的快速连接
    const store = useSshStore.getState()
    for (const c of store.connections) {
      if (c.id.startsWith(QUICK_PREFIX)) {
        store.deleteConnection(c.id)
      }
    }
    // 添加临时连接
    store.addConnection({
      id: tempId,
      name: `⚡ ${quickUser.trim()}@${quickHost.trim()}`,
      host: quickHost.trim(),
      port: parseInt(quickPort) || 22,
      username: quickUser.trim(),
      authType: quickPassword ? 'password' : 'none',
      password: quickPassword || undefined,
      createdAt: Date.now(),
    })
    selectConnection(tempId)
    if (onConnect) onConnect(tempId)
    // 重置密码并折叠
    setQuickPassword('')
    setQuickOpen(false)
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* 工具栏 */}
      <div className="mb-2 flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            className="input w-full pl-7 pr-2 py-1.5 text-xs"
            placeholder="搜索..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
          />
        </div>
        <button
          onClick={() => setShowFileBatch(true)}
          className="btn btn-ghost shrink-0 px-2 hidden sm:inline-flex"
          title="批量文件分发"
        >
          <Upload size={14} />
        </button>
        <button
          onClick={() => setShowBatch(true)}
          className="btn btn-ghost shrink-0 px-2 hidden sm:inline-flex"
          title="批量执行命令"
        >
          <Play size={14} />
        </button>
        <button
          onClick={() => {
            setEditId(null)
            setShowForm(true)
          }}
          className="btn btn-primary shrink-0 px-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
          title="新建连接"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* 快速连接 */}
      <div className="mb-3 rounded-lg border border-amber-600/20 bg-amber-500/5">
        <button
          onClick={() => setQuickOpen(!quickOpen)}
          className="flex w-full items-center gap-2 px-3 py-2 text-xs text-amber-400/80 hover:text-amber-300"
        >
          {quickOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Zap size={14} />
          <span className="font-medium">快速连接</span>
          <span className="text-[10px] text-slate-600">不保存凭据，一次性的临时连接</span>
        </button>

        {quickOpen && (
          <div className="border-t border-amber-600/15 px-3 pb-3 pt-2">
            <div className="mb-2 flex gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="主机地址"
                value={quickHost}
                onChange={(e) => setQuickHost(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doQuickConnect()}
              />
              <input
                className="input w-16 text-xs text-center"
                placeholder="端口"
                value={quickPort}
                onChange={(e) => setQuickPort(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doQuickConnect()}
              />
            </div>
            <div className="mb-2 flex gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="用户名"
                value={quickUser}
                onChange={(e) => setQuickUser(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doQuickConnect()}
              />
              <div className="relative flex-1">
                <input
                  className="input w-full pr-8 text-xs"
                  type={quickShowPwd ? 'text' : 'password'}
                  placeholder="密码（可选）"
                  value={quickPassword}
                  onChange={(e) => setQuickPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doQuickConnect()}
                />
                <button
                  onClick={() => setQuickShowPwd(!quickShowPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {quickShowPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <button
              onClick={doQuickConnect}
              disabled={!quickHost.trim() || !quickUser.trim()}
              className="btn-primary flex w-full items-center justify-center gap-1.5 py-1.5 text-xs disabled:opacity-50"
            >
              <Zap size={14} />
              快速连接 {quickUser.trim() && quickHost.trim() ? `${quickUser.trim()}@${quickHost.trim()}` : ''}
            </button>
          </div>
        )}
      </div>

      {/* 连接列表 */}
      <div className="flex-1 space-y-4 overflow-auto">
        {Object.entries(grouped).length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Plug size={36} className="mb-2 text-slate-600" />
            <p className="text-sm text-slate-500">暂无 SSH 连接</p>
            <p className="mt-1 text-xs text-slate-600">点击「新建」添加第一个连接</p>
          </div>
        ) : (
          Object.entries(grouped).map(([key, group]) => {
            const items = filtered(group.items)
            if (items.length === 0) return null

            return (
              <div key={key}>
                {Object.keys(grouped).length > 1 && (
                  <div className="mb-1.5 flex items-center gap-1.5 px-1">
                    <FolderOpen size={12} className="shrink-0 text-slate-500" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      {group.label}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      ({items.length})
                    </span>
                  </div>
                )}
                <div className="space-y-1">
                  {items.map((conn) => (
                    <div
                      key={conn.id}
                      className="group flex items-center gap-2 rounded-lg border border-slate-700/30 p-2.5 transition-colors hover:border-slate-700 hover:bg-slate-800/50"
                    >
                      {/* 状态指示器 */}
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                          isActive(conn.id)
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {isActive(conn.id) ? (
                          <PlugZap size={14} />
                        ) : (
                          <Terminal size={14} />
                        )}
                      </span>

                      {/* 连接信息 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-200">
                            {conn.name}
                          </span>
                          <span
                            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                              isActive(conn.id) ? 'bg-emerald-500' : 'bg-slate-600'
                            }`}
                          />
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {conn.username}@{conn.host}:{conn.port}
                        </div>
                      </div>

                      {/* 操作按钮：移动端始终显示，桌面端 hover 显示 */}
                      <div className="flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleConnect(conn.id)}
                          className="btn-icon text-emerald-500 hover:bg-emerald-500/10"
                          title="连接"
                        >
                          <PlugZap size={14} />
                        </button>
                        <button
                          onClick={() => {
                            setEditId(conn.id)
                            setShowForm(true)
                          }}
                          className="btn-icon text-slate-500 hover:text-slate-300"
                          title="编辑"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteConnection(conn.id)}
                          className="btn-icon text-red-400 hover:bg-red-500/10"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 连接表单弹窗 */}
      {showForm && (
        <ConnectionForm
          editId={editId}
          onClose={() => {
            setShowForm(false)
            setEditId(null)
          }}
        />
      )}

      {/* 批量文件分发弹窗 */}
      {showFileBatch && <BatchFilePanel onClose={() => setShowFileBatch(false)} />}

      {/* 批量执行弹窗 */}
      {showBatch && <BatchExecPanel onClose={() => setShowBatch(false)} />}
    </div>
  )
}
