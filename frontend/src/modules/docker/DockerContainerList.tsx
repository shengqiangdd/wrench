import {
  useState,
  useCallback,
  useOptimistic,
  lazy,
  Suspense,
  startTransition,
  memo,
  useMemo,
} from 'react'
import { Play, Square, RotateCcw, Trash2, FileText, Search, Eye } from 'lucide-react'
import type { DockerContainer, ContainerStatus } from './index'
import { STATUS_DOTS } from './index'

const DockerContainerLogs = lazy(() => import('./DockerContainerLogs'))
const DockerDetail = lazy(() => import('./DockerDetail'))

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const ev = new CustomEvent('smartbox-toast', { detail: { message, type } })
  window.dispatchEvent(ev)
}

interface Props {
  connectionId: string
  containers: DockerContainer[]
  loading: boolean
  onRefresh: () => void
}

// 🔥 Memoized container row component for performance optimization
const ContainerRow = memo(function ContainerRow({
  c,
  actionLoading,
  doAction,
  onShowLogs,
  onShowDetail,
  isSelected,
}: {
  c: DockerContainer
  actionLoading: string | null
  doAction: (id: string, action: string) => void
  onShowLogs: (id: string) => void
  onShowDetail: (id: string) => void
  isSelected: boolean
}) {
  const shortId = c.ID.length > 12 ? c.ID.slice(0, 12) : c.ID
  const isRunning = c.State === 'running'
  const isLoading = actionLoading === shortId || actionLoading === c.Names
  const isSelfContainer = c.Names.includes('smartbox') || c.Names.includes('bridge')

  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-800/40 ${
        isSelected ? 'bg-slate-800/60' : ''
      }`}
    >
      {/* Status indicator */}
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[c.State] || 'bg-slate-500'}`}
      />

      {/* Name + Image */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-200">{c.Names}</span>
          <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500">
            {c.State}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="truncate">{c.Image}</span>
          <span>{c.RunningFor}</span>
          {c.Ports && <span className="truncate text-slate-600">{c.Ports}</span>}
        </div>
      </div>

      {/* Action buttons */}
      <div
        className="flex shrink-0 items-center gap-1 opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        {!isSelfContainer && (
          <>
            {isRunning ? (
              <button
                onClick={() => doAction(c.Names || shortId, 'stop')}
                disabled={isLoading}
                className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-amber-400 disabled:opacity-40"
                title="停止"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                onClick={() => doAction(c.Names || shortId, 'start')}
                disabled={isLoading}
                className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-emerald-400 disabled:opacity-40"
                title="启动"
              >
                <Play size={14} />
              </button>
            )}
            {c.State === 'exited' && (
              <button
                onClick={() => doAction(c.Names || shortId, 'rm')}
                disabled={isLoading}
                className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-red-400 disabled:opacity-40"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            )}
          </>
        )}
        <button
          onClick={() => onShowLogs(c.Names || shortId)}
          className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
          title="查看日志"
        >
          <FileText size={14} />
        </button>
        <button
          onClick={() => onShowDetail(c.Names || shortId)}
          className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
          title="查看详情"
        >
          <Eye size={14} />
        </button>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
      )}
    </div>
  )
})

/** 乐观更新：对指定容器执行状态切换而不等待 API */
function optimisticToggle(
  containers: DockerContainer[],
  id: string,
  action: string,
): DockerContainer[] {
  return containers.map((c) => {
    const matchId = c.Names || c.ID.slice(0, 12)
    if (matchId !== id) return c
    const newState = action === 'start' ? 'running' : action === 'stop' ? 'exited' : c.State
    return { ...c, State: newState }
  })
}

export default function DockerContainerList({
  connectionId,
  containers,
  loading,
  onRefresh,
}: Props) {
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logTarget, setLogTarget] = useState<string | null>(null)
  const [detailTarget, setDetailTarget] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [optimisticContainers, addOptimistic] = useOptimistic(
    containers,
    (state, { id, action }: { id: string; action: string }) => optimisticToggle(state, id, action),
  )

  // 🔥 Memoize filtered list to prevent unnecessary re-renders
  const filtered = useMemo(() => {
    if (!filter) return optimisticContainers
    return optimisticContainers.filter(
      (c) =>
        c.Names.toLowerCase().includes(filter.toLowerCase()) ||
        c.Image.toLowerCase().includes(filter.toLowerCase()) ||
        c.ID.startsWith(filter),
    )
  }, [optimisticContainers, filter])

  const doAction = useCallback(
    async (id: string, action: string) => {
      // 立即乐观更新 UI
      startTransition(() => addOptimistic({ id, action }))

      setActionLoading(id)
      try {
        const res = await fetch(`/api/docker/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id }),
        })
        const json = await res.json()
        if (!json.success) {
          notify(`${action} 失败: ${json.error || '未知错误'}`, 'error')
        } else {
          notify(`${action} 成功`, 'success')
          onRefresh()
        }
      } catch (err: any) {
        notify(`${action} 请求失败: ${err.message}`, 'error')
      } finally {
        setActionLoading(null)
      }
    },
    [connectionId, onRefresh, addOptimistic],
  )

  return (
    <div className="flex h-full flex-col">
      {/* 搜索栏 */}
      <div className="flex shrink-0 items-center border-b border-slate-700/30 px-4 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索容器名称 / 镜像 / ID..."
            className="focus:border-smartbox-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/60 py-1.5 pr-3 pl-8 text-xs text-slate-300 placeholder-slate-500 outline-none"
          />
        </div>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto">
        {loading && containers.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {filter ? '未找到匹配的容器' : '暂无容器'}
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {filtered.map((c) => {
              const shortId = c.ID.length > 12 ? c.ID.slice(0, 12) : c.ID
              const isSelected = selectedId === (c.Names || shortId)

              return (
                <ContainerRow
                  key={shortId}
                  c={c}
                  actionLoading={actionLoading}
                  doAction={doAction}
                  onShowLogs={setLogTarget}
                  onShowDetail={setDetailTarget}
                  isSelected={isSelected}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* 日志弹窗 */}
      {logTarget && (
        <Suspense fallback={null}>
          <DockerContainerLogs
            connectionId={connectionId}
            containerName={logTarget}
            onClose={() => setLogTarget(null)}
          />
        </Suspense>
      )}

      {/* 详情弹窗 */}
      {detailTarget && (
        <Suspense fallback={null}>
          <DockerDetail
            connectionId={connectionId}
            containerId={detailTarget}
            onClose={() => setDetailTarget(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
