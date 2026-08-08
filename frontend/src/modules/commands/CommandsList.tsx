import { useState } from 'react'
import {
  Play,
  Clipboard,
  Loader2,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Search,
  Layers,
} from 'lucide-react'
import type { QuickCommand, CommandGroup } from './index'

interface CommandsListProps {
  commandsByGroup: (CommandGroup & { commands: QuickCommand[] })[]
  executingId: string | null
  connectionId: string | null
  onExecute: (cmd: QuickCommand) => void
  onCopyToClipboard: (cmd: string) => void
  onAdd: () => void
  onEdit: (cmd: QuickCommand) => void
  onRemove: (id: string) => void
  onSendToTerminal?: (cmd: string) => void
  onSendToBatch?: (cmd: string) => void
}

export default function CommandsList({
  commandsByGroup,
  executingId,
  connectionId,
  onExecute,
  onCopyToClipboard,
  onAdd,
  onEdit,
  onRemove,
  onSendToTerminal,
  onSendToBatch,
}: CommandsListProps) {
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    commandsByGroup.forEach((g) => {
      map[g.id] = true
    })
    return map
  })
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  // 筛选
  const filtered = commandsByGroup
    .map((g) => ({
      ...g,
      commands: !search
        ? g.commands
        : g.commands.filter(
            (c) =>
              c.name.toLowerCase().includes(search.toLowerCase()) ||
              c.command.toLowerCase().includes(search.toLowerCase()) ||
              c.description?.toLowerCase().includes(search.toLowerCase()),
          ),
    }))
    .filter((g) => g.commands.length > 0)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 搜索和添加 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/30 px-4 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="搜索命令..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus:border-wrench-500/50 min-h-[44px] w-full rounded-md border border-slate-700/50 bg-slate-800/50 py-1.5 pr-3 pl-8 text-xs text-slate-300 placeholder-slate-500 transition-colors outline-none"
          />
        </div>
        <button
          onClick={onAdd}
          className="bg-wrench-600/20 text-wrench-400 hover:bg-wrench-600/30 flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-colors"
          title="新建自定义命令"
        >
          <Plus size={14} />
          新建
        </button>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {filtered.length === 0 ? (
          <div className="mt-16 flex flex-col items-center gap-2 text-slate-500">
            <p className="text-sm">没有找到匹配的命令</p>
            <button
              onClick={onAdd}
              className="text-wrench-500 hover:text-wrench-400 text-xs transition-colors"
            >
              + 新建自定义命令
            </button>
          </div>
        ) : (
          filtered.map((group) => (
            <div key={group.id} className="mb-3">
              {/* 分组标题 */}
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex min-h-[44px] w-full items-center gap-1.5 rounded-md px-2 text-xs text-slate-500 transition-colors hover:bg-slate-800/50"
              >
                <span className="text-xs">{expandedGroups[group.id] ? '▾' : '▸'}</span>
                <span>{group.icon || '📁'}</span>
                <span className="font-medium">{group.name}</span>
                <span className="ml-auto text-[10px] text-slate-600">{group.commands.length}</span>
              </button>

              {/* 命令卡片 */}
              {expandedGroups[group.id] && (
                <div className="mt-1 ml-1 space-y-1">
                  {group.commands.map((cmd) => (
                    <div
                      key={cmd.id}
                      className="group relative rounded-md border border-slate-700/20 bg-slate-800/30 px-3 py-2 transition-colors hover:border-slate-700/50 hover:bg-slate-800/60"
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-200">{cmd.name}</span>
                            {cmd.isBuiltin && (
                              <span className="rounded bg-slate-800 px-1 py-0.5 text-[9px] text-slate-500">
                                内置
                              </span>
                            )}
                          </div>
                          <code className="mt-0.5 block w-full truncate font-mono text-[11px] text-slate-500">
                            {cmd.command}
                          </code>
                          {cmd.description && (
                            <p className="mt-0.5 text-[10px] text-slate-600">{cmd.description}</p>
                          )}
                        </div>

                        {/* 操作按钮：移动端始终显示，桌面端 hover 显示 */}
                        <div className="ml-2 flex shrink-0 items-center gap-0.5 opacity-100 md:opacity-70 md:group-hover:opacity-100">
                          <button
                            onClick={() => onExecute(cmd)}
                            disabled={executingId === cmd.id || !connectionId}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-emerald-600/20 hover:text-emerald-400 disabled:opacity-30"
                            title={connectionId ? '执行命令' : '请先连接 SSH'}
                          >
                            {executingId === cmd.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Play size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => onCopyToClipboard(cmd.command)}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-sky-600/20 hover:text-sky-400"
                            title="复制命令"
                          >
                            <Clipboard size={14} />
                          </button>
                          <button
                            onClick={() => onSendToTerminal?.(cmd.command)}
                            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-violet-600/20 hover:text-violet-400"
                            title="发送到终端"
                          >
                            <span className="text-[10px] font-bold">T</span>
                          </button>
                          {onSendToBatch && (
                            <button
                              onClick={() => onSendToBatch?.(cmd.command)}
                              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-amber-600/20 hover:text-amber-400"
                              title="发送到批量执行"
                            >
                              <Layers size={14} />
                            </button>
                          )}

                          {!cmd.isBuiltin && (
                            <div className="relative">
                              <button
                                onClick={() => setMenuOpen(menuOpen === cmd.id ? null : cmd.id)}
                                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                              {menuOpen === cmd.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setMenuOpen(null)}
                                  />
                                  <div className="absolute top-full right-0 z-20 mt-1 w-28 overflow-hidden rounded-md border border-slate-700/50 bg-slate-800 shadow-lg">
                                    <button
                                      onClick={() => {
                                        onEdit(cmd)
                                        setMenuOpen(null)
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-300 transition-colors hover:bg-slate-700/50"
                                    >
                                      <Pencil size={12} /> 编辑
                                    </button>
                                    <button
                                      onClick={() => {
                                        onRemove(cmd.id)
                                        setMenuOpen(null)
                                      }}
                                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-900/20"
                                    >
                                      <Trash2 size={12} /> 删除
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
