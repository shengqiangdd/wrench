import { useState, useCallback, memo, useMemo } from 'react'
import {
  Trash2,
  Search,
  Download,
  Upload,
  Tag as TagIcon,
  X,
  Loader2,
  Info,
  Trash,
} from 'lucide-react'
import type { DockerImage } from './index'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const ev = new CustomEvent('wrench-toast', { detail: { message, type } })
  window.dispatchEvent(ev)
}

interface Props {
  connectionId: string
  images: DockerImage[]
  loading: boolean
  onRefresh: () => void
}

interface HistoryLayer {
  ID: string
  CreatedSince: string
  CreatedBy: string
  Size: string
  Comment: string
}

type ActionType = 'pull' | 'push' | 'tag' | 'prune'

function getActionLabel(type: ActionType) {
  const map: Record<ActionType, string> = {
    pull: '拉取',
    push: '推送',
    tag: '打标签',
    prune: '清理',
  }
  return map[type] || type
}

/** 确认删除弹窗 */
function ConfirmModal({
  title,
  message,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={onCancel}
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              danger ? 'bg-red-900/30' : 'bg-amber-900/30'
            }`}
          >
            {danger ? (
              <Trash2 size={18} className="text-red-400" />
            ) : (
              <Info size={18} className="text-amber-400" />
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-400">此操作不可恢复</p>
          </div>
        </div>
        <p className="mb-5 rounded-md bg-slate-800/60 px-3 py-2 text-xs text-slate-300">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-4 py-2 text-xs text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-wrench-600 hover:bg-wrench-500'
            }`}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}

