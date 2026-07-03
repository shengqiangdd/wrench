/**
 * NotificationsPage.tsx — Notification Channel Management
 *
 * 配置外部通知渠道（Discord、Slack、Telegram、Email），
 * 用于接收 SmartBox 的告警通知。
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Bell,
  Plus,
  Trash2,
  Send,
  Check,
  X,
  Loader2,
  MessageSquare,
  Globe,
  Mail,
  MessageCircle,
} from 'lucide-react'
import { authedFetch } from '../../services/auth'

interface NotificationChannel {
  id: string
  name: string
  type: string
  config: Record<string, any>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

const CHANNEL_META: Record<string, { label: string; icon: any; color: string }> = {
  discord: { label: 'Discord', icon: MessageSquare, color: 'text-indigo-400' },
  slack: { label: 'Slack', icon: MessageCircle, color: 'text-green-400' },
  telegram: { label: 'Telegram', icon: Send, color: 'text-blue-400' },
  email: { label: 'Email', icon: Mail, color: 'text-amber-400' },
}

export default function NotificationsPage() {
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  const loadChannels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authedFetch('/api/notifications')
      const data = await res.json()
      setChannels(data.data || [])
    } catch (e: any) {
      setError(e.message || 'Failed to load channels')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  const deleteChannel = async (id: string) => {
    if (!confirm('确定删除此通知渠道？')) return
    try {
      await authedFetch(`/api/notifications/${id}`, { method: 'DELETE' })
      setChannels((prev) => prev.filter((ch) => ch.id !== id))
    } catch (e: any) {
      alert('删除失败: ' + (e.message || '未知错误'))
    }
  }

  const testChannel = async (id: string) => {
    setTestingId(id)
    try {
      const res = await authedFetch(`/api/notifications/test/${id}`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        alert('✅ 测试消息发送成功！')
      } else {
        alert('❌ 测试失败: ' + (data.error || '未知错误'))
      }
    } catch (e: any) {
      alert('❌ 测试失败: ' + (e.message || '网络错误'))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <Bell size={22} className="text-smartbox-400" />
          <h1 className="text-lg font-semibold text-slate-200">通知渠道</h1>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
            向外发送告警
          </span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-smartbox-600 hover:bg-smartbox-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
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
            <button
              onClick={loadChannels}
              className="text-smartbox-400 mt-2 text-sm hover:underline"
            >
              重试
            </button>
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-20 text-slate-500">
            <Bell size={40} />
            <p className="text-sm">还没有配置任何通知渠道</p>
            <p className="text-xs text-slate-600">
              配置后，告警将通过 Discord、Slack、Telegram 或 Email 发送给你
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-smartbox-400 mt-2 text-sm hover:underline"
            >
              添加第一个渠道
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {channels.map((ch) => {
              const meta = CHANNEL_META[ch.type] || {
                label: ch.type,
                icon: Globe,
                color: 'text-slate-400',
              }
              const Icon = meta.icon
              return (
                <div
                  key={ch.id}
                  className="group rounded-xl border border-slate-700/50 bg-slate-800/30 p-5 hover:border-slate-600/50"
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-lg bg-slate-800 p-2 ${meta.color}`}>
                        <Icon size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">{ch.name}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              ch.enabled
                                ? 'bg-emerald-900/30 text-emerald-400'
                                : 'bg-slate-700/50 text-slate-500'
                            }`}
                          >
                            {ch.enabled ? '启用' : '禁用'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">{meta.label}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteChannel(ch.id)}
                      className="rounded p-1.5 text-slate-500 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-900/30 hover:text-red-400"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Config preview */}
                  <div className="mb-4 space-y-1 rounded-lg bg-slate-900/50 p-3 font-mono text-xs text-slate-500">
                    {Object.entries(ch.config).map(([key, val]) => (
                      <div key={key} className="truncate">
                        <span className="text-slate-600">{key}: </span>
                        {String(val).length > 60 ? String(val).slice(0, 60) + '…' : String(val)}
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => testChannel(ch.id)}
                    disabled={testingId === ch.id}
                    className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700 hover:text-slate-300 disabled:opacity-50"
                  >
                    {testingId === ch.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Send size={12} />
                    )}
                    发送测试
                  </button>
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
          onCreated={(ch) => {
            setChannels((prev) => [ch, ...prev])
            setShowAddModal(false)
          }}
        />
      )}
    </div>
  )
}

type ChannelType = 'discord' | 'slack' | 'telegram' | 'email'

function AddChannelModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (ch: NotificationChannel) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('discord')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [botToken, setBotToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buildConfig = (): Record<string, any> => {
    switch (type) {
      case 'discord':
        return { webhookUrl }
      case 'slack':
        return { webhookUrl }
      case 'telegram':
        return { botToken, chatId }
      case 'email':
        return { smtpHost, smtpPort: parseInt(smtpPort) || 587, username, password, from, to }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }
    const config = buildConfig()
    if (!config.webhookUrl && type !== 'email') {
      setError('Webhook URL 不能为空')
      return
    }
    if (type === 'email' && (!smtpHost || !username || !from || !to)) {
      setError('请填写完整的 SMTP 配置')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await authedFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, config, enabled: true }),
      })
      const data = await res.json()
      if (data.data?.id) {
        onCreated({
          id: data.data.id,
          name: name.trim(),
          type,
          config,
          enabled: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
    } catch (e: any) {
      setError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const typeConfigFields = () => {
    switch (type) {
      case 'discord':
      case 'slack':
        return (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Webhook URL</label>
            <input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder={
                type === 'discord'
                  ? 'https://discord.com/api/webhooks/...'
                  : 'https://hooks.slack.com/services/...'
              }
            />
          </div>
        )
      case 'telegram':
        return (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Bot Token</label>
              <input
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Chat ID</label>
              <input
                value={chatId}
                onChange={(e) => setChatId(e.target.value)}
                className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                placeholder="-1001234567890"
              />
            </div>
          </>
        )
      case 'email':
        return (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-400">SMTP 服务器</label>
                <input
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">端口</label>
                <input
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                  placeholder="587"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                placeholder="user@gmail.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">密码</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                placeholder="应用专用密码"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">发件人</label>
                <input
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                  placeholder="alerts@yourdomain.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">收件人</label>
                <input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                  placeholder="admin@yourdomain.com"
                />
              </div>
            </div>
          </>
        )
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-200">添加通知渠道</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="focus:border-smartbox-500 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
              placeholder="例如：运维 Discord"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">类型</label>
            <div className="flex gap-2">
              {(['discord', 'slack', 'telegram', 'email'] as const).map((t) => {
                const meta = CHANNEL_META[t]
                const Icon = meta!.icon
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors ${
                      type === t
                        ? 'border-smartbox-500 bg-smartbox-600/20 text-smartbox-400'
                        : 'border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <Icon size={16} />
                    {meta!.label}
                  </button>
                )
              })}
            </div>
          </div>

          {typeConfigFields()}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 border-t border-slate-700/50 pt-4">
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
              className="bg-smartbox-600 hover:bg-smartbox-500 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
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
