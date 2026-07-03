/**
 * SystemMaintenance.tsx — 系统维护组件（设置在设置面板中）
 *
 * 展示服务端数据库信息，支持下载备份文件。
 */

import { useState, useEffect, useCallback } from 'react'
import { Database, Download, Server, HardDrive, Table, Loader2, AlertTriangle } from 'lucide-react'
import { authedFetch } from '../../services/auth'

interface TableInfo {
  name: string
  row_count: number
}

interface DbInfo {
  path: string
  size_bytes: number
  size_human: string
  tables: TableInfo[]
}

function byteSizeHuman(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let i = 0
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

export default function SystemMaintenance() {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const loadDbInfo = useCallback(async () => {
    try {
      setLoading(true)
      const res = await authedFetch('/api/system/db-info')
      const json = await res.json()
      setDbInfo(json.data || null)
      setError(null)
    } catch (e: any) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDbInfo()
  }, [loadDbInfo])

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await authedFetch('/api/system/db-download')
      const blob = await res.blob()
      const filename =
        res.headers.get('content-disposition')?.match(/filename="?(.+?)"?$/)?.[1] ||
        `smartbox-backup.db`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      alert('下载失败: ' + (e.message || '未知错误'))
    } finally {
      setDownloading(false)
    }
  }

  const totalRows = dbInfo?.tables.reduce((sum, t) => sum + t.row_count, 0) ?? 0

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Server size={14} />
        系统维护
      </h3>

      <div className="space-y-3">
        {/* 数据库状态 */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-smartbox-400" />
              <span className="text-xs font-medium text-slate-300">数据库状态</span>
            </div>
            <button onClick={loadDbInfo} disabled={loading} className="btn btn-ghost text-[11px]">
              {loading ? <Loader2 size={12} className="animate-spin" /> : '刷新'}
            </button>
          </div>

          {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

          {dbInfo && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">大小</p>
                <p className="font-mono text-xs text-slate-300">{dbInfo.size_human}</p>
              </div>
              <div className="rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">表数量</p>
                <p className="font-mono text-xs text-slate-300">{dbInfo.tables.length}</p>
              </div>
              <div className="rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">总记录数</p>
                <p className="font-mono text-xs text-slate-300">{totalRows.toLocaleString()}</p>
              </div>
              <div className="col-span-1 rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">存储路径</p>
                <p className="truncate font-mono text-[10px] text-slate-500" title={dbInfo.path}>
                  {dbInfo.path}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 表详情 */}
        {dbInfo && dbInfo.tables.length > 0 && (
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <Table size={14} className="text-slate-500" />
              <span className="text-[11px] text-slate-500">数据表详情</span>
            </div>
            <div className="space-y-1">
              {dbInfo.tables.map((t) => (
                <div key={t.name} className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-400">{t.name}</span>
                  <span className="text-slate-500">{t.row_count.toLocaleString()} 行</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 备份下载 */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-slate-300">备份下载</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                下载当前 SQLite 数据库文件，包含所有审计日志、凭据、通知渠道和 SSH 连接配置
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading || !dbInfo}
              className="btn btn-ghost flex min-h-[44px] items-center gap-1.5 text-xs"
            >
              <Download size={14} />
              {downloading ? '下载中...' : '下载备份'}
            </button>
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-500/70">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>
              凭据保险箱中的数据使用 AES-256-GCM 加密存储，备份文件包含加密后的密文，解密需要服务端
              VAULT_KEY 或 JWT_SECRET。
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