function DockerImagesInner({ connectionId, images, loading, onRefresh }: Props) {
  const [filter, setFilter] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 模态框状态
  const [modal, setModal] = useState<{ type: ActionType; image?: DockerImage } | null>(null)
  const [modalInput, setModalInput] = useState('')
  const [modalInput2, setModalInput2] = useState('')
  const [modalLoading, setModalLoading] = useState(false)

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<DockerImage | null>(null)
  const [pruneConfirm, setPruneConfirm] = useState(false)

  // 详情面板
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null)
  const [history, setHistory] = useState<HistoryLayer[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inspectData, setInspectData] = useState<Record<string, unknown> | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'history' | 'inspect'>('history')

  const filtered = useMemo(() => {
    if (!filter) return images
    return images.filter(
      (img) =>
        img.Repository.toLowerCase().includes(filter.toLowerCase()) ||
        img.Tag.toLowerCase().includes(filter.toLowerCase()) ||
        img.ID.startsWith(filter),
    )
  }, [images, filter])

  // 删除镜像
  const doRmi = useCallback(
    async (img: DockerImage) => {
      const id = img.Repository === '<none>' ? img.ID : `${img.Repository}:${img.Tag}`
      setActionLoading(id)
      try {
        const res = await fetch('/api/docker/rmi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id }),
        })
        const json = (await res.json()) as ApiResponse
        if (!json.success) {
          notify(`删除失败: ${json.error || json.msg || '未知错误'}`, 'error')
        } else {
          notify(`已删除镜像 ${id.slice(0, 40)}`, 'success')
          if (selectedImage?.ID === img.ID) setSelectedImage(null)
          onRefresh()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误'
        notify(`删除请求失败: ${msg}`, 'error')
      } finally {
        setActionLoading(null)
      }
    },
    [connectionId, onRefresh, selectedImage],
  )

  // 打开操作对话框
  const openModal = useCallback((type: ActionType, image?: DockerImage) => {
    setModal({ type, image })
    if (type === 'tag' && image) {
      setModalInput(`${image.Repository}:${image.Tag}`)
      setModalInput2('')
    } else if (type === 'push' && image) {
      setModalInput(`${image.Repository}:${image.Tag}`)
    } else {
      setModalInput('')
      setModalInput2('')
    }
  }, [])

  // 执行操作
  const doAction = useCallback(async () => {
    if (!modal) return
    setModalLoading(true)
    try {
      let url = ''
      const body: Record<string, unknown> = { connectionId }

      if (modal.type === 'pull') {
        url = '/api/docker/pull'
        body.image = modalInput.trim()
      } else if (modal.type === 'push') {
        url = '/api/docker/push'
        body.image = modalInput.trim()
      } else if (modal.type === 'tag') {
        url = '/api/docker/tag'
        body.source = modalInput.trim()
        body.target = modalInput2.trim()
      } else if (modal.type === 'prune') {
        url = '/api/docker/prune'
        // 后端 prune_images 只需要 connectionId，不需要 all 字段
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as ApiResponse
      if (!json.success) {
        notify(
          `${getActionLabel(modal.type)}失败: ${json.error || json.msg || '未知错误'}`,
          'error',
        )
      } else {
        const output = (json.data?.data ?? json.data ?? '').toString()
        const msg = output ? output.trim().split('\n').pop() || '' : ''
        notify(`${getActionLabel(modal.type)}成功${msg ? ': ' + msg.slice(0, 80) : ''}`, 'success')
        setModal(null)
        onRefresh()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '未知错误'
      notify(`${getActionLabel(modal.type)}请求失败: ${msg}`, 'error')
    } finally {
      setModalLoading(false)
    }
  }, [modal, connectionId, onRefresh, modalInput, modalInput2])

  // 查看详情
  const showDetails = useCallback(
    async (img: DockerImage) => {
      // 如果点击已选中的图片，关闭面板
      if (selectedImage?.ID === img.ID && selectedImage?.Tag === img.Tag) {
        setSelectedImage(null)
        return
      }
      setSelectedImage(img)
      setDetailTab('history')
      setHistory([])
      setInspectData(null)
      setHistoryLoading(true)
      try {
        const res = await fetch('/api/docker/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id: img.ID }),
        })
        const json = (await res.json()) as ApiResponse
        if (json.success) {
          const output = (json.data?.data ?? json.data ?? '').toString()
          const lines = output.trim().split('\n').filter(Boolean)
          const list: HistoryLayer[] = lines
            .map((line: string) => {
              try {
                return JSON.parse(line)
              } catch {
                return null
              }
            })
            .filter(Boolean)
          setHistory(list)
        }
      } catch {
        /* ignore */
      }
      setHistoryLoading(false)
    },
    [connectionId, selectedImage],
  )

  const loadInspect = useCallback(async () => {
    if (!selectedImage) return
    setInspectLoading(true)
    try {
      const res = await fetch('/api/docker/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, id: selectedImage.ID }),
      })
      const json = (await res.json()) as ApiResponse
      if (json.success) {
        const inner = json.data?.data ?? json.data
        if (typeof inner === 'string') {
          try {
            setInspectData(JSON.parse(inner))
          } catch {
            setInspectData({ raw: inner })
          }
        } else if (typeof inner === 'object' && inner !== null) {
          setInspectData(inner as Record<string, unknown>)
        }
      }
    } catch {
      /* ignore */
    }
    setInspectLoading(false)
  }, [connectionId, selectedImage])

  const isDangling = (img: DockerImage) => img.Repository === '<none>'

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700/30 px-4 py-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索镜像名称 / 标签 / ID..."
            className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800/60 py-1.5 pr-3 pl-8 text-xs text-slate-300 placeholder-slate-500 outline-none"
          />
        </div>
        <button
          onClick={() => openModal('pull')}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-700 hover:text-slate-100"
        >
          <Download size={14} /> 拉取
        </button>
        <button
          onClick={() => setPruneConfirm(true)}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          <Trash size={14} /> 清理
        </button>
      </div>

      {/* 主区域：列表 + 详情面板 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 镜像列表 */}
        <div
          className={`flex flex-col overflow-hidden ${
            selectedImage ? 'w-1/2 border-r border-slate-700/30' : 'flex-1'
          }`}
        >
          <div className="flex-1 overflow-auto">
            {loading && images.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                {filter ? '未找到匹配的镜像' : '暂无镜像，点击"拉取"添加'}
              </div>
            ) : (
              <div className="divide-y divide-slate-800/50">
                {filtered.map((img) => {
                  const key = `${img.ID}-${img.Tag}`
                  const shortId = img.ID.replace('sha256:', '').slice(0, 12)
                  const id = img.Repository === '<none>' ? img.ID : `${img.Repository}:${img.Tag}`
                  const isLoading = actionLoading === id
                  const isActive = selectedImage?.ID === img.ID && selectedImage?.Tag === img.Tag

                  return (
                    <div
                      key={key}
                      onClick={() => showDetails(img)}
                      className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                        isActive ? 'bg-wrench-900/20' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      {/* 镜像信息 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`truncate text-sm font-medium ${
                              isActive ? 'text-wrench-300' : 'text-slate-200'
                            }`}
                          >
                            {isDangling(img) ? '<none>:<none>' : `${img.Repository}:${img.Tag}`}
                          </span>
                          {isDangling(img) && (
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

                      {/* 操作按钮 */}
                      <div
                        className="flex shrink-0 items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => setDeleteTarget(img)}
                          disabled={isLoading}
                          className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-red-400 disabled:opacity-40"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                        <button
                          onClick={() => openModal('push', img)}
                          disabled={isLoading}
                          className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300 disabled:opacity-40"
                          title="推送"
                        >
                          <Upload size={14} />
                        </button>
                        <button
                          onClick={() => openModal('tag', img)}
                          disabled={isLoading}
                          className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300 disabled:opacity-40"
                          title="打标签"
                        >
                          <TagIcon size={14} />
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

        {/* 详情面板 */}
        {selectedImage && (
          <div className="flex w-1/2 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center border-b border-slate-700/30 px-3 py-2">
              <button
                onClick={() => setDetailTab('history')}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  detailTab === 'history'
                    ? 'bg-slate-800 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                历史
              </button>
              <button
                onClick={() => {
                  setDetailTab('inspect')
                  if (!inspectData) loadInspect()
                }}
                className={`ml-1 rounded px-2.5 py-1 text-xs transition-colors ${
                  detailTab === 'inspect'
                    ? 'bg-slate-800 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                Inspect
              </button>
              <button
                onClick={() => setSelectedImage(null)}
                className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {detailTab === 'history' ? (
                historyLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={16} className="animate-spin text-slate-500" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">无历史记录</div>
                ) : (
                  <div className="space-y-1">
                    {history.map((layer, i) => (
                      <div
                        key={i}
                        className="rounded border border-slate-800/50 bg-slate-800/30 p-2"
                      >
                        <div className="text-[11px] text-slate-400">{layer.CreatedBy}</div>
                        <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-600">
                          <span>{layer.CreatedSince}</span>
                          <span>{layer.Size}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : inspectLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-slate-500" />
                </div>
              ) : inspectData ? (
                <pre className="overflow-auto font-mono text-[11px] leading-relaxed text-slate-400">
                  {JSON.stringify(inspectData, null, 2)}
                </pre>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500">无数据</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <ConfirmModal
          title="确认删除镜像"
          message={
            isDangling(deleteTarget)
              ? `删除悬空镜像 ${deleteTarget.ID.slice(0, 12)}...`
              : `删除镜像 ${deleteTarget.Repository}:${deleteTarget.Tag}`
          }
          danger
          onConfirm={() => {
            doRmi(deleteTarget)
            setDeleteTarget(null)
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* 清理确认弹窗 */}
      {pruneConfirm && (
        <ConfirmModal
          title="确认清理悬空镜像"
          message="将删除所有未被任何容器使用的悬空镜像（dangling images）"
          danger
          onConfirm={() => {
            setPruneConfirm(false)
            openModal('prune')
          }}
          onCancel={() => setPruneConfirm(false)}
        />
      )}

      {/* 操作模态框（pull / push / tag） */}
      {modal && modal.type !== 'prune' && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          onClick={() => setModal(null)}
        >
          <div
            className="mx-4 w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                {getActionLabel(modal.type)}镜像
              </h3>
              <button
                onClick={() => setModal(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            {modal.type === 'tag' ? (
              <>
                <label className="mb-1 block text-xs text-slate-400">源镜像</label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  className="focus:border-wrench-500/50 mb-3 w-full rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 outline-none"
                  placeholder="nginx:latest"
                />
                <label className="mb-1 block text-xs text-slate-400">目标标签</label>
                <input
                  type="text"
                  value={modalInput2}
                  onChange={(e) => setModalInput2(e.target.value)}
                  className="focus:border-wrench-500/50 mb-3 w-full rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 outline-none"
                  placeholder="my-registry.com/nginx:v1"
                />
              </>
            ) : (
              <>
                <label className="mb-1 block text-xs text-slate-400">镜像名称</label>
                <input
                  type="text"
                  value={modalInput}
                  onChange={(e) => setModalInput(e.target.value)}
                  className="focus:border-wrench-500/50 mb-3 w-full rounded-md border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-xs text-slate-300 outline-none"
                  placeholder="nginx:latest"
                  autoFocus
                />
              </>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-md px-4 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                取消
              </button>
              <button
                onClick={doAction}
                disabled={modalLoading || !modalInput.trim()}
                className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-1 rounded-md px-4 py-2 text-xs text-white disabled:opacity-50"
              >
                {modalLoading && <Loader2 size={12} className="animate-spin" />}
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(DockerImagesInner)
