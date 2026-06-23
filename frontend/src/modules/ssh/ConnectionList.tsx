import { useState } from 'react'
import {
  Plus,
  Plug,
  PlugZap,
  Pencil,
  Trash2,
  FolderOpen,
  Terminal,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import ConnectionForm from './ConnectionForm'
import type { SshConnection } from '../../types/ssh'

export default function ConnectionList() {
  const connections = useSshStore((s) => s.connections)
  const deleteConnection = useSshStore((s) => s.deleteConnection)
  const selectConnection = useSshStore((s) => s.selectConnection)
  const sessions = useSshStore((s) => s.sessions)

  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  // 按分组归类
  const grouped = connections.reduce<
    Record<string, { label: string; items: SshConnection[] }>
  >((acc, conn) => {
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

  return (
    <div className="flex h-full flex-col p-4">
      {/* 工具栏 */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <input
            className="input pl-8 text-xs"
            placeholder="搜索连接..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <button
          onClick={() => {
            setEditId(null)
            setShowForm(true)
          }}
          className="btn-primary"
        >
          <Plus size={14} />
          新建
        </button>
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
                    <FolderOpen size={12} className="text-slate-500" />
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
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              isActive(conn.id) ? 'bg-emerald-500' : 'bg-slate-600'
                            }`}
                          />
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {conn.username}@{conn.host}:{conn.port}
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="hidden gap-0.5 group-hover:flex">
                        <button
                          onClick={() => selectConnection(conn.id)}
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
    </div>
  )
}
