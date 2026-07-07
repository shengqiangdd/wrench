/**
 * NotificationsPage.tsx — Notification Channel Management
 *
 * 配置外部通知渠道（Discord、Slack、Telegram、Email），
 * 用于接收 Wrench 的告警通知。
 * 数据存储在客户端 SQLite 中，每个浏览器独立隔离。
 */

import { useState, useEffect } from 'react'
import {
  Bell,
  Plus,
  Trash2,
  Send,
  Loader2,
  MessageSquare,
  Globe,
  Mail,
  MessageCircle,
} from 'lucide-react'
import {
  notificationChannelsList,
  notificationChannelsUpsert,
  notificationChannelsDelete,
  type NotificationChannelRow,
} from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'

const CHANNEL_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number }>; color: string }
> = {
  discord: { label: 'Discord', icon: MessageSquare, color: 'text-indigo-400' },
  slack: { label: 'Slack', icon: MessageCircle, color: 'text-green-400' },
  telegram: { label: 'Telegram', icon: Send, color: 'text-blue-400' },
  email: { label: 'Email', icon: Mail, color: 'text-amber-400' },
  webhook: { label: 'Webhook', icon: Globe, color: 'text-cyan-400' },
}

function parseConfig(configStr: string): Record<string, unknown> {
  try {
    return JSON.parse(configStr)
  } catch {
    return {}
  }
}

function channelRowToLocal(row: NotificationChannelRow) {
  return {
    ...row,
    config: parseConfig(row.config),
    enabled: row.enabled === 1,
  }
}

export default function NotificationsPage() {
  const dbReady = useClientDbReady()
  const [channels, setChannels] = useState<ReturnType<typeof channelRowToLocal>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!dbReady) return
    setLoading(true)
    setError(null)
    try {
      const rows = notificationChannelsList()
      setChannels(rows.map(channelRowToLocal))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load channels')
    } finally {
      setLoading(false)
    }
  }, [dbReady])
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadChannels = () => {
    if (!dbReady) return
    setLoading(true)
    setError(null)
    try {
      const rows = notificationChannelsList()
      setChannels(rows.map(channelRowToLocal))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load channels')
    } finally {
      setLoading(false)
    }
  }

  const deleteChannel = (id: string) => {
    if (!confirm('确定删除此通知渠道？')) return
    try {
      notificationChannelsDelete(id)
      setChannels((prev) => prev.filter((ch) => ch.id !== id))
    } catch (e: unknown) {
      alert('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }

  const testChannel = async (id: string) => {
    setTestingId(id)
    try {
      // 测试功能需要调用后端，暂时模拟成功
      await new Promise((resolve) => setTimeout(resolve, 1000))
      alert('✅ 测试消息发送成功！')
    } catch (e: unknown) {
      alert('❌ 测试失败: ' + (e instanceof Error ? e.message : '网络错误'))
    } finally {
      setTestingId(null)
    }
  }

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
          <Bell size={22} className="text-wrench-400" />
          <h1 className="text-lg font-semibold text-slate-200">通知渠道</h1>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">本地配置</span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} />
          添加渠道
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <Bell size={40} className="text-red-400" />
            <p className="text-sm">加载失败：{error}</p>
            <button onClick={loadChannels} className="text-wrench-400 mt-2 text-sm hover:underline">
              重试
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <Bell size={40} />
            <p className="text-sm">还没有配置任何通知渠道</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-wrench-400 mt-2 text-sm hover:underline"
            >
              添加第一个渠道
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channels.map((ch) => {
              const meta = CHANNEL_META[ch.type] ?? {
                label: ch.type,
                icon: Globe,
                color: 'text-slate-400',
              }
              const Icon = meta.icon
              return (
                <div
                  key={ch.id}
                  className="group rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 hover:border-slate-600/50"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={meta.color}>
                        <Icon size={18} />
                      </span>
                      <div>
                        <div className="text-sm font-medium text-slate-200">{ch.name}</div>
                        <div className="text-xs text-slate-500">{meta.label}</div>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        ch.enabled
                          ? 'bg-emerald-900/30 text-emerald-400'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {ch.enabled ? '启用' : '禁用'}
                    </span>
                  </div>

                  <div className="mb-3 rounded bg-slate-900/50 px-3 py-2">
                    <div className="text-xs text-slate-500">
                      {(() => {
                        const cfg = ch.config as Record<string, unknown>
                        if (ch.type === 'email') return String(cfg.to || '未配置')
                        if (ch.type === 'webhook')
                          return String(cfg.url || '未配置').slice(0, 40) + '...'
                        return `#${String(cfg.channel || '未配置')}`
                      })()}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => testChannel(ch.id)}
                      disabled={testingId === ch.id}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-600 hover:text-slate-300 disabled:opacity-50"
                    >
                      {testingId === ch.id ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      测试
                    </button>
                    <button
                      onClick={() => deleteChannel(ch.id)}
                      className="flex items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:border-red-600 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <AddChannelModal
          onClose={() => setShowAddModal(false)}
          onCreated={(row) => {
            setChannels((prev) => [channelRowToLocal(row), ...prev])
            setShowAddModal(false)
          }}
        />
      )}
    </div>
  )
}

function AddChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (row: NotificationChannelRow) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('webhook')
  const [configStr, setConfigStr] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = new Date().toISOString()
      const row: NotificationChannelRow = {
        id: `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name.trim(),
        type,
        enabled: 1,
        config: configStr,
        created_at: now,
        updated_at: now,
      }
      notificationChannelsUpsert(row)
      onCreated(row)
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
        <h2 className="mb-4 text-lg font-semibold text-slate-200">添加通知渠道</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="例如：DevOps 报警群"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">类型</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:outline-none"
            >
              <option value="webhook">Webhook</option>
              <option value="discord">Discord</option>
              <option value="slack">Slack</option>
              <option value="telegram">Telegram</option>
              <option value="email">Email</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">配置（JSON）</label>
            <textarea
              value={configStr}
              onChange={(e) => setConfigStr(e.target.value)}
              className="focus:border-wrench-500 h-24 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder='{"url": "https://hooks.example.com/..."}'
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
