/**
 * 告警规则配置面板
 *
 * 展示和编辑告警规则：阈值、严重级别、连续触发次数、启用/禁用。
 * 支持全局开关、恢复默认、添加自定义规则。
 */

import { useState } from 'react'
import {
  Bell,
  BellOff,
  Plus,
  Trash2,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Shield,
  ShieldAlert,
  Save,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useAlertStore } from '../../stores/alert-store'
import { notify } from '../../services/event-bus'
import type { AlertRule, AlertMetric, AlertSeverity } from '../../stores/alert-store'

const METRIC_OPTIONS: { value: AlertMetric; label: string }[] = [
  { value: 'cpu', label: 'CPU' },
  { value: 'memory', label: '内存' },
  { value: 'disk', label: '磁盘' },
]

const SEVERITY_OPTIONS: { value: AlertSeverity; label: string; color: string }[] = [
  { value: 'warning', label: '警告', color: 'text-amber-400' },
  { value: 'critical', label: '严重', color: 'text-red-400' },
]

function RuleRow({
  rule,
  onUpdate,
  onDelete,
}: {
  rule: AlertRule
  onUpdate: (data: Partial<AlertRule>) => void
  onDelete: () => void
}) {
  const metricLabel = METRIC_OPTIONS.find((m) => m.value === rule.metric)?.label || rule.metric
  const severityInfo = SEVERITY_OPTIONS.find((s) => s.value === rule.severity)

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        rule.enabled
          ? 'border-slate-700/50 bg-slate-800/40'
          : 'border-slate-800/30 bg-slate-900/30 opacity-60'
      }`}
    >
      {/* 启用开关 */}
      <button
        onClick={() => onUpdate({ enabled: !rule.enabled })}
        className="shrink-0"
        title={rule.enabled ? '点击禁用' : '点击启用'}
      >
        {rule.enabled ? (
          <Bell size={14} className="text-wrench-400" />
        ) : (
          <BellOff size={14} className="text-slate-600" />
        )}
      </button>

      {/* 指标 */}
      <span className="shrink-0 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
        {metricLabel}
      </span>

      {/* 严重级别 */}
      <span
        className={`shrink-0 text-[10px] font-medium ${severityInfo?.color || 'text-slate-400'}`}
      >
        {severityInfo?.label || rule.severity}
      </span>

      {/* 阈值 */}
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-500">阈值</span>
        <input
          type="number"
          min={1}
          max={100}
          value={rule.threshold}
          onChange={(e) =>
            onUpdate({ threshold: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })
          }
          className="focus:border-wrench-500/50 w-14 rounded border border-slate-700/50 bg-slate-900 px-1.5 py-0.5 text-center text-[11px] text-slate-300 outline-none"
        />
        <span className="text-[10px] text-slate-600">%</span>
      </div>

      {/* 连续触发 */}
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-slate-500">连续</span>
        <input
          type="number"
          min={1}
          max={20}
          value={rule.consecutive}
          onChange={(e) =>
            onUpdate({ consecutive: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })
          }
          className="focus:border-wrench-500/50 w-10 rounded border border-slate-700/50 bg-slate-900 px-1.5 py-0.5 text-center text-[11px] text-slate-300 outline-none"
        />
        <span className="text-[10px] text-slate-600">次</span>
      </div>

      {/* 删除 */}
      <button
        onClick={onDelete}
        className="ml-auto min-h-[44px] min-w-[44px] shrink-0 rounded p-1 text-slate-600 transition-colors hover:bg-red-900/20 hover:text-red-400"
        title="删除规则"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function AddRuleForm({ onClose }: { onClose: () => void }) {
  const addRule = useAlertStore((s) => s.addRule)
  const [metric, setMetric] = useState<AlertMetric>('cpu')
  const [severity, setSeverity] = useState<AlertSeverity>('warning')
  const [threshold, setThreshold] = useState(80)
  const [consecutive, setConsecutive] = useState(3)

  const handleAdd = () => {
    // 检查是否已存在相同 metric+severity 的规则
    const existing = useAlertStore.getState().rules
    const duplicate = existing.some((r) => r.metric === metric && r.severity === severity)
    if (duplicate) {
      notify(
        `已存在 ${METRIC_OPTIONS.find((m) => m.value === metric)?.label} - ${SEVERITY_OPTIONS.find((s) => s.value === severity)?.label} 规则`,
        'info',
      )
      return
    }
    addRule({ metric, severity, threshold, consecutive, enabled: true })
    onClose()
  }

  return (
    <div className="border-wrench-500/30 bg-wrench-900/10 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* 指标 */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">指标</span>
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as AlertMetric)}
            className="rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
          >
            {METRIC_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* 级别 */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">级别</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as AlertSeverity)}
            className="rounded border border-slate-700/50 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 outline-none"
          >
            {SEVERITY_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* 阈值 */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">阈值</span>
          <input
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            className="focus:border-wrench-500/50 w-14 rounded border border-slate-700/50 bg-slate-900 px-1.5 py-0.5 text-center text-[11px] text-slate-300 outline-none"
          />
          <span className="text-[10px] text-slate-600">%</span>
        </div>

        {/* 连续 */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-slate-500">连续</span>
          <input
            type="number"
            min={1}
            max={20}
            value={consecutive}
            onChange={(e) => setConsecutive(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            className="focus:border-wrench-500/50 w-10 rounded border border-slate-700/50 bg-slate-900 px-1.5 py-0.5 text-center text-[11px] text-slate-300 outline-none"
          />
          <span className="text-[10px] text-slate-600">次</span>
        </div>

        {/* 按钮 */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleAdd}
            className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-white transition-colors"
          >
            <Save size={11} />
            添加
          </button>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AlertSettings() {
  const {
    rules,
    enabled,
    soundEnabled,
    toggleEnabled,
    toggleSound,
    updateRule,
    deleteRule,
    resetToDefaults,
  } = useAlertStore()
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60">
      {/* 标题栏 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-700/20"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-slate-500" />
        ) : (
          <ChevronRight size={14} className="text-slate-500" />
        )}
        <Shield size={14} className="text-amber-400" />
        <span className="text-xs font-medium text-slate-300">告警规则</span>
        <span className="ml-1 text-[10px] text-slate-600">
          {rules.filter((r) => r.enabled).length}/{rules.length} 条启用
        </span>

        {/* 全局开关 */}
        <div className="ml-auto flex items-center gap-1.5">
          {/* 声音开关 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleSound()
            }}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              soundEnabled
                ? 'border border-blue-500/30 bg-blue-900/30 text-blue-400'
                : 'border border-slate-700/30 bg-slate-800 text-slate-500'
            }`}
            title={soundEnabled ? '点击关闭声音' : '点击开启声音'}
          >
            {soundEnabled ? <Volume2 size={10} /> : <VolumeX size={10} />}
            {soundEnabled ? '声音' : '静音'}
          </button>
          {/* 告警开关 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleEnabled()
            }}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
              enabled
                ? 'border border-green-500/30 bg-green-900/30 text-green-400'
                : 'border border-slate-700/30 bg-slate-800 text-slate-500'
            }`}
          >
            {enabled ? (
              <>
                <Bell size={10} /> 已启用
              </>
            ) : (
              <>
                <BellOff size={10} /> 已禁用
              </>
            )}
          </button>
        </div>
      </button>

      {/* 展开内容 */}
      {expanded && (
        <div className="max-h-72 space-y-2 overflow-auto border-t border-slate-700/30 px-3 py-3">
          {/* 规则列表 */}
          {rules.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-slate-600">暂无告警规则</p>
          ) : (
            <div className="space-y-1.5">
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onUpdate={(data) => updateRule(rule.id, data)}
                  onDelete={() => deleteRule(rule.id)}
                />
              ))}
            </div>
          )}

          {/* 添加规则 */}
          {showAdd ? (
            <AddRuleForm onClose={() => setShowAdd(false)} />
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowAdd(true)}
                className="hover:border-wrench-500/40 hover:text-wrench-300 flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors"
              >
                <Plus size={12} />
                添加规则
              </button>
              <button
                onClick={resetToDefaults}
                className="flex items-center gap-1 rounded-md border border-slate-600/50 px-2.5 py-1.5 text-[11px] text-slate-500 transition-colors hover:border-amber-500/40 hover:text-amber-300"
              >
                <RotateCcw size={12} />
                恢复默认
              </button>
            </div>
          )}

          {/* 说明 */}
          <p className="pt-1 text-[10px] leading-relaxed text-slate-600">
            <ShieldAlert size={10} className="mr-1 inline-block text-amber-500/60" />
            告警通过连续触发防止瞬间抖动：指标连续 N 次超过阈值才会触发通知。同一告警 60
            秒内不重复通知。
          </p>
        </div>
      )}
    </div>
  )
}
