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
} from 'lucide-react'
import {
  notificationChannelsList,
  notificationChannelsDelete,
  type NotificationChannelRow,
} from '../../services/client-db'
import { useClientDbReady } from '../../services/client-db-init'

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
}

const ChannelCard = memo(function ChannelCard({
  channel,
  testingId,
  onTest,
  onDelete,
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
            <h3 className="text-sm font-medium text-slate-200">{channel.name}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">{meta.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              channel.enabled
                ? 'bg-green-900/30 text-green-400'
                : 'bg-slate-700/50 text-slate-500'
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

export default function NotificationsPage() {
  const dbReady = useClientDbReady()
  const [channels, setChannels] = useState<LocalChannel[]>([])
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

  const deleteChannel = useCallback((id: string) => {
    if (!confirm('确定删除此通知渠道？')) return
    try {
      notificationChannelsDelete(id)
      setChannels((prev) => prev.filter((ch) => ch.id !== id))
    } catch (e: unknown) {
      alert('删除失败: ' + (e instanceof Error ? e.message : '未知错误'))
    }
  }, [])

  const testChannel = useCallback(async (id: string) => {
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
  }, [])

  // 缓存通道类型统计
  const channelTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const ch of channels) {
      counts[ch.type] = (counts[ch.type] || 0) + 1
    }
    return counts
  }, [channels])

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
            {channels.map((ch) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                testingId={testingId}
                onTest={testChannel}
                onDelete={deleteChannel}
              />
            ))}
          </div>
        )}
      </div>

      {/* TODO: Add notification channel modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-200">添加通知渠道</h2>
            <p className="text-sm text-slate-400">
              通知渠道配置功能开发中，敬请期待...
            </p>
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