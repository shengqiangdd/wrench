import { useState, useEffect, useReducer } from 'react'
import { authedFetch } from '../../services/auth'
import { X, Loader2, Cpu, HardDrive, Network, Box, Terminal } from 'lucide-react'
import type { DockerInspectInfo } from './index'
import DockerTerminal from './DockerTerminal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success?: boolean; data?: any; error?: string; msg?: string }

interface Props {
  connectionId: string
  containerId: string
  onClose: () => void
}

function Row({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex justify-between py-1 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="ml-4 max-w-[60%] truncate text-right text-slate-300">{value ?? '-'}</span>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-300">
        {icon} {title}
      </div>
      <div className="rounded-lg bg-slate-800/50 px-3 py-1">{children}</div>
    </div>
  )
}

interface DetailState {
  status: 'loading' | 'idle' | 'error'
  data: DockerInspectInfo | null
  error: string | null
}

type DetailAction =
  { type: 'start' } | { type: 'success'; data: DockerInspectInfo } | { type: 'fail'; error: string }

function detailReducer(_s: DetailState, a: DetailAction): DetailState {
  if (a.type === 'start') return { status: 'loading', data: null, error: null }
  if (a.type === 'success') return { status: 'idle', data: a.data, error: null }
  return { status: 'error', data: null, error: a.error }
}

export default function DockerDetail({ connectionId, containerId, onClose }: Props) {
  const [state, dispatch] = useReducer(detailReducer, {
    status: 'loading',
    data: null,
    error: null,
  })
  const [showTerminal, setShowTerminal] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      dispatch({ type: 'start' })
      try {
        const res = await authedFetch('/api/docker/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id: containerId }),
        })
        const json = (await res.json()) as ApiResponse
        if (cancelled) return
        if (json.success) {
          const inner = json.data?.data ?? json.data
          if (inner && typeof inner === 'object') {
            const parsed = Array.isArray(inner) ? inner[0] : inner
            dispatch({ type: 'success', data: parsed as DockerInspectInfo })
          } else if (typeof inner === 'string') {
            try {
              const parsed = JSON.parse(inner)
              dispatch({
                type: 'success',
                data: (Array.isArray(parsed) ? parsed[0] : parsed) as DockerInspectInfo,
              })
            } catch {
              dispatch({ type: 'fail', error: '详情数据解析失败' })
            }
          } else {
            dispatch({ type: 'fail', error: '详情数据为空' })
          }
        } else {
          const msg = json.error || json.msg || '获取详情失败'
          dispatch({ type: 'fail', error: msg })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : '请求失败'
          dispatch({ type: 'fail', error: msg })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, containerId])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="mx-4 flex h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-3">
          <Box size={16} className="text-wrench-400 mr-2" />
          <h2 className="text-sm font-semibold text-slate-200">容器详情</h2>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowTerminal(true)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-200"
              title="打开容器终端"
            >
              <Terminal size={14} />
              终端
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-300"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-auto p-4">
          {state.status === 'loading' ? (
            <div className="flex h-full items-center justify-center gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              加载中...
            </div>
          ) : state.status === 'error' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3">
              <p className="text-sm text-red-400">{state.error}</p>
            </div>
          ) : state.data ? (
            <div className="space-y-6">
              <Section icon={<Cpu size={14} />} title="基本信息">
                <Row label="名称" value={state.data.Name?.replace(/^\//, '')} />
                <Row label="主机名" value={state.data.Config?.Hostname} />
                <Row label="状态" value={state.data.State?.Status} />
                <Row label="PID" value={String(state.data.State?.Pid ?? '-')} />
                <Row label="退出码" value={String(state.data.State?.ExitCode ?? '-')} />
                <Row label="启动时间" value={state.data.State?.StartedAt} />
              </Section>
              <Section icon={<HardDrive size={14} />} title="配置">
                <Row label="镜像" value={state.data.Config?.Image} />
                <Row label="工作目录" value={state.data.Config?.WorkingDir} />
                <Row label="入口点" value={state.data.Config?.Entrypoint?.join(' ') || '-'} />
                <Row label="命令" value={state.data.Config?.Cmd?.join(' ') || '-'} />
              </Section>
              <Section icon={<Network size={14} />} title="网络">
                <Row label="IP 地址" value={state.data.NetworkSettings?.IPAddress} />
              </Section>
              {state.data.NetworkSettings?.Ports &&
                Object.keys(state.data.NetworkSettings.Ports).length > 0 && (
                  <Section icon={<Box size={14} />} title="端口映射">
                    {Object.entries(state.data.NetworkSettings.Ports).map(([port, bindings]) => {
                      const host = bindings?.[0]
                      return (
                        <Row
                          key={port}
                          label={port}
                          value={host ? `${host.HostIp || '0.0.0.0'}:${host.HostPort}` : '未映射'}
                        />
                      )
                    })}
                  </Section>
                )}
              {state.data.Config?.Env && state.data.Config.Env.length > 0 && (
                <Section icon={<HardDrive size={14} />} title="环境变量">
                  <div className="max-h-40 overflow-auto">
                    {state.data.Config.Env.map((env, i) => (
                      <div
                        key={i}
                        className="truncate py-0.5 font-mono text-[11px] text-slate-400"
                        title={env}
                      >
                        {env}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {showTerminal && (
        <DockerTerminal
          connectionId={connectionId}
          containerId={containerId}
          onClose={() => setShowTerminal(false)}
        />
      )}
    </div>
  )
}
