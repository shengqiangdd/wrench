import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { QuickCommand } from './index'
import { COMMAND_GROUPS } from './index'

interface CommandFormModalProps {
  editCmd?: QuickCommand | null
  onSave: (data: { name: string; command: string; description?: string; groupId: string }) => void
  onClose: () => void
}

export default function CommandFormModal({ editCmd, onSave, onClose }: CommandFormModalProps) {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [description, setDescription] = useState('')
  const [groupId, setGroupId] = useState('custom')

  useEffect(() => {
    if (editCmd) {
      setName(editCmd.name)
      setCommand(editCmd.command)
      setDescription(editCmd.description || '')
      setGroupId(editCmd.groupId)
    }
  }, [editCmd])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !command.trim()) return
    onSave({
      name: name.trim(),
      command: command.trim(),
      description: description.trim() || undefined,
      groupId,
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700/50 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-slate-700/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-200">
            {editCmd ? '编辑命令' : '新建自定义命令'}
          </h2>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：查看 Nginx 状态"
              className="focus:border-smartbox-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 transition-colors outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">命令 *</label>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="例如：systemctl status nginx"
              rows={3}
              className="focus:border-smartbox-500/50 w-full resize-none rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 transition-colors outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">
              描述（可选）
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单说明这个命令的用途"
              className="focus:border-smartbox-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 transition-colors outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">分组</label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="focus:border-smartbox-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 text-xs text-slate-200 transition-colors outline-none"
            >
              {COMMAND_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.icon || ''} {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* 提交按钮 */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !command.trim()}
              className="bg-smartbox-600/30 text-smartbox-400 hover:bg-smartbox-600/40 rounded-md px-4 py-2 text-xs font-medium transition-colors disabled:opacity-40"
            >
              {editCmd ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
