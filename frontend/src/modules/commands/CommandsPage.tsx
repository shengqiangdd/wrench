import { useState, useCallback } from 'react'
import { Zap, Terminal, Download, Upload, PanelLeftOpen, PanelLeftClose, Tags } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useCommands } from './useCommands'
import CommandsList from './CommandsList'
import CommandOutput from './CommandOutput'
import CommandFormModal from './CommandFormModal'
import VariableModal from './VariableModal'
import GroupManageModal from './GroupManageModal'
import { COMMAND_GROUPS } from './index'
import type { QuickCommand } from './index'

export default function CommandsPage() {
  const sessions = useSshStore((s) => s.sessions)
  const connectionId = sessions.length > 0 ? sessions[0]!.id : null

  const {
    customCommands,
    customGroups,
    commandsByGroup,
    results,
    executingId,
    addCommand,
    updateCommand,
    removeCommand,
    executeCommand,
    clearResults,
    removeResult,
    setCustomCommands,
    saveGroup,
    removeGroup,
  } = useCommands()

  const [outputPanelOpen, setOutputPanelOpen] = useState(window.innerWidth >= 768)
  const [showForm, setShowForm] = useState(false)
  const [editCmd, setEditCmd] = useState<QuickCommand | null>(null)
  const [showGroupManage, setShowGroupManage] = useState(false)
  const [variableModal, setVariableModal] = useState<{
    cmd: QuickCommand
    onResolved: (cmd: string) => void
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  /** 执行命令（如果有变量则弹窗） */
  const handleExecute = useCallback(
    async (cmd: QuickCommand) => {
      if (!connectionId) return
      if (cmd.variables && cmd.variables.length > 0) {
        setVariableModal({
          cmd,
          onResolved: async (resolvedCommand) => {
            setVariableModal(null)
            // 复制一份变量已填充的命令
            const resolvedCmd = { ...cmd, command: resolvedCommand, variables: undefined }
            await executeCommand(resolvedCmd, connectionId)
          },
        })
      } else {
        await executeCommand(cmd, connectionId)
      }
    },
    [connectionId, executeCommand],
  )

  /** 复制命令到剪贴板（有变量则弹窗） */
  const handleCopyToClipboard = useCallback((cmdStr: string) => {
    navigator.clipboard.writeText(cmdStr).catch(() => {})
  }, [])

  /** 发送命令到终端 */
  const handleSendToTerminal = useCallback((cmdStr: string) => {
    window.dispatchEvent(new CustomEvent('smartbox:send-to-terminal', { detail: { command: cmdStr } }))
  }, [])

  /** 发送到批量执行面板 */
  const handleSendToBatch = useCallback((cmdStr: string) => {
    window.dispatchEvent(new CustomEvent('smartbox:send-to-batch', { detail: { command: cmdStr } }))
  }, [])

  /** 新建命令 */
  const handleOpenAdd = useCallback(() => {
    setEditCmd(null)
    setShowForm(true)
  }, [])

  /** 编辑命令 */
  const handleEdit = useCallback((cmd: QuickCommand) => {
    setEditCmd(cmd)
    setShowForm(true)
  }, [])

  /** 保存命令 */
  const handleSave = useCallback(
    (data: { name: string; command: string; description?: string; groupId: string }) => {
      if (editCmd) {
        updateCommand(editCmd.id, data)
      } else {
        addCommand(data)
      }
      setShowForm(false)
      setEditCmd(null)
    },
    [editCmd, addCommand, updateCommand],
  )

  /** 导出命令 */
  const handleExport = useCallback(() => {
    const data = JSON.stringify({ version: 1, commands: customCommands }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `smartbox-commands-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [customCommands])

  /** 导入命令 */
  const handleImport = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!data.commands || !Array.isArray(data.commands)) {
          throw new Error('格式无效：缺少 commands 字段')
        }
        const imported = data.commands.map((c: any) => ({
          ...c,
          id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          isBuiltin: false,
        }))
        imported.forEach((cmd: QuickCommand) => addCommand(cmd))
        setImportError(null)
      } catch (err: any) {
        setImportError(`导入失败: ${err.message}`)
        setTimeout(() => setImportError(null), 5000)
      }
    }
    input.click()
  }, [addCommand])

  /** 执行带变量已填充的命令 */
  const handleVariableExecute = useCallback(
    async (cmd: QuickCommand, resolvedCommand: string) => {
      if (!connectionId) return
      const resolvedCmd = { ...cmd, command: resolvedCommand, variables: undefined }
      await executeCommand(resolvedCmd, connectionId)
    },
    [connectionId, executeCommand],
  )

  // 未连接 — 不拦截显示，命令列表可浏览但执行按钮禁用
  const hasConnection = !!connectionId

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <Zap size={18} className="text-amber-400" />
        <h1 className="text-sm font-semibold text-slate-200">脚本模板库</h1>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
          {sessions.length > 1 ? `${sessions.length} 个连接可用` : '1 个连接'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleImport}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="导入命令"
          >
            <Download size={14} />
            导入
          </button>
          <button
            onClick={handleExport}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="导出命令"
          >
            <Upload size={14} />
            导出
          </button>
          <button
            onClick={() => setShowGroupManage(true)}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="管理分组"
          >
            <Tags size={14} />
            分组
          </button>
          <button
            onClick={() => setOutputPanelOpen(!outputPanelOpen)}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title={outputPanelOpen ? '收起执行结果' : '展开执行结果'}
          >
            <Terminal size={14} />
            {outputPanelOpen ? '' : '结果'}
          </button>
        </div>
      </div>

      {/* 导入错误提示 */}
      {importError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-400">
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* 主体：双栏布局 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：命令列表 */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <CommandsList
            commandsByGroup={commandsByGroup()}
            executingId={executingId}
            connectionId={connectionId}
            onExecute={handleExecute}
            onCopyToClipboard={handleCopyToClipboard}
            onAdd={handleOpenAdd}
            onEdit={handleEdit}
            onRemove={removeCommand}
            onSendToTerminal={hasConnection ? handleSendToTerminal : undefined}
            onSendToBatch={hasConnection ? handleSendToBatch : undefined}
          />
        </div>

        {/* 右侧：执行结果（桌面端侧栏，移动端全屏覆盖） */}
        {outputPanelOpen && (
          <div className="fixed inset-0 z-40 bg-slate-950 md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-slate-700/30 md:bg-slate-900/40 md:ml-0">
            <CommandOutput
              results={results}
              onClose={removeResult}
              onClear={clearResults}
              onSendToTerminal={handleSendToTerminal}
              onPanelClose={() => setOutputPanelOpen(false)}
            />
          </div>
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <CommandFormModal
          editCmd={editCmd}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditCmd(null) }}
        />
      )}

      {/* 变量替换弹窗 */}
      {variableModal && (
        <VariableModal
          cmd={variableModal.cmd}
          onConfirm={variableModal.onResolved}
          onCancel={() => setVariableModal(null)}
        />
      )}
    </div>
  )
}
