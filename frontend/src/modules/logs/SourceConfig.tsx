import { useState } from 'react'
import { Plus, Trash2, RefreshCw, ChevronDown, ChevronRight, FileText } from 'lucide-react'
import type { LogSource, CustomSource } from './index'
import { PRESET_LOG_PATTERNS, STORAGE_KEY } from './index'

interface SourceConfigProps {
  connectionId: string
  currentPath: string | null
  onSelectPath: (path: string) => void
}

function loadConfig(): Record<string, CustomSource[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveConfig(config: Record<string, CustomSource[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

export default function SourceConfig({
  connectionId,
  currentPath,
  onSelectPath,
}: SourceConfigProps) {
  const [discoveredSources, setDiscoveredSources] = useState<LogSource[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [customSources, setCustomSources] = useState<CustomSource[]>(() => {
    const all = loadConfig()
    return all[connectionId] || []
  })
  const [newLabel, setNewLabel] = useState('')
  const [newPath, setNewPath] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [showCustom, setShowCustom] = useState(false)
  const [showDiscovered, setShowDiscovered] = useState(false)

  // 自动发现日志源
  const handleDiscover = async () => {
    setDiscovering(true)
    try {
      const res = await fetch('/api/logs/list-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId }),
      })
      const json = await res.json()
      if (json.success) {
        const lines = json.data.split('\n').filter(Boolean)
        const common: LogSource[] = []
        let inCommon = false
        for (const line of lines) {
          if (line === '---common---') {
            inCommon = true
            continue
          }
          if (inCommon) {
            const parts = line.trim().split(/\s+/)
            if (parts.length >= 2) {
              const size = parts[0]
              const path = parts.slice(1).join(' ')
              const label =
                PRESET_LOG_PATTERNS.find((p) => p.path === path)?.label ||
                path.split('/').pop() ||
                path
              common.push({ size, path, label })
            }
          }
        }
        setDiscoveredSources(common)
      }
    } catch {
      // ignore
    } finally {
      setDiscovering(false)
    }
  }

  // 添加自定义源
  const handleAddCustom = () => {
    if (!newLabel.trim() || !newPath.trim()) return
    const updated = [...customSources, { label: newLabel.trim(), path: newPath.trim() }]
    setCustomSources(updated)
    const all = loadConfig()
    all[connectionId] = updated
    saveConfig(all)
    setNewLabel('')
    setNewPath('')
    setShowAddForm(false)
  }

  // 删除自定义源
  const handleRemoveCustom = (index: number) => {
    const updated = customSources.filter((_, i) => i !== index)
    setCustomSources(updated)
    const all = loadConfig()
    all[connectionId] = updated
    saveConfig(all)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/30 px-3 py-2">
        <FileText size={16} className="text-slate-400" />
        <span className="text-xs font-medium text-slate-300">日志源</span>
        <button
          onClick={handleDiscover}
          disabled={discovering}
          className="ml-auto flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
        >
          <RefreshCw size={12} className={discovering ? 'animate-spin' : ''} />
          自动发现
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2">
        {/* 预定义源 */}
        <div className="mb-3">
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
          >
            {showCustom ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            📋 常用日志
          </button>
          {showCustom && (
            <div className="mt-1 space-y-0.5 pl-4">
              {PRESET_LOG_PATTERNS.map((src) => (
                <button
                  key={src.path}
                  onClick={() => onSelectPath(src.path)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                    currentPath === src.path
                      ? 'bg-smartbox-600/20 text-smartbox-400'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
                  }`}
                >
                  <FileText size={12} className="shrink-0" />
                  <span>{src.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-slate-600">{src.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 发现的源 */}
        {discoveredSources.length > 0 && (
          <div className="mb-3">
            <button
              onClick={() => setShowDiscovered(!showDiscovered)}
              className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 hover:bg-slate-800"
            >
              {showDiscovered ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              📡 已发现 ({discoveredSources.length})
            </button>
            {showDiscovered && (
              <div className="mt-1 space-y-0.5 pl-4">
                {discoveredSources.map((src) => (
                  <button
                    key={src.path}
                    onClick={() => onSelectPath(src.path)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
                      currentPath === src.path
                        ? 'bg-smartbox-600/20 text-smartbox-400'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
                    }`}
                  >
                    <FileText size={12} className="shrink-0" />
                    <span>{src.label}</span>
                    <span className="ml-auto text-[10px] text-slate-600">{src.size}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 自定义源 */}
        <div>
          <div className="flex items-center gap-1 px-2 py-1">
            <span className="text-xs text-slate-400">📌 自定义</span>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="ml-auto rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              <Plus size={14} />
            </button>
          </div>

          {showAddForm && (
            <div className="mb-2 rounded border border-slate-700 bg-slate-900/60 p-2">
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="名称（如: app-prod）"
                className="focus:border-smartbox-500 mb-1.5 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none"
              />
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="路径（如: /var/log/myapp/app.log）"
                className="focus:border-smartbox-500 mb-1.5 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleAddCustom}
                  disabled={!newLabel.trim() || !newPath.trim()}
                  className="bg-smartbox-600/80 hover:bg-smartbox-500 flex-1 rounded px-2 py-1 text-xs text-white transition-colors disabled:opacity-50"
                >
                  添加
                </button>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-600"
                >
                  取消
                </button>
              </div>
            </div>
          )}

          <div className="space-y-0.5 pl-2">
            {customSources.length === 0 && (
              <div className="px-2 py-3 text-center text-[10px] text-slate-600">
                点击 + 添加自定义日志路径
              </div>
            )}
            {customSources.map((src, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                  currentPath === src.path
                    ? 'bg-smartbox-600/20 text-smartbox-400'
                    : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                <button
                  onClick={() => onSelectPath(src.path)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <FileText size={12} className="shrink-0" />
                  <span className="truncate">{src.label}</span>
                </button>
                <button
                  onClick={() => handleRemoveCustom(i)}
                  className="shrink-0 rounded p-0.5 text-slate-600 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
