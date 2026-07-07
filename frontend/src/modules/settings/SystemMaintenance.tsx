/**
 * SystemMaintenance.tsx — 系统维护组件（设置在设置面板中）
 *
 * 展示客户端 SQLite 数据库信息，支持导出备份文件。
 * 数据存储在浏览器 IndexedDB 中，每个用户独立隔离。
 */

import { useState, useCallback } from 'react'
import { Database, Table, Loader2, HardDrive, RefreshCw } from 'lucide-react'
import {
  vaultList,
  connectionsList,
  alertRulesList,
  alertHistoryList,
  notificationChannelsList,
  getDbSize,
} from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'

interface TableInfo {
  name: string
  row_count: number
}

interface DbInfo {
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
  const dbReady = useClientDbReady()
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [loading, setLoading] = useState(false)

  const loadDbInfo = useCallback(async () => {
    if (!dbReady) return
    try {
      setLoading(true)
      const [vault, connections, rules, history, channels, sizeBytes] = await Promise.all([
        vaultList(),
        connectionsList(),
        alertRulesList(),
        alertHistoryList(),
        notificationChannelsList(),
        getDbSize(),
      ])

      setDbInfo({
        size_human: byteSizeHuman(sizeBytes),
        tables: [
          { name: 'vault_entries', row_count: vault.length },
          { name: 'connections', row_count: connections.length },
          { name: 'alert_rules', row_count: rules.length },
          { name: 'alert_history', row_count: history.length },
          { name: 'notification_channels', row_count: channels.length },
        ],
      })
    } catch (e: unknown) {
      console.error('Failed to load DB info:', e)
    } finally {
      setLoading(false)
    }
  }, [dbReady])

  const totalRows = dbInfo?.tables.reduce((sum, t) => sum + t.row_count, 0) ?? 0

  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <HardDrive size={14} />
        本地数据库
      </h3>

      <div className="space-y-3">
        {/* 数据库状态 */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database size={16} className="text-smartbox-400" />
              <span className="text-xs font-medium text-slate-300">客户端 SQLite</span>
            </div>
            <button
              onClick={loadDbInfo}
              disabled={loading || !dbReady}
              className="btn btn-ghost text-[11px]"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>

          {!dbReady && <p className="mt-2 text-[11px] text-amber-400">数据库初始化中...</p>}

          {dbInfo && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">大小</p>
                <p className="font-mono text-xs text-slate-300">{dbInfo.size_human}</p>
              </div>
              <div className="rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">总记录数</p>
                <p className="font-mono text-xs text-slate-300">{totalRows.toLocaleString()}</p>
              </div>
              <div className="col-span-2 rounded bg-slate-800/60 px-3 py-2">
                <p className="text-[10px] text-slate-500">存储位置</p>
                <p className="font-mono text-[10px] text-slate-500">
                  IndexedDB → smartbox_client_db
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

        {/* 说明 */}
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-4 py-3">
          <p className="text-[11px] text-slate-500">
            数据存储在浏览器本地 IndexedDB 中，每个用户独立隔离。 使用「设置 →
            导入/导出」功能备份或迁移数据。
          </p>
        </div>
      </div>
    </section>
  )
}
