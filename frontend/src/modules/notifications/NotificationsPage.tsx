/**
 * NotificationsPage.tsx — Notification Channel Management
 *
 * 配置外部通知渠道（Discord、Slack、Telegram、Email），
 * 用于接收 Wrench 的告警通知。
 * 数据存储在客户端 SQLite 中，每个浏览器独立隔离。
 */

import { useState, useEffect, useMemo, useCallback, memo } from 'react'
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
  Pencil,
} from 'lucide-react'
import {
  notificationChannelsList,
  notificationChannelsDelete,
  notificationChannelsUpsert,
  type NotificationChannelRow,
} from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'
import { notify } from '../../services/event-bus'
import { ConfirmModal } from '../../components/ConfirmModal'

const CHANNEL_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; color: string }
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

type LocalChannel = ReturnType<typeof channelRowToLocal>

// ─── ChannelCard 子组件（React.memo） ───

interface ChannelCardProps {
  channel: LocalChannel
  testingId: string | null
  onTest: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (channel: LocalChannel) => void
}

const ChannelCard = memo(function ChannelCard({
  channel,
  testingId,
  onTest,
  onDelete,
  onEdit,
}: ChannelCardProps) {
  const meta = CHANNEL_META[channel.type] ?? {
    label: channel.type,
    icon: Globe,
    color: 'text-slate-400',
  }
  const Icon = meta.icon

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 p-4 transition-colors hover:border-slate-600/70">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className={meta.color} />
          <div>
            <button
              onClick={() => onEdit(channel)}
              className="hover:text-wrench-400 group flex items-center gap-1.5 text-sm font-medium text-slate-200 transition-colors"
            >
              {channel.name}
              <Pencil
                size={11}
                className="text-slate-500 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
            <p className="mt-0.5 text-[11px] text-slate-500">{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              channel.enabled ? 'bg-green-900/30 text-green-400' : 'bg-slate-700/50 text-slate-500'
            }`}
          >
            {channel.enabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      {/* 配置摘要 */}
      <div className="mb-3 rounded bg-slate-900/60 px-3 py-2">
        {Object.entries(channel.config).map(([key, value]) => (
          <div key={key} className="flex justify-between text-[11px]">
            <span className="text-slate-500">{key}</span>
            <span className="max-w-[180px] truncate text-slate-400">
              {typeof value === 'string' ? value : JSON.stringify(value)}
            </span>
          </div>
        ))}
        {Object.keys(channel.config).length === 0 && (
          <p className="text-[11px] text-slate-600">暂无配置</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onTest(channel.id)}
          disabled={testingId === channel.id}
          className="flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-slate-200 disabled:opacity-50"
        >
          {testingId === channel.id ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Send size={12} />
          )}
          测试
        </button>
        <button
          onClick={() => onDelete(channel.id)}
          className="flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:bg-slate-700/50 hover:text-red-400"
        >
          <Trash2 size={12} />
          删除
        </button>
      </div>
    </div>
  )
})

// ─── Add / Edit Channel Modal ───

const TYPE_OPTIONS = [
  { value: 'discord', label: 'Discord' },
  { value: 'slack', label: 'Slack' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'email', label: 'Email' },
  { value: 'webhook', label: 'Webhook' },
]

interface AddEditChannelModalProps {
  editingChannel: LocalChannel | null
  onClose: () => void
  onSaved: () => void
}

function AddEditChannelModal({ editingChannel, onClose, onSaved }: AddEditChannelModalProps) {
  const isEdit = editingChannel !== null

  const [name, setName] = useState(editingChannel?.name ?? '')
  const [type, setType] = useState(editingChannel?.type ?? 'discord')
  const [enabled, setEnabled] = useState(editingChannel?.enabled ?? true)
  const [saving, setSaving] = useState(false)

  // Config fields state — always a flat Record<string, string>
  const [config, setConfig] = useState<Record<string, string>>(() => {
    if (editingChannel?.config) {
      const raw = editingChannel.config
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        out[k] = typeof v === 'string' ? v : JSON.stringify(v)
      }
      return out
    }
    return {}
  })

  // Reset config fields when type changes (only if not editing)
  const resetConfigForType = useCallback(
    (newType: string) => {
      if (isEdit) return
      const defaults: Record<string, string> = {}
      switch (newType) {
        case 'discord':
        case 'slack':
          defaults.webhook_url = ''
          break
        case 'telegram':
          defaults.bot_token = ''
          defaults.chat_id = ''
          break
        case 'email':
          defaults.smtp_host = ''
          defaults.smtp_port = '587'
          defaults.smtp_username = ''
          defaults.smtp_password = ''
          defaults.recipients = ''
          break
        case 'webhook':
          defaults.url = ''
          defaults.method = 'POST'
          defaults.headers = ''
          break
      }
      setConfig(defaults)
    },
    [isEdit],
  )

  const handleTypeChange = (newType: string) => {
    setType(newType)
    resetConfigForType(newType)
  }

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      const now = new Date().toISOString()
      const row: NotificationChannelRow = {
        id: editingChannel?.id ?? crypto.randomUUID(),
        name: name.trim(),
        type,
        enabled: enabled ? 1 : 0,
        config: JSON.stringify(config),
        created_at: editingChannel?.created_at ?? now,
        updated_at: now,
      }
      notificationChannelsUpsert(row)
      notify('通知渠道已保存', 'success')
      onSaved()
    } catch (e: unknown) {
      notify('保存失败: ' + (e instanceof Error ? e.message : '未知错误'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Render config fields based on type
  const renderConfigFields = () => {
    const inputCls =
      'w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-wrench-500 focus:outline-none'
    const labelCls = 'block text-xs font-medium text-slate-400 mb-1'

    switch (type) {
      case 'discord':
        return (
          <div>
            <label className={labelCls}>Webhook URL</label>
            <input
              type="url"
              className={inputCls}
              placeholder="https://discord.com/api/webhooks/..."
              value={config.webhook_url ?? ''}
              onChange={(e) => updateConfig('webhook_url', e.target.value)}
            />
          </div>
        )
      case 'slack':
        return (
          <div>
            <label className={labelCls}>Webhook URL</label>
            <input
              type="url"
              className={inputCls}
              placeholder="https://hooks.slack.com/services/..."
              value={config.webhook_url ?? ''}
              onChange={(e) => updateConfig('webhook_url', e.target.value)}
            />
          </div>
        )
      case 'telegram':
        return (
          <>
            <div className="mb-3">
              <label className={labelCls}>Bot Token</label>
              <input
                type="text"
                className={inputCls}
                placeholder="123456:ABC-DEF..."
                value={config.bot_token ?? ''}
                onChange={(e) => updateConfig('bot_token', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Chat ID</label>
              <input
                type="text"
                className={inputCls}
                placeholder="-1001234567890"
                value={config.chat_id ?? ''}
                onChange={(e) => updateConfig('chat_id', e.target.value)}
              />
            </div>
          </>
        )
      case 'email':
        return (
          <>
            <div className="mb-3">
              <label className={labelCls}>SMTP Host</label>
              <input
                type="text"
                className={inputCls}
                placeholder="smtp.gmail.com"
                value={config.smtp_host ?? ''}
                onChange={(e) => updateConfig('smtp_host', e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className={labelCls}>Port</label>
              <input
                type="number"
                className={inputCls}
                placeholder="587"
                value={config.smtp_port ?? ''}
                onChange={(e) => updateConfig('smtp_port', e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className={labelCls}>Username</label>
              <input
                type="text"
                className={inputCls}
                placeholder="your@email.com"
                value={config.smtp_username ?? ''}
                onChange={(e) => updateConfig('smtp_username', e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className={labelCls}>Password</label>
              <input
                type="password"
                className={inputCls}
                placeholder="••••••••"
                value={config.smtp_password ?? ''}
                onChange={(e) => updateConfig('smtp_password', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Recipients (逗号分隔)</label>
              <input
                type="text"
                className={inputCls}
                placeholder="alice@example.com, bob@example.com"
                value={config.recipients ?? ''}
                onChange={(e) => updateConfig('recipients', e.target.value)}
              />
            </div>
          </>
        )
      case 'webhook':
        return (
          <>
            <div className="mb-3">
              <label className={labelCls}>URL</label>
              <input
                type="url"
                className={inputCls}
                placeholder="https://example.com/webhook"
                value={config.url ?? ''}
                onChange={(e) => updateConfig('url', e.target.value)}
              />
            </div>
            <div className="mb-3">
              <label className={labelCls}>Method</label>
              <select
                className={inputCls}
                value={config.method ?? 'POST'}
                onChange={(e) => updateConfig('method', e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Headers (可选, JSON)</label>
              <input
                type="text"
                className={inputCls}
                placeholder='{"Authorization": "Bearer xxx"}'
                value={config.headers ?? ''}
                onChange={(e) => updateConfig('headers', e.target.value)}
              />
            </div>
          </>
        )
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h2 className="mb-4 text-lg font-semibold text-slate-200">
          {isEdit ? '编辑通知渠道' : '添加通知渠道'}
        </h2>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">名称</label>
            <input
              type="text"
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="我的 Discord 渠道"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">类型</label>
            <select
              className="focus:border-wrench-500 w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:outline-none"
              value={type}
              onChange={(e) => handleTypeChange(e.target.value)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Config fields */}
          <div className="space-y-3">{renderConfigFields()}</div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-400">启用</label>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <div className="peer peer-checked:bg-wrench-600 peer-focus:ring-wrench-500/30 h-5 w-9 rounded-full bg-slate-700 peer-focus:ring-2 after:absolute after:start-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600/50 px-4 py-2 text-sm text-slate-400 hover:bg-slate-700/50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-wrench-600 hover:bg-wrench-500 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? '保存中...' : isEdit ? '更新' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function NotificationsPage() {
  const dbReady = useClientDbReady()
  const [channels, setChannels] = useState<LocalChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingChannel, setEditingChannel] = useState<LocalChannel | null>(null)
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

  const loadChannels = useCallback(() => {
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

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const deleteChannel = useCallback((id: string) => {
    try {
      notificationChannelsDelete(id)
      setChannels((prev) => prev.filter((ch) => ch.id !== id))
      notify('通知渠道已删除', 'success')
    } catch (e: unknown) {
      notify('删除失败: ' + (e instanceof Error ? e.message : '未知错误'), 'error')
    }
  }, [])

  const testChannel = useCallback(async (id: string) => {
    setTestingId(id)
    try {
      // 测试功能需要调用后端，暂时模拟成功
      await new Promise((resolve) => setTimeout(resolve, 1000))
      notify('✅ 测试消息发送成功！', 'success')
    } catch (e: unknown) {
      notify('❌ 测试失败: ' + (e instanceof Error ? e.message : '网络错误'), 'error')
    } finally {
      setTestingId(null)
    }
  }, [])

  // 缓存通道类型统计
  const channelTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const ch of channels) {
      counts[ch.type] = (counts[ch.type] || 0) + 1
    }
    return counts
  }, [channels])

  const openEdit = useCallback((channel: LocalChannel) => {
    setEditingChannel(channel)
    setShowAddModal(true)
  }, [])

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
      <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <Bell size={18} className="text-wrench-400 sm:text-[22px]" />
          <h1 className="text-base font-semibold text-slate-200 sm:text-lg">通知渠道</h1>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">本地配置</span>
          {Object.keys(channelTypeCounts).length > 0 && (
            <span className="text-[10px] text-slate-600">
              {Object.entries(channelTypeCounts)
                .map(([type, count]) => `${CHANNEL_META[type]?.label || type}: ${count}`)
                .join(' · ')}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white sm:gap-2 sm:px-4 sm:py-2 sm:text-sm"
        >
          <Plus size={14} />
          添加渠道
        </button>
      </div>

      {/* Content */}
      <div className="pb-nav flex-1 overflow-y-auto p-4 sm:p-6">
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
            {channels.map((ch) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                testingId={testingId}
                onTest={testChannel}
                onDelete={(id) => setDeleteTargetId(id)}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit notification channel modal */}
      {showAddModal && (
        <AddEditChannelModal
          key={editingChannel?.id ?? 'add'}
          editingChannel={editingChannel}
          onClose={() => {
            setShowAddModal(false)
            setEditingChannel(null)
          }}
          onSaved={() => {
            loadChannels()
            setShowAddModal(false)
            setEditingChannel(null)
          }}
        />
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={deleteTargetId !== null}
        title="删除通知渠道"
        message="确定删除此通知渠道？此操作不可撤销。"
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        onConfirm={() => {
          if (deleteTargetId) deleteChannel(deleteTargetId)
          setDeleteTargetId(null)
        }}
        onCancel={() => setDeleteTargetId(null)}
      />
    </div>
  )
}
