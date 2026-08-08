import { useState } from 'react'
import { X } from 'lucide-react'
import type { QuickCommand, CommandVariable } from './index'
import { resolveCommandTemplate, extractVariables } from './index'

interface VariableModalProps {
  cmd: QuickCommand
  onConfirm: (resolvedCommand: string) => void
  onCancel: () => void
}

export default function VariableModal({ cmd, onConfirm, onCancel }: VariableModalProps) {
  // 从 cmd 初始化变量默认值（组件每次 mount 时重新初始化）
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    if (cmd.variables) {
      cmd.variables.forEach((v) => {
        initial[v.name] = v.defaultValue || ''
      })
    } else {
      const vars = extractVariables(cmd.command)
      vars.forEach((v) => {
        initial[v] = ''
      })
    }
    return initial
  })
  const resolved = resolveCommandTemplate(cmd.command, values)

  const allFilled = Object.values(values).every((v) => v.trim() !== '')
  const hasVariables = Object.keys(values).length > 0

  const handleConfirm = () => {
    onConfirm(resolved)
  }

  if (!hasVariables) {
    // 没有变量，直接确认
    onConfirm(cmd.command)
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-[460px] rounded-lg border border-slate-700/50 bg-slate-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between border-b border-slate-700/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200">模板变量</h3>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
              {cmd.name}
            </span>
          </div>
          <button
            onClick={onCancel}
            className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>

        {/* 变量表单 */}
        <div className="space-y-3 p-4">
          <p className="text-[11px] text-slate-500">此命令包含变量占位符，请填写实际值：</p>

          {(
            cmd.variables ||
            Object.keys(values).map((k) => ({ name: k, label: k }) as CommandVariable)
          ).map((v) => (
            <div key={v.name}>
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                {v.label || v.name}
              </label>
              <input
                type="text"
                value={values[v.name] || ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                placeholder={v.placeholder || `输入 ${v.name}`}
                className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/50 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-600 transition-colors outline-none"
                autoFocus={!v.defaultValue}
              />
            </div>
          ))}

          {/* 预览 */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-400">执行预览</label>
            <pre className="max-h-20 overflow-auto rounded-md bg-slate-950 p-2 text-[11px] text-emerald-400">
              {resolved}
            </pre>
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-700/30 px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!allFilled}
            className="bg-wrench-600 hover:bg-wrench-500 rounded-md px-3 py-1.5 text-xs text-white transition-colors disabled:opacity-50"
          >
            执行
          </button>
        </div>
      </div>
    </div>
  )
}
