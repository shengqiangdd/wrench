/**
 * alert-store.ts — Zustand store for alert rules and history.
 *
 * Data is persisted in client-side SQLite (via sql.js).
 * Each browser/user has their own isolated alert data.
 */

import { create } from 'zustand'
import {
  alertRulesList,
  alertRulesUpsert,
  alertRulesDelete,
  alertRulesClear,
  alertHistoryList,
  alertHistoryInsert,
  alertHistoryClear,
  isDbReady,
} from '../services/client-db'
import { notify } from '../services/event-bus'
import type { AlertRuleRow } from '../services/client-db'

// ─── 类型定义 ───

export type AlertMetric = 'cpu' | 'memory' | 'disk'
export type AlertSeverity = 'warning' | 'critical'

export interface AlertRule {
  id: string
  metric: AlertMetric
  threshold: number
  severity: AlertSeverity
  enabled: boolean
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
  notified: boolean
}

interface AlertState {
  rules: AlertRule[]
  history: AlertEvent[]
  counters: Record<string, number>
  enabled: boolean
  soundEnabled: boolean
  dbLoaded: boolean

  toggleEnabled: () => void
  toggleSound: () => void
  addRule: (rule: Omit<AlertRule, 'id'>) => void
  updateRule: (id: string, data: Partial<AlertRule>) => void
  deleteRule: (id: string) => void
  resetToDefaults: () => void
  evaluate: (
    hostId: string,
    hostName: string,
    metrics: { cpu: number; memory: number; disk: number },
  ) => AlertEvent[]
  clearHistory: () => void
  loadFromDb: () => void
}

// ─── 默认规则 ───

const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'cpu-warning',
    metric: 'cpu',
    threshold: 80,
    severity: 'warning',
    enabled: true,
    consecutive: 3,
  },
  {
    id: 'cpu-critical',
    metric: 'cpu',
    threshold: 95,
    severity: 'critical',
    enabled: true,
    consecutive: 2,
  },
  {
    id: 'mem-warning',
    metric: 'memory',
    threshold: 85,
    severity: 'warning',
    enabled: true,
    consecutive: 3,
  },
  {
    id: 'mem-critical',
    metric: 'memory',
    threshold: 95,
    severity: 'critical',
    enabled: true,
    consecutive: 2,
  },
  {
    id: 'disk-warning',
    metric: 'disk',
    threshold: 85,
    severity: 'warning',
    enabled: true,
    consecutive: 5,
  },
  {
    id: 'disk-critical',
    metric: 'disk',
    threshold: 95,
    severity: 'critical',
    enabled: true,
    consecutive: 3,
  },
]

let eventIdCounter = 0

// ─── 声音提醒 ───

let sharedAudioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
      sharedAudioCtx = new AudioContext()
    }
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume()
    return sharedAudioCtx
  } catch {
    return null
  }
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
  } catch {
    /* AudioContext 不可用时静默失败 */
  }
}

// ─── Toast 通知辅助 ───
// notify moved to event-bus

const METRIC_LABELS: Record<AlertMetric, string> = {
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
}

// ─── SQLite 辅助 ───

function ruleToRow(r: AlertRule): AlertRuleRow {
  return {
    id: r.id,
    metric: r.metric,
    threshold: r.threshold,
    severity: r.severity,
    enabled: r.enabled ? 1 : 0,
    consecutive: r.consecutive,
  }
}

function rowToRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    metric: row.metric as AlertMetric,
    threshold: row.threshold,
    severity: row.severity as AlertSeverity,
    enabled: row.enabled === 1,
    consecutive: row.consecutive,
  }
}

function rowToEvent(row: {
  id: string
  ruleId: string
  hostId: string
  hostName: string
  metric: string
  value: number
  threshold: number
  severity: string
  timestamp: number
  notified: number
}): AlertEvent {
  return {
    id: row.id,
    ruleId: row.ruleId,
    hostId: row.hostId,
    hostName: row.hostName,
    metric: row.metric as AlertMetric,
    value: row.value,
    threshold: row.threshold,
    severity: row.severity as AlertSeverity,
    timestamp: row.timestamp,
    notified: row.notified === 1,
  }
}

