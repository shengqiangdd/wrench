import { useState, useCallback, useMemo, useEffect } from 'react'
import { Zap, Terminal, Download, Upload, ArrowLeft, WifiOff } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { useCommands } from './useCommands'
import CommandsList from './CommandsList'
import CommandOutput from './CommandOutput'
import CommandFormModal from './CommandFormModal'
import VariableModal from './VariableModal'
import type { QuickCommand } from './index'

export default function CommandsPage() {
  const sessions = useSshStore((s) => s.sessions)

  // 直接从已有 sessions 获取连接 ID（DockerPage 会负责 ensure 连接）
  const connectionId = sessions[0]?.id ?? null

  const {
    customCommands,
    commandsByGroup,
    results,
    executingId,
    addCommand,
    updateCommand,
    removeCommand,
    executeCommand,
    clearResults,
    removeResult,
  } = useCommands()

  const [outputPanelOpen, setOutputPanelOpen] = useState(window.innerWidth >= 768)
  const [showForm, setShowForm] = useState(false)
  const [editCmd, setEditCmd] = useState<QuickCommand | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showGroupManage, setShowGroupManage] = useState(false)
  const [variableModal, setVariableModal] = useState<{
    cmd: QuickCommand
    onResolved: (cmd: string) => void
  } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [executionError, setExecutionError] = useState<string | null>(null)

  // 执行出错时自动清除提示
  useEffect(() => {
    if (!executionError) return
    const t = setTimeout(() => setExecutionError(null), 4000)
    return () => clearTimeout(t)
  }, [executionError])

  /** 执行命令（如果有变量则弹窗） */
  const handleExecute = useCallback(
    async (cmd: QuickCommand) => {
      if (!connectionId) {
        setExecutionError('请先连接 SSH 服务器')
        return
      }
      try {
        if (cmd.variables && cmd.variables.length > 0) {
          setVariableModal({
            cmd,
            onResolved: async (resolvedCommand) => {
              setVariableModal(null)
              const resolvedCmd = { ...cmd, command: resolvedCommand, variables: undefined }
              setOutputPanelOpen(true)
              await executeCommand(resolvedCmd, connectionId)
            },
          })
        } else {
          setOutputPanelOpen(true)
          await executeCommand(cmd, connectionId)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '执行异常'
        setExecutionError(msg)
      }
    },
    [connectionId, executeCommand],
  )

  /** 复制命令到剪贴板 */
  const handleCopyToClipboard = useCallback((cmdStr: string) => {
    navigator.clipboard.writeText(cmdStr).catch(() => {})
  }, [])

  /** 发送命令到终端 */
  const handleSendToTerminal = useCallback((cmdStr: string) => {
    window.dispatchEvent(
      new CustomEvent('wrench:send-to-terminal', { detail: { command: cmdStr } }),
    )
  }, [])

  /** 发送到批量执行面板 */
  const handleSendToBatch = useCallback((cmdStr: string) => {
    window.dispatchEvent(new CustomEvent('wrench:send-to-batch', { detail: { command: cmdStr } }))
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
    a.download = `wrench-commands-${Date.now()}.json`
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
        const imported = data.commands.map((c: Record<string, unknown>) => ({
          ...c,
          id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          isBuiltin: false,
        }))
        imported.forEach((cmd: QuickCommand) => addCommand(cmd))
        setImportError(null)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '导入失败'
        setImportError(`导入失败: ${msg}`)
        setTimeout(() => setImportError(null), 5000)
      }
    }
    input.click()
  }, [addCommand])

  const hasConnection = !!connectionId

  // 缓存命令分组数据
  const memoizedCommandsByGroup = useMemo(() => commandsByGroup(), [commandsByGroup])

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/80 px-4 py-2">
        <Zap size={18} className="text-amber-400" />
        <h1 className="text-sm font-semibold text-slate-200">脚本模板库</h1>
        {!hasConnection && (
          <span className="flex items-center gap-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
            <WifiOff size={10} /> 未连接
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleImport}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="导入命令"
          >
            <Download size={14} />
            <span className="hidden sm:inline">导入</span>
          </button>
          <button
            onClick={handleExport}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title="导出命令"
          >
            <Upload size={14} />
            <span className="hidden sm:inline">导出</span>
          </button>
          <button
            onClick={() => setOutputPanelOpen(!outputPanelOpen)}
            className="flex min-h-[44px] items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title={outputPanelOpen ? '收起执行结果' : '展开执行结果'}
          >
            <Terminal size={14} />
            <span className="hidden sm:inline">{outputPanelOpen ? '隐藏结果' : '显示结果'}</span>
            {results.length > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600/30 px-1 text-[9px] text-amber-400">
                {results.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 执行错误提示 */}
      {executionError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/30 px-4 py-2 text-xs text-red-400">
          <span>{executionError}</span>
          <button
            onClick={() => setExecutionError(null)}
            className="ml-auto text-red-500 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* 导入错误提示 */}
      {importError && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-400">
          <span>{importError}</span>
          <button
            onClick={() => setImportError(null)}
            className="ml-auto text-red-500 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* 主体：双栏布局 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧：命令列表 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CommandsList
            commandsByGroup={memoizedCommandsByGroup}
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
          <div className="fixed inset-0 z-40 flex flex-col bg-slate-950 md:static md:z-auto md:ml-0 md:w-96 md:shrink-0 md:border-l md:border-slate-700/30 md:bg-slate-900/40">
            {/* 移动端返回按钮 */}
            <div className="flex shrink-0 items-center border-b border-slate-700/30 px-3 py-2 md:hidden">
              <button
                onClick={() => setOutputPanelOpen(false)}
                className="flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <ArrowLeft size={14} />
                返回命令列表
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <CommandOutput
                results={results}
                onClose={removeResult}
                onClear={clearResults}
                onSendToTerminal={handleSendToTerminal}
              />
            </div>
          </div>
        )}
      </div>

      {/* 新建/编辑弹窗 */}
      {showForm && (
        <CommandFormModal
          editCmd={editCmd}
          onSave={handleSave}
          onClose={() => {
            setShowForm(false)
            setEditCmd(null)
          }}
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
