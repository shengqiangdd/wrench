/**
 * VaultPage.tsx — Secret Vault UI
 *
 * 加密存储 SSH 密钥、API 密钥、密码等敏感凭据。
 * 数据存储在客户端 SQLite 中，每个浏览器独立隔离。
 */

import { useState, useEffect } from 'react'
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
import { vaultList, vaultUpsert, vaultDelete, type VaultEntry } from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'

const KIND_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number }>; color: string }
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

  const loadEntries = () => {
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
  }

  const deleteEntry = (id: string) => {
    if (!confirm('确定删除此凭据？此操作不可撤销。')) return
    try {
      vaultDelete(id)
      setEntries((prev) => prev.filter((e) => e.id !== id))
    } catch (e: unknown) {
      alert('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  const copyValue = async (_id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(_id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* fallback */
    }
  }

  const toggleShow = (id: string) => {
    setShowValues((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filtered = entries.filter((e) => {
    if (kindFilter !== 'all' && e.kind !== kindFilter) return false
    const tags = parseTags(e.tags)
    if (
      search &&
      !e.name.toLowerCase().includes(search.toLowerCase()) &&
      !tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
    )
      return false
    return true
  })

  const kindMeta = (kind: string) => KIND_META[kind] ?? KIND_META.note!

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
          {['all', 'ssh_key', 'api_key', 'password', 'note'].map((k) => (
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
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
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
            <p className="text-sm">{search ? '无匹配凭据' : '还没有存储任何凭据'}</p>
            {!search && (
              <button
                onClick={() => setShowAddModal(true)}
                className="text-wrench-400 mt-2 text-sm hover:underline"
              >
                添加第一个凭据
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((entry) => {
              const meta = kindMeta(entry.kind)
              const Icon = meta.icon
              const tags = parseTags(entry.tags)
              return (
                <div
                  key={entry.id}
                  className="group rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 hover:border-slate-600/50"
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={18} />
                      <div>
                        <div className="text-sm font-medium text-slate-200">{entry.name}</div>
                        <div className="text-xs text-slate-500">{meta.label}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteEntry(entry.id)}
                      className="rounded p-1 text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-900/30 hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="mb-3 flex items-center gap-2">
                    <code className="flex-1 overflow-hidden rounded bg-slate-900/50 px-2 py-1 font-mono text-xs text-ellipsis whitespace-nowrap text-slate-400">
                      {showValues.has(entry.id) ? entry.value : '••••••••••••••••'}
                    </code>
                    <button
                      onClick={() => toggleShow(entry.id)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                      title={showValues.has(entry.id) ? '隐藏' : '显示'}
                    >
                      {showValues.has(entry.id) ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => copyValue(entry.id, entry.value)}
                      className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
                      title="复制"
                    >
                      {copied === entry.id ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-slate-700/30 px-1.5 py-0.5 text-xs text-slate-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <AddEntryModal
          onClose={() => setShowAddModal(false)}
          onCreated={(entry) => {
            setEntries((prev) => [entry, ...prev])
            setShowAddModal(false)
          }}
        />
      )}
    </div>
  )
}

function AddEntryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (entry: VaultEntry) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('password')
  const [value, setValue] = useState('')
  const [tagsStr, setTagsStr] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !value.trim()) {
      setError('名称和值不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const tags = tagsStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const now = new Date().toISOString()
      const entry: VaultEntry = {
        id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        kind,
        value: value.trim(),
        tags: JSON.stringify(tags),
        createdAt: now,
        updatedAt: now,
      }
      vaultUpsert(entry)
      onCreated(entry)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-200">新增凭据</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="例如：生产服务器 SSH Key"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">类型</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none"
            >
              <option value="ssh_key">SSH Key</option>
              <option value="api_key">API Key</option>
              <option value="password">Password</option>
              <option value="note">Note</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">值</label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="focus:border-wrench-500 h-24 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="粘贴 SSH 私钥、API Key 或密码..."
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              标签（逗号分隔，可选）
            </label>
            <input
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="production, web, devops"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:bg-slate-800"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving && (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
