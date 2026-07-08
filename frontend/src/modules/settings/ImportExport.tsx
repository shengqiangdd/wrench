/**
 * ImportExport.tsx — 配置导入导出面板
 *
 * 提取自 SettingsPanel，包含导出、导入、密码保护功能。
 * 使用 React.memo 避免无关渲染。
 */

import { useState, useCallback, memo } from 'react'
import {
  Download,
  Upload,
  Lock,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { exportConfig, importConfigFromFile } from '../../services/importExport'
import { ConfirmModal } from '../../components/ConfirmModal'

const ImportExport = memo(function ImportExport() {
  const [exportPassword, setExportPassword] = useState('')
  const [showExportConfirm, setShowExportConfirm] = useState(false)
  const [importingFile, setImportingFile] = useState<File | null>(null)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

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

  // 导出确认
  const handleExportConfirm = useCallback(() => {
    if (exportPassword) {
      handleExport()
    } else {
      setShowExportConfirm(true)
    }
  }, [exportPassword, handleExport])

  // 导入
  const handleImport = useCallback(async () => {
    if (!importingFile) return
    setIsImporting(true)
    try {
      await importConfigFromFile(importingFile)
      setImportSuccess(true)
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setImportError(msg)
    } finally {
      setIsImporting(false)
    }
  }, [importingFile])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setImportingFile(file)
      setImportError('')
      setImportSuccess(false)
    }
  }, [])

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Download size={14} />
        数据导入导出
      </h3>

      <div className="space-y-3">
        {/* 导出 */}
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
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {isExporting ? '导出中...' : '导出配置'}
          </button>
        </div>

        {/* 导入 */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-2 text-xs font-medium text-slate-300">导入配置</div>
          <p className="mb-3 text-[11px] text-slate-500">
            从 .json 文件导入配置。导入将覆盖现有数据，建议先导出备份。
          </p>

          <div className="mb-3">
            <label className="mb-1 flex items-center gap-1 text-[11px] text-slate-500">
              <Upload size={10} />
              选择文件
            </label>
            <div className="relative">
              <input
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="input cursor-pointer text-xs"
              />
            </div>
            {importingFile && (
              <p className="mt-1 text-[11px] text-slate-500">
                已选择：{importingFile.name}
              </p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={!importingFile || isImporting}
            className="btn btn-primary flex items-center gap-2 text-xs"
          >
            {isImporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            {isImporting ? '导入中...' : '导入配置'}
          </button>

          {importError && (
            <div className="mt-2 flex items-center gap-2 rounded bg-red-900/20 px-3 py-2 text-[11px] text-red-400">
              <AlertTriangle size={12} />
              {importError}
            </div>
          )}

          {importSuccess && (
            <div className="mt-2 flex items-center gap-2 rounded bg-green-900/20 px-3 py-2 text-[11px] text-green-400">
              <CheckCircle2 size={12} />
              导入成功，正在刷新页面...
            </div>
          )}
        </div>
      </div>

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

export default ImportExport