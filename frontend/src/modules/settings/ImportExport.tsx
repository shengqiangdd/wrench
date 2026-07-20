/**
 * ImportExport.tsx — 配置导入导出面板
 *
 * 支持导出、导入预览、合并/覆盖模式选择。
 * 导入前展示冲突项详情，让用户知情决策。
 */

import { useState, useCallback, memo } from 'react'
import {
  Download,
  Upload,
  Lock,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Eye,
  GitMerge,
  Replace,
  X,
} from 'lucide-react'
import {
  exportConfig,
  parseImportContent,
  previewImport,
  importConfig,
  type ImportPreview,
  type ImportMode,
} from '../../services/importExport'
import { ConfirmModal } from '../../components/ConfirmModal'

const ImportExport = memo(function ImportExport() {
  const [exportPassword, setExportPassword] = useState('')
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [importingFile, setImportingFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('merge')

  // 预览相关
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null)

  // 导出
  const handleExport = useCallback(async () => {
    setIsExporting(true)
    try {
      await exportConfig(exportPassword || undefined)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误'
      alert('导出失败: ' + msg)
    } finally {
      setIsExporting(false)
      setShowExportConfirm(false)
    }
  }, [exportPassword])

  const handleExportConfirm = useCallback(() => {
    if (exportPassword) {
      handleExport()
    } else {
      setShowExportConfirm(true)
    }
  }, [exportPassword, handleExport])

  // 文件选择 → 自动预览
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingFile(file)
    setImportError('')
    setImportSuccess(false)
    setImportResult(null)

    try {
      const text = await file.text()
      const payload = await parseImportContent(text)
      if (payload) {
        const p = previewImport(payload.data)
        setPreview(p)
        setShowPreview(true)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '解析失败'
      setImportError(msg)
    }
  }, [])

  // 确认导入
  const handleImport = useCallback(async () => {
    if (!importingFile) return
    setIsImporting(true)
    setImportError('')
    try {
      const result = await importConfig(await importingFile.text(), importMode)
      setImportResult(result as unknown as Record<string, unknown>)
      setImportSuccess(true)
      setShowPreview(false)
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setImportError(msg)
    } finally {
      setIsImporting(false)
    }
  }, [importingFile, importMode])

  const hasConflicts =
    preview &&
    (preview.connections.conflict > 0 ||
      preview.alertRules.conflict > 0 ||
      preview.vault.conflict > 0 ||
      preview.notificationChannels.conflict > 0)

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Download size={14} />
        数据导入导出
      </h3>

      <div className="space-y-3">
        {/* ── 导出 ── */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-2 text-xs font-medium text-slate-300">导出配置</div>
          <p className="mb-3 text-[11px] text-slate-500">
            导出所有配置、连接、SSH 密钥和告警规则。支持密码加密保护。
          </p>

          <div className="mb-3">
            <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Lock size={10} />
              加密密码（可选）
            </label>
            <input
              type="password"
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder="不设置则不加密"
              className="input text-xs"
            />
          </div>

          <button
            onClick={handleExportConfirm}
            disabled={isExporting}
            className="btn btn-primary flex items-center gap-2 text-xs"
          >
            {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isExporting ? '导出中...' : '导出配置'}
          </button>
        </div>

        {/* ── 导入 ── */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-2 text-xs font-medium text-slate-300">导入配置</div>
          <p className="mb-3 text-[11px] text-slate-500">
            从 .json 或 .wrench 文件导入配置。支持智能合并或完全覆盖。
          </p>

          {/* 模式选择 */}
          <div className="mb-3">
            <label className="mb-1.5 text-[11px] text-slate-500">导入模式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setImportMode('merge')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] transition-colors ${
                  importMode === 'merge'
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-500 hover:border-slate-600'
                }`}
              >
                <GitMerge size={12} />
                智能合并
              </button>
              <button
                onClick={() => setImportMode('replace')}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] transition-colors ${
                  importMode === 'replace'
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                    : 'border-slate-700/50 bg-slate-800/50 text-slate-500 hover:border-slate-600'
                }`}
              >
                <Replace size={12} />
                完全覆盖
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-slate-600">
              {importMode === 'merge'
                ? '保留现有数据，只添加不存在的项目（同名项跳过）'
                : '⚠️ 清空现有数据后写入（不可撤销）'}
            </p>
          </div>

          {/* 文件选择 */}
          <div className="mb-3">
            <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Upload size={10} />
              选择文件
            </label>
            <input
              type="file"
              accept=".json,.wrench"
              onChange={handleFileSelect}
              className="input cursor-pointer text-xs"
            />
            {importingFile && (
              <p className="mt-1 text-[11px] text-slate-500">已选择：{importingFile.name}</p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={!importingFile || isImporting || !preview}
            className="btn btn-primary flex items-center gap-2 text-xs"
          >
            {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {isImporting ? '导入中...' : '确认导入'}
          </button>

          {importError && (
            <div className="mt-2 flex items-center gap-2 rounded bg-red-900/20 px-3 py-2 text-[11px] text-red-400">
              <AlertTriangle size={12} />
              {importError}
            </div>
          )}

          {importSuccess && importResult && (
            <div className="mt-2 rounded bg-green-900/20 px-3 py-2 text-[11px] text-green-400">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <CheckCircle2 size={12} />
                导入成功，正在刷新页面...
              </div>
              <div className="space-y-0.5 text-green-400/70">
                <div>
                  连接: 写入 {(importResult.connections as { imported: number })?.imported || 0} 项
                </div>
                <div>
                  告警规则: 写入 {(importResult.alertRules as { imported: number })?.imported || 0}{' '}
                  项
                </div>
                <div>
                  凭据: 写入 {(importResult.vault as { imported: number })?.imported || 0} 项
                </div>
                <div>
                  通知渠道: 写入{' '}
                  {(importResult.notificationChannels as { imported: number })?.imported || 0} 项
                </div>
                <div>插件状态: 更新 {(importResult.plugins as number) || 0} 项</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 导入预览弹窗 ── */}
      {showPreview && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700/50 bg-slate-900 shadow-2xl">
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-200">导入预览</h3>
              </div>
              <button
                onClick={() => {
                  setShowPreview(false)
                  setPreview(null)
                  setImportingFile(null)
                }}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            {/* 内容 */}
            <div className="space-y-4 px-5 py-4">
              {/* 模式提示 */}
              <div
                className={`rounded-lg px-3 py-2 text-[11px] ${
                  importMode === 'merge'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}
              >
                {importMode === 'merge'
                  ? '🔄 智能合并模式：跳过已存在的同名项'
                  : '⚠️ 完全覆盖模式：清空现有数据后写入'}
              </div>

              {/* 连接 */}
              <PreviewRow
                title="SSH 连接"
                total={preview.connections.total}
                newCount={preview.connections.new}
                conflict={preview.connections.conflict}
                conflictDetail={
                  preview.connections.conflictNames.length > 0
                    ? `冲突项: ${preview.connections.conflictNames.slice(0, 3).join(', ')}${preview.connections.conflictNames.length > 3 ? '...' : ''}`
                    : undefined
                }
              />

              {/* 告警规则 */}
              <PreviewRow
                title="告警规则"
                total={preview.alertRules.total}
                newCount={preview.alertRules.new}
                conflict={preview.alertRules.conflict}
              />

              {/* 凭据 */}
              <PreviewRow
                title="凭据保险箱"
                total={preview.vault.total}
                newCount={preview.vault.new}
                conflict={preview.vault.conflict}
              />

              {/* 通知渠道 */}
              <PreviewRow
                title="通知渠道"
                total={preview.notificationChannels.total}
                newCount={preview.notificationChannels.new}
                conflict={preview.notificationChannels.conflict}
              />

              {/* AI 配置 */}
              <div className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                <span className="text-xs text-slate-400">AI 配置</span>
                <span
                  className={`text-[11px] ${preview.aiConfig.hasChanges ? 'text-blue-400' : 'text-slate-600'}`}
                >
                  {preview.aiConfig.hasChanges ? '将更新' : '无变化'}
                </span>
              </div>

              {/* 插件 */}
              <div className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                <span className="text-xs text-slate-400">插件状态</span>
                <span className="text-[11px] text-slate-500">
                  {preview.plugins.total} 个已启用
                  {preview.plugins.enabled > 0 ? `，${preview.plugins.enabled} 个新增` : ''}
                </span>
              </div>

              {/* 冲突警告 */}
              {hasConflicts && importMode === 'merge' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
                  ⚠️ 存在{' '}
                  {preview.connections.conflict +
                    preview.alertRules.conflict +
                    preview.vault.conflict +
                    preview.notificationChannels.conflict}{' '}
                  个冲突项将被跳过
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-700/50 px-5 py-3">
              <button
                onClick={() => {
                  setShowPreview(false)
                  setPreview(null)
                  setImportingFile(null)
                }}
                className="rounded-lg px-4 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-300"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                  importMode === 'replace'
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                }`}
              >
                {isImporting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : importMode === 'replace' ? (
                  <Replace size={12} />
                ) : (
                  <GitMerge size={12} />
                )}
                {isImporting ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出确认弹窗 */}
      <ConfirmModal
        open={showExportConfirm}
        onCancel={() => setShowExportConfirm(false)}
        onConfirm={handleExport}
        title="确认导出"
        message={`你确定要导出配置吗？${exportPassword ? '（将使用密码加密）' : '（不加密，任何持有者可查看）'}`}
        confirmText="确认导出"
        variant="default"
      />
    </section>
  )
})

// ── 预览行组件 ──

function PreviewRow({
  title,
  total,
  newCount,
  conflict,
  conflictDetail,
}: {
  title: string
  total: number
  newCount: number
  conflict: number
  conflictDetail?: string
}) {
  return (
    <div className="rounded-lg bg-slate-800/50 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{title}</span>
        <span className="text-[11px] text-slate-500">共 {total} 项</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[10px]">
        {newCount > 0 && <span className="text-emerald-400">+{newCount} 新增</span>}
        {conflict > 0 && <span className="text-amber-400">⊘ {conflict} 跳过</span>}
        {newCount === 0 && conflict === 0 && total > 0 && (
          <span className="text-slate-600">全部已存在</span>
        )}
        {total === 0 && <span className="text-slate-600">无数据</span>}
      </div>
      {conflictDetail && <p className="mt-1 text-[10px] text-slate-600">{conflictDetail}</p>}
    </div>
  )
}

export default ImportExport
