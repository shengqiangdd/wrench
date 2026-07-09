import { useState, useCallback, memo } from 'react'
import { Trash2, Search, Download, Upload, Tag as TagIcon, Layers, X } from 'lucide-react'
import type { DockerImage } from './index'

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

function DockerImagesInner({ connectionId, images, loading, onRefresh }: Props) {
  const [filter, setFilter] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 模态框状态
  const [modal, setModal] = useState<{ type: ActionType; image?: DockerImage } | null>(null)
  const [modalInput, setModalInput] = useState('')
  const [modalInput2, setModalInput2] = useState('')
  const [modalLoading, setModalLoading] = useState(false)

  // 详情面板
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null)
  const [history, setHistory] = useState<HistoryLayer[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inspectData, setInspectData] = useState<Record<string, unknown> | null>(null)
  const [inspectLoading, setInspectLoading] = useState(false)
  const [detailTab, setDetailTab] = useState<'history' | 'inspect'>('history')

  const filtered = filter
    ? images.filter(
        (img) =>
          img.Repository.toLowerCase().includes(filter.toLowerCase()) ||
          img.Tag.toLowerCase().includes(filter.toLowerCase()) ||
          img.ID.startsWith(filter),
      )
    : images

  // 删除镜像
  const doRmi = useCallback(
    async (id: string, force?: boolean) => {
      setActionLoading(id)
      try {
        const res = await fetch('/api/docker/rmi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id, force }),
        })
        const json = await res.json()
        if (!json.success) {
          notify(`删除失败: ${json.error || '未知错误'}`, 'error')
        } else {
          notify(`已删除镜像 ${id.slice(0, 12)}`, 'success')
          onRefresh()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '未知错误'
        notify(`删除请求失败: ${msg}`, 'error')
      } finally {
        setActionLoading(null)
      }
    },
    [connectionId, onRefresh],
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
        body.all = true
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
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
        const json = await res.json()
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
    [connectionId],
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
      const json = await res.json()
      if (json.success) {
        const output = (json.data?.data ?? json.data ?? '').toString()
        try {
          setInspectData(JSON.parse(output))
        } catch {
          setInspectData(output)
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
          onClick={() => openModal('prune')}
          className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
        >
          <Trash2 size={14} /> 清理
        </button>
      </div>

      {/* 主区域：列表 + 详情面板 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 镜像列表 */}
        <div
          className={`flex flex-col overflow-hidden ${selectedImage ? 'w-1/2 border-r border-slate-700/30' : 'flex-1'}`}
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
                  const isLoading =
                    actionLoading === shortId || actionLoading === `${img.Repository}:${img.Tag}`
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
                            className={`truncate text-sm font-medium ${isActive ? 'text-wrench-300' : 'text-slate-200'}`}
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

                      {/* 操作按钮（始终可见，兼容移动端） */}
                      <div
                        className="flex shrink-0 items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => openModal('push', img)}
                          className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          title="推送镜像"
                        >
                          <Upload size={13} />
                        </button>
                        <button
                          onClick={() => openModal('tag', img)}
                          className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200"
                          title="打标签"
                        >
                          <TagIcon size={13} />
                        </button>
                        <button
                          onClick={() => doRmi(img.ID, true)}
                          disabled={isLoading}
                          className="min-h-[44px] min-w-[44px] rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-700 hover:text-red-400 disabled:opacity-40"
                          title="删除镜像"
                        >
                          <Trash2 size={13} />
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
            {/* 详情头部 */}
            <div className="flex shrink-0 items-center border-b border-slate-700/30 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-200">
                  {isDangling(selectedImage)
                    ? '<none>:<none>'
                    : `${selectedImage.Repository}:${selectedImage.Tag}`}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedImage.ID.replace('sha256:', '').slice(0, 19)} · {selectedImage.Size} ·{' '}
                  {selectedImage.CreatedSince}
                </div>
              </div>
              <button
                onClick={() => setSelectedImage(null)}
                className="min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>

            {/* Tab 切换 */}
            <div className="flex shrink-0 border-b border-slate-700/30 px-4">
              <button
                onClick={() => setDetailTab('history')}
                className={`flex items-center gap-1 border-b-2 px-3 py-2 text-xs transition-colors ${
                  detailTab === 'history'
                    ? 'border-wrench-400 text-slate-200'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Layers size={12} /> 构建历史
              </button>
              <button
                onClick={() => {
                  setDetailTab('inspect')
                  if (!inspectData) loadInspect()
                }}
                className={`flex items-center gap-1 border-b-2 px-3 py-2 text-xs transition-colors ${
                  detailTab === 'inspect'
                    ? 'border-wrench-400 text-slate-200'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Search size={12} /> 详情
              </button>
            </div>

            {/* 历史内容 */}
            {detailTab === 'history' && (
              <div className="flex-1 overflow-auto">
                {historyLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
                  </div>
                ) : history.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    {selectedImage ? '无法获取构建历史' : '选择一个镜像查看详情'}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/50">
                    {history.map((layer, i) => (
                      <div key={i} className="px-4 py-2 transition-colors hover:bg-slate-800/30">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                            {layer.ID ? layer.ID.slice(0, 12) : '---'}
                          </span>
                          <span className="text-[11px] text-slate-500">{layer.Size || '0 B'}</span>
                          <span className="text-[11px] text-slate-500">
                            {layer.CreatedSince || ''}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                          {layer.CreatedBy || '(空)'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Inspect 内容 */}
            {detailTab === 'inspect' && (
              <div className="flex-1 overflow-auto">
                {inspectLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-500" />
                  </div>
                ) : !inspectData ? (
                  <div className="flex h-full items-center justify-center text-xs text-slate-500">
                    加载中...
                  </div>
                ) : (
                  <pre className="p-4 font-mono text-[11px] leading-relaxed text-slate-400">
                    {JSON.stringify(inspectData, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 操作模态框 */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[440px] rounded-lg border border-slate-700/50 bg-slate-900 shadow-2xl">
            <div className="flex items-center border-b border-slate-700/30 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-200">{getActionTitle(modal.type)}</h3>
              <button
                onClick={() => setModal(null)}
                className="ml-auto min-h-[44px] min-w-[44px] rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {modal.type === 'pull' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">镜像名称</label>
                  <input
                    type="text"
                    value={modalInput}
                    onChange={(e) => setModalInput(e.target.value)}
                    placeholder="例如: nginx:latest 或 ubuntu:22.04"
                    className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && doAction()}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    输入完整的镜像名称（支持 registry 地址）
                  </p>
                </div>
              )}

              {modal.type === 'push' && (
                <div>
                  <label className="mb-1 block text-xs text-slate-400">镜像名称</label>
                  <input
                    type="text"
                    value={modalInput}
                    onChange={(e) => setModalInput(e.target.value)}
                    placeholder="registry.example.com/myimage:latest"
                    className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && doAction()}
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    需要先登录目标 registry（在服务器上 docker login）
                  </p>
                </div>
              )}

              {modal.type === 'tag' && (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">源镜像</label>
                    <input
                      type="text"
                      value={modalInput}
                      onChange={(e) => setModalInput(e.target.value)}
                      className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">新标签</label>
                    <input
                      type="text"
                      value={modalInput2}
                      onChange={(e) => setModalInput2(e.target.value)}
                      placeholder="例如: myrepo/myimage:v2"
                      className="focus:border-wrench-500/50 w-full rounded-md border border-slate-700/50 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && doAction()}
                    />
                  </div>
                </>
              )}

              {modal.type === 'prune' && (
                <div className="rounded-lg border border-amber-900/30 bg-amber-950/20 p-3">
                  <p className="text-xs text-amber-400">
                    将清理所有未使用的镜像（dangling images
                    和未被任何容器引用的镜像）。此操作不可撤销。
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-700/30 px-4 py-3">
              <button
                onClick={() => setModal(null)}
                className="rounded-md px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                取消
              </button>
              <button
                onClick={doAction}
                disabled={modalLoading || (modal.type !== 'prune' && !modalInput.trim())}
                className="bg-wrench-600 hover:bg-wrench-500 flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-white transition-colors disabled:opacity-50"
              >
                {modalLoading && (
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                )}
                {getActionLabel(modal.type)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function getActionLabel(type: ActionType): string {
  switch (type) {
    case 'pull':
      return '拉取'
    case 'push':
      return '推送'
    case 'tag':
      return '打标签'
    case 'prune':
      return '清理'
  }
}

function getActionTitle(type: ActionType): string {
  switch (type) {
    case 'pull':
      return '拉取镜像'
    case 'push':
      return '推送镜像'
    case 'tag':
      return '打标签'
    case 'prune':
      return '清理未使用镜像'
  }
}

export default memo(DockerImagesInner)
