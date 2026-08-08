import { useState } from 'react'
import { X, Plus, Pencil, Trash2, Check } from 'lucide-react'
import type { CommandGroup } from './index'
import { BUILTIN_GROUPS } from './index'

interface GroupManageModalProps {
  allGroups: CommandGroup[]
  customGroups: CommandGroup[]
  onSaveGroup: (group: CommandGroup) => void
  onRemoveGroup: (id: string) => void
  onClose: () => void
}

export default function GroupManageModal({
  allGroups,
  customGroups: _customGroups,
  onSaveGroup,
  onRemoveGroup,
  onClose,
}: GroupManageModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('📁')
  const [showNewForm, setShowNewForm] = useState(false)

  const isBuiltin = (id: string) => BUILTIN_GROUPS.some((g) => g.id === id)

  const handleEdit = (group: CommandGroup) => {
    setEditingId(group.id)
    setName(group.name.replace(/^[^\s]+\s/, ''))
    setIcon(group.icon || '📁')
  }

  const handleSave = () => {
    if (!name.trim() || !editingId) return
    onSaveGroup({ id: editingId, name: `${icon} ${name.trim()}`, icon })
    setEditingId(null)
    setName('')
    setIcon('📁')
  }

  const handleCreate = () => {
    if (!name.trim()) return
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    onSaveGroup({ id, name: `${icon} ${name.trim()}`, icon })
    setShowNewForm(false)
    setName('')
    setIcon('📁')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-slate-700/50 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-slate-700/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">管理分组</h2>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-80 space-y-1 overflow-y-auto p-3">
          {allGroups.map((g) => (
            <div
              key={g.id}
              className="flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-slate-800/50"
            >
              {editingId === g.id ? (
                <>
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="w-8 rounded border border-slate-700/50 bg-slate-800 px-1 py-1 text-center text-xs outline-none"
                    maxLength={2}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="focus:border-wrench-500/50 flex-1 rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleSave}
                    className="min-h-[44px] min-w-[44px] rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-900/20"
                  >
                    <Check size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="w-6 text-center text-sm">{g.icon || '📁'}</span>
                  <span className="flex-1 text-xs text-slate-300">
                    {g.name.replace(/^[^\s]+\s/, '')}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {isBuiltin(g.id) ? '内置' : '自定义'}
                  </span>
                  {!isBuiltin(g.id) && (
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => handleEdit(g)}
                        className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={() => onRemoveGroup(g.id)}
                        className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-red-900/20 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* 新增分组 */}
        <div className="border-t border-slate-700/30 p-3">
          {showNewForm ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-8 rounded border border-slate-700/50 bg-slate-800 px-1 py-1.5 text-center text-xs outline-none"
                maxLength={2}
                placeholder="📁"
              />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入分组名称..."
                className="focus:border-wrench-500/50 flex-1 rounded border border-slate-700/50 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') setShowNewForm(false)
                }}
              />
              <button
                onClick={handleCreate}
                disabled={!name.trim()}
                className="bg-wrench-600/30 text-wrench-400 hover:bg-wrench-600/40 rounded-md px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
              >
                创建
              </button>
              <button
                onClick={() => setShowNewForm(false)}
                className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowNewForm(true)
                setName('')
                setIcon('📁')
                setEditingId(null)
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <Plus size={14} />
              新建分组
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
