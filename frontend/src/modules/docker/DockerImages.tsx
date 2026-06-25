import { useState, useCallback } from 'react'
import { Trash2, Search, RefreshCw } from 'lucide-react'
import type { DockerImage } from './index'

interface Props {
  connectionId: string
  images: DockerImage[]
  loading: boolean
  onRefresh: () => void
}

export default function DockerImages({ connectionId, images, loading, onRefresh }: Props) {
  const [filter, setFilter] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = filter
    ? images.filter((img) =>
        img.Repository.toLowerCase().includes(filter.toLowerCase()) ||
        img.Tag.toLowerCase().includes(filter.toLowerCase()) ||
        img.ID.startsWith(filter)
      )
    : images

  const doAction = useCallback(async (id: string, force?: boolean) => {
    setActionLoading(id)
    setError(null)
    try {
      const res = await fetch('/api/docker/rmi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, id, force }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(`删除失败: ${json.error || '未知错误'}`)
      } else {
        onRefresh()
      }
    } catch (err: any) {
      setError(`删除请求失败: ${err.message}`)
    } finally {
      setActionLoading(null)
    }
  }, [connectionId, onRefresh])

  return (
    <div className="flex h-full flex-col">
      {/* 搜索 */}
      <div className="flex shrink-0 items-center border-b border-slate-700/30 px-4 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索镜像名称 / 标签 / ID..."
            className="w-full rounded-md border border-slate-700/50 bg-slate-800/60 py-1.5 pl-8 pr-3 text-xs text-slate-300 placeholder-slate-500 outline-none focus:border-smartbox-500/50"
          />
        </div>
      </div>

      {/* 错误 */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-900/30 bg-red-950/20 px-4 py-2 text-xs text-red-400">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-300">✕</button>
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-auto">
        {loading && images.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            {filter ? '未找到匹配的镜像' : '暂无镜像'}
          </div>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {filtered.map((img) => {
              const shortId = img.ID.replace('sha256:', '').slice(0, 12)
              const isLoading = actionLoading === shortId || actionLoading === `${img.Repository}:${img.Tag}`

              return (
                <div
                  key={`${img.ID}-${img.Tag}`}
                  className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-slate-800/40"
                >
                  {/* 镜像信息 */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-200">
                        {img.Repository}:{img.Tag}
                      </span>
                      {img.Repository === '<none>' && (
                        <span className="shrink-0 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
                          dangling
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono">{shortId}</span>
                      <span>{img.Size}</span>
                      <span>{img.CreatedSince}</span>
                    </div>
                  </div>

                  {/* 操作 */}
                  <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                    <button
                      onClick={() => doAction(img.ID, true)}
                      disabled={isLoading}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-red-400 disabled:opacity-40"
                      title="删除镜像"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {isLoading && (
                    <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