// ─── Store ───

export const useAlertStore = create<AlertState>()((set, get) => ({
  rules: DEFAULT_RULES,
  history: [],
  counters: {},
  enabled: true,
  soundEnabled: true,
  dbLoaded: false,

  loadFromDb: () => {
    if (!isDbReady()) return
    const ruleRows = alertRulesList()
    const historyRows = alertHistoryList(100)
    const rules = ruleRows.length > 0 ? ruleRows.map(rowToRule) : DEFAULT_RULES
    const history = historyRows.map(rowToEvent)
    set({ rules, history, dbLoaded: true })

    // 如果规则表为空，写入默认规则
    if (ruleRows.length === 0) {
      for (const rule of DEFAULT_RULES) {
        alertRulesUpsert(ruleToRow(rule))
      }
    }
  },

  toggleEnabled: () => set((s) => ({ enabled: !s.enabled })),
  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),

  addRule: (rule) => {
    const id = `${rule.metric}-${rule.severity}-${Date.now()}`
    const newRule = { ...rule, id }
    set((s) => ({ rules: [...s.rules, newRule] }))
    if (isDbReady()) alertRulesUpsert(ruleToRow(newRule))
  },

  updateRule: (id, data) => {
    set((s) => ({
      rules: s.rules.map((r) => {
        if (r.id !== id) return r
        const updated = { ...r, ...data }
        if (updated.threshold !== undefined)
          updated.threshold = Math.min(100, Math.max(1, updated.threshold))
        if (updated.consecutive !== undefined)
          updated.consecutive = Math.min(20, Math.max(1, updated.consecutive))
        if (isDbReady()) alertRulesUpsert(ruleToRow(updated))
        return updated
      }),
    }))
  },

  deleteRule: (id) => {
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }))
    if (isDbReady()) alertRulesDelete(id)
  },

  resetToDefaults: () => {
    set({ rules: DEFAULT_RULES, history: [], counters: {} })
    if (isDbReady()) {
      alertRulesClear()
      alertHistoryClear()
      for (const rule of DEFAULT_RULES) {
        alertRulesUpsert(ruleToRow(rule))
      }
    }
  },

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
        newCounters[key] = (newCounters[key] || 0) + 1
        if (newCounters[key] >= rule.consecutive) {
          const recentDuplicate = state.history.find(
            (e) => e.hostId === hostId && e.ruleId === rule.id && Date.now() - e.timestamp < 60_000,
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
            playAlertSound(rule.severity, get().soundEnabled)
            const icon = rule.severity === 'critical' ? '🚨' : '⚠️'
            const label = METRIC_LABELS[rule.metric]
            notify(
              `${icon} ${hostName}: ${label} 使用率 ${event.value}% 超过阈值 ${rule.threshold}%`,
              rule.severity === 'critical' ? 'error' : 'info',
            )
            // 持久化到 SQLite
            if (isDbReady()) {
              alertHistoryInsert({
                id: event.id,
                ruleId: event.ruleId,
                hostId: event.hostId,
                hostName: event.hostName,
                metric: event.metric,
                value: event.value,
                threshold: event.threshold,
                severity: event.severity,
                timestamp: event.timestamp,
                notified: 1,
              })
            }
          }
          newCounters[key] = 0
        }
      } else {
        newCounters[key] = 0
      }
    }

    if (
      fired.length > 0 ||
      Object.keys(newCounters).length !== Object.keys(state.counters).length
    ) {
      set((s) => ({
        counters: newCounters,
        history: [...fired, ...s.history].slice(0, 100),
      }))
    }
    return fired
  },

  clearHistory: () => {
    set({ history: [] })
    if (isDbReady()) alertHistoryClear()
  },
}))

/** 触发 store 重新从 SQLite 读取 */
export const refreshAlertStore = () => {
  if (isDbReady()) {
    const ruleRows = alertRulesList()
    const historyRows = alertHistoryList(100)
    useAlertStore.setState({
      rules: ruleRows.length > 0 ? ruleRows.map(rowToRule) : DEFAULT_RULES,
      history: historyRows.map(rowToEvent),
      dbLoaded: true,
    })
  }
}
