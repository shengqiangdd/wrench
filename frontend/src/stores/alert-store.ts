/**
 * 健康告警引擎 Store
 *
 * 监控主机性能指标（CPU / 内存 / 磁盘），超过阈值时触发告警通知。
 * 告警历史持久化到 localStorage，通知通过 Toast 系统呈现。
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ─── 声音提醒 ───

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || ''

// 复用单例 AudioContext，避免频繁创建导致资源耗尽
let sharedAudioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContext()
    }
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume()
    return sharedAudioCtx
  } catch { return null }
}

function playAlertSound(severity: AlertSeverity, enabled: boolean) {
  if (!enabled) return
  try {
    const ctx = getAudioCtx()
    if (!ctx) return
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = severity === 'critical' ? 880 : 520
    osc.type = severity === 'critical' ? 'square' : 'sine'
    gain.gain.value = 0.15
    const duration = severity === 'critical' ? 0.6 : 0.3
    osc.start()
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.stop(ctx.currentTime + duration)
  } catch { /* AudioContext 不可用时静默失败 */ }
}

function syncAlertToBackend(event: AlertEvent) {
  fetch(`${BRIDGE_URL}/api/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      level: event.severity,
      host: event.hostName,
      metric: event.metric,
      message: `${METRIC_LABELS[event.metric]} 使用率 ${event.value}% 超过阈值 ${event.threshold}%`,
      value: event.value,
      threshold: event.threshold
    })
  }).catch(() => { /* 静默失败，不影响前端 */ })
}

// ─── 类型定义 ───

export type AlertMetric = 'cpu' | 'memory' | 'disk'
export type AlertSeverity = 'warning' | 'critical'

export interface AlertRule {
  id: string
  metric: AlertMetric
  /** 阈值百分比 (0-100) */
  threshold: number
  severity: AlertSeverity
  /** 是否启用 */
  enabled: boolean
  /** 连续触发几次才告警（防止瞬间抖动） */
  consecutive: number
}

export interface AlertEvent {
  id: string
  ruleId: string
  hostId: string
  hostName: string
  metric: AlertMetric
  value: number
  threshold: number
  severity: AlertSeverity
  timestamp: number
  /** 是否已通知（避免重复通知） */
  notified: boolean
}

interface AlertState {
  /** 告警规则 */
  rules: AlertRule[]
  /** 告警历史（最近 100 条） */
  history: AlertEvent[]
  /** 每个 host+metric 的连续超阈值计数器 */
  counters: Record<string, number>
  /** 全局告警开关 */
  enabled: boolean
  /** 声音提醒开关 */
  soundEnabled: boolean

  // 操作
  toggleEnabled: () => void
  toggleSound: () => void
  addRule: (rule: Omit<AlertRule, 'id'>) => void
  updateRule: (id: string, data: Partial<AlertRule>) => void
  deleteRule: (id: string) => void
  resetToDefaults: () => void
  /** 评估一条主机数据，返回触发的告警列表 */
  evaluate: (hostId: string, hostName: string, metrics: { cpu: number; memory: number; disk: number }) => AlertEvent[]
  clearHistory: () => void
}

// ─── 默认规则 ───

const DEFAULT_RULES: AlertRule[] = [
  { id: 'cpu-warning',    metric: 'cpu',    threshold: 80, severity: 'warning',  enabled: true, consecutive: 3 },
  { id: 'cpu-critical',   metric: 'cpu',    threshold: 95, severity: 'critical', enabled: true, consecutive: 2 },
  { id: 'mem-warning',    metric: 'memory', threshold: 85, severity: 'warning',  enabled: true, consecutive: 3 },
  { id: 'mem-critical',   metric: 'memory', threshold: 95, severity: 'critical', enabled: true, consecutive: 2 },
  { id: 'disk-warning',   metric: 'disk',   threshold: 85, severity: 'warning',  enabled: true, consecutive: 5 },
  { id: 'disk-critical',  metric: 'disk',   threshold: 95, severity: 'critical', enabled: true, consecutive: 3 },
]

let eventIdCounter = 0

// ─── Toast 通知辅助 ───

function notify(message: string, type: 'error' | 'info') {
  window.dispatchEvent(
    new CustomEvent('smartbox-notification', {
      detail: { message, type },
    }),
  )
}

const METRIC_LABELS: Record<AlertMetric, string> = {
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
}

// ─── Store ───

export const useAlertStore = create<AlertState>()(
  persist(
    (set, get) => ({
      rules: DEFAULT_RULES,
      history: [],
      counters: {},
      enabled: true,
      soundEnabled: true,

      toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),
      toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),

      addRule: (rule) => {
        const id = `${rule.metric}-${rule.severity}-${Date.now()}`
        set((s) => ({ rules: [...s.rules, { ...rule, id }] }))
      },

      updateRule: (id, data) => {
        set((s) => ({
          rules: s.rules.map((r) => {
            if (r.id !== id) return r
            const updated = { ...r, ...data }
            // 校验范围：阈值 1-100，连续次数 1-20
            if (updated.threshold !== undefined) updated.threshold = Math.min(100, Math.max(1, updated.threshold))
            if (updated.consecutive !== undefined) updated.consecutive = Math.min(20, Math.max(1, updated.consecutive))
            return updated
          }),
        }))
      },

      deleteRule: (id) => {
        set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }))
      },

      resetToDefaults: () => set({ rules: DEFAULT_RULES, history: [], counters: {} }),

      evaluate: (hostId, hostName, metrics) => {
        const state = get()
        if (!state.enabled) return []

        const fired: AlertEvent[] = []
        const newCounters = { ...state.counters }

        for (const rule of state.rules) {
          if (!rule.enabled) continue

          const key = `${hostId}:${rule.id}`
          const value = metrics[rule.metric]

          if (value >= rule.threshold) {
            // 超阈值，累加计数器
            newCounters[key] = (newCounters[key] || 0) + 1

            // 达到连续触发次数
            if (newCounters[key] >= rule.consecutive) {
              // 检查是否已在最近 60 秒内触发过相同告警（避免重复通知）
              const recentDuplicate = state.history.find(
                (e) =>
                  e.hostId === hostId &&
                  e.ruleId === rule.id &&
                  Date.now() - e.timestamp < 60_000,
              )

              if (!recentDuplicate) {
                const event: AlertEvent = {
                  id: `evt-${++eventIdCounter}-${Date.now()}`,
                  ruleId: rule.id,
                  hostId,
                  hostName,
                  metric: rule.metric,
                  value: Math.round(value * 10) / 10,
                  threshold: rule.threshold,
                  severity: rule.severity,
                  timestamp: Date.now(),
                  notified: true,
                }
                fired.push(event)

                // 播放提醒声音
                playAlertSound(rule.severity, get().soundEnabled)
                // 同步到后端持久化
                syncAlertToBackend(event)

                // 发送 Toast 通知
                const icon = rule.severity === 'critical' ? '🚨' : '⚠️'
                const label = METRIC_LABELS[rule.metric]
                notify(
                  `${icon} ${hostName}: ${label} 使用率 ${event.value}% 超过阈值 ${rule.threshold}%`,
                  rule.severity === 'critical' ? 'error' : 'info',
                )
              }

              // 重置计数器（触发后重新计数）
              newCounters[key] = 0
            }
          } else {
            // 低于阈值，重置计数器
            newCounters[key] = 0
          }
        }

        if (fired.length > 0 || Object.keys(newCounters).length !== Object.keys(state.counters).length) {
          set((s) => ({
            counters: newCounters,
            history: [...fired, ...s.history].slice(0, 100), // 保留最近 100 条
          }))
        }

        return fired
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'smartbox-alerts',
      partialize: (state) => ({
        rules: state.rules,
        history: state.history.slice(0, 50),
        enabled: state.enabled,
        soundEnabled: state.soundEnabled,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<AlertState>
        return {
          ...current,
          ...p,
          // 兼容旧数据：soundEnabled 缺失时默认 true
          soundEnabled: p.soundEnabled ?? true,
        }
      },
    },
  ),
)
