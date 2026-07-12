/**
 * VaultPage.tsx — Secret Vault UI
 *
 * 加密存储 SSH 密钥、API 密钥、密码等敏感凭据。
 * 数据存储在客户端 SQLite 中，每个浏览器独立隔离。
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import {
  KeyRound,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  Check,
  Terminal,
  Key,
  Lock,
  FileText,
  Search,
  Loader2,
} from 'lucide-react'
import { vaultList, vaultDelete, type VaultEntry } from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'

const KIND_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }
> = {
  ssh_key: { label: 'SSH Key', icon: Terminal, color: 'text-emerald-400' },
  api_key: { label: 'API Key', icon: Key, color: 'text-blue-400' },
  password: { label: 'Password', icon: Lock, color: 'text-amber-400' },
  note: { label: 'Note', icon: FileText, color: 'text-slate-400' },
}

function parseTags(tagsStr: string): string[] {
  try {
    const parsed = JSON.parse(tagsStr)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ─── EntryCard 子组件（React.memo） ───

interface EntryCardProps {
  entry: VaultEntry
  showValue: boolean
  copiedId: string | null
  onToggleShow: (id: string) => void
  onCopy: (id: string, value: string) => void
  onDelete: (id: string) => void
  kindMeta: (kind: string) => {
    label: string
    icon: React.ComponentType<{ size?: number; className?: string }>
    color: string
  }
}

const EntryCard = memo(function EntryCard({
  entry,
  showValue,
  copiedId,
  onToggleShow,
  onCopy,
  onDelete,
  kindMeta,
}: EntryCardProps) {
  const meta = kindMeta(entry.kind)
  const Icon = meta.icon
  const tags = parseTags(entry.tags)
  const isCopied = copiedId === entry.id

  return (
    <div className="group rounded-lg border border-slate-700/50 bg-slate-800/60 p-4 transition-colors hover:border-slate-600/70">
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon size={16} className={meta.color} />
          <div>
            <h3 className="text-sm font-medium text-slate-200">{entry.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => onToggleShow(entry.id)}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300"
            title={showValue ? '隐藏' : '显示'}
          >
            {showValue ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            onClick={() => onCopy(entry.id, entry.value)}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-slate-300"
            title="复制"
          >
            {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>
          <button
            onClick={() => onDelete(entry.id)}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700/50 hover:text-red-400"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="mb-2 rounded bg-slate-900/60 px-3 py-2">
        <code className="text-xs break-all text-slate-400">
          {showValue ? entry.value : '•'.repeat(Math.min(entry.value.length, 20))}
        </code>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* entry.note field not in VaultEntry */}
    </div>
  )
})

export default function VaultPage() {
  const dbReady = useClientDbReady()
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showValues, setShowValues] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [kindFilter, setKindFilter] = useState<string>('all')

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!dbReady) return
    setLoading(true)
    setError(null)
    try {
      const data = vaultList()
      setEntries(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load vault entries')
    } finally {
      setLoading(false)
    }
  }, [dbReady])
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadEntries = useCallback(() => {
    if (!dbReady) return
    setLoading(true)
    setError(null)
    try {
      const data = vaultList()
      setEntries(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load vault entries')
    } finally {
      setLoading(false)
    }
  }, [dbReady])

  const deleteEntry = useCallback((id: string) => {
    if (!confirm('确定删除此凭据？此操作不可撤销。')) return
    try {
      vaultDelete(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (e: unknown) {
      alert('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }, [])

  const copyValue = useCallback(async (_id: string, value: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      }
      setCopied(_id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* fallback */
    }
  }, [])

  const toggleShow = useCallback((id: string) => {
    setShowValues((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 缓存过滤后的 entries
  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    return entries.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false
      if (lowerSearch) {
        const tags = parseTags(e.tags)
        if (
          !e.name.toLowerCase().includes(lowerSearch) &&
          !tags.some((t) => t.toLowerCase().includes(lowerSearch))
        )
          return false
      }
      return true
    })
  }, [entries, search, kindFilter])

  const kindMetaFn = useCallback((kind: string) => KIND_META[kind] ?? KIND_META.note!, [])

  // 渲染各类型数量统计
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const e of entries) {
      counts[e.kind] = (counts[e.kind] || 0) + 1
    }
    return counts
  }, [entries])

  if (!dbReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">初始化本地数据库...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <KeyRound size={22} className="text-wrench-400" />
          <h1 className="text-lg font-semibold text-slate-200">凭据保险箱</h1>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">本地存储</span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} />
          新增凭据
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 border-b border-slate-700/50 px-6 py-3">
        <div className="relative max-w-md flex-1">
          <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索凭据..."
            className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800/50 py-2 pr-3 pl-9 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'ssh_key', 'api_key', 'password', 'note'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                kindFilter === k
                  ? 'bg-wrench-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {k === 'all' ? '全部' : KIND_META[k]?.label || k}
              <span className="ml-1 text-[10px] opacity-70">{kindCounts[k] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin text-slate-500" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <KeyRound size={40} className="text-red-400" />
            <p className="text-sm">加载失败：{error}</p>
            <button onClick={loadEntries} className="text-wrench-400 mt-2 text-sm hover:underline">
              重试
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <KeyRound size={40} />
            <p className="text-sm">
              {entries.length === 0 ? '还没有存储任何凭据' : '没有匹配的凭据'}
            </p>
            {entries.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                className="text-wrench-400 mt-2 text-sm hover:underline"
              >
                添加第一个凭据
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                showValue={showValues.has(entry.id)}
                copiedId={copied}
                onToggleShow={toggleShow}
                onCopy={copyValue}
                onDelete={deleteEntry}
                kindMeta={kindMetaFn}
              />
            ))}
          </div>
        )}
      </div>

      {/* TODO: Add vault entry modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-200">新增凭据</h2>
            <p className="text-sm text-slate-400">增加凭据功能开发中，敬请期待...</p>
            <button
              onClick={() => setShowAddModal(false)}
              className="mt-4 rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
