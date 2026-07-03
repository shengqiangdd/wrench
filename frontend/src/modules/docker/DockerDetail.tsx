import { useState, useEffect } from 'react'
import { X, Loader2, Cpu, HardDrive, Network, Box, Terminal } from 'lucide-react'
import type { DockerInspectInfo } from './index'
import DockerTerminal from './DockerTerminal'

function notify(message: string, type: 'success' | 'error' | 'info' = 'info') {
  const ev = new CustomEvent('smartbox-toast', { detail: { message, type } })
  window.dispatchEvent(ev)
}

interface Props {
  connectionId: string
  containerId: string
  onClose: () => void
}

export default function DockerDetail({ connectionId, containerId, onClose }: Props) {
  const [data, setData] = useState<DockerInspectInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTerminal, setShowTerminal] = useState(false)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/docker/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionId, id: containerId }),
        })
        const json = await res.json()
        if (json.success) {
          const parsed = JSON.parse(json.data)
          setData(Array.isArray(parsed) ? parsed[0] : parsed)
        } else {
          notify(json.error || '获取详情失败', 'error')
          onClose()
        }
      } catch (err: any) {
        notify(err.message || '请求失败', 'error')
        onClose()
      } finally {
        setLoading(false)
      }
    })()
  }, [connectionId, containerId, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 flex h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
        {/* 标题 */}
        <div className="flex shrink-0 items-center border-b border-slate-700/50 px-4 py-3">
          <Box size={16} className="text-smartbox-400 mr-2" />
          <h2 className="text-sm font-semibold text-slate-200">容器详情 — {containerId}</h2>
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
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              加载中...
            </div>
          ) : data ? (
            <div className="space-y-6">
              {/* 基本信息 */}
              <Section icon={<Cpu size={14} />} title="基本信息">
                <Row label="名称" value={data.Name?.replace(/^\//, '')} />
                <Row label="主机名" value={data.Config?.Hostname} />
                <Row label="状态" value={data.State?.Status} />
                <Row label="PID" value={String(data.State?.Pid)} />
                <Row label="退出码" value={String(data.State?.ExitCode)} />
                <Row label="启动时间" value={data.State?.StartedAt} />
              </Section>

              {/* 配置 */}
              <Section icon={<HardDrive size={14} />} title="配置">
                <Row label="镜像" value={data.Config?.Image} />
                <Row label="工作目录" value={data.Config?.WorkingDir} />
                <Row label="入口点" value={data.Config?.Entrypoint?.join(' ') || '-'} />
                <Row label="命令" value={data.Config?.Cmd?.join(' ') || '-'} />
              </Section>

              {/* 环境变量 */}
              <Section icon={<Box size={14} />} title="环境变量">
                <div className="max-h-40 overflow-y-auto rounded-md bg-slate-800/50 p-2 font-mono text-xs text-slate-400">
                  {data.Config?.Env?.length
                    ? data.Config.Env.map((env, i) => <div key={i}>{env}</div>)
                    : '(无环境变量)'}
                </div>
              </Section>

              {/* 挂载点 */}
              <Section icon={<HardDrive size={14} />} title="挂载点">
                {data.Mounts?.length ? (
                  <div className="space-y-1">
                    {data.Mounts.map((m, i) => (
                      <div key={i} className="rounded-md bg-slate-800/50 p-2 text-xs">
                        <div className="text-slate-400">类型: {m.Type}</div>
                        <div className="text-slate-400">
                          源: <span className="text-slate-300">{m.Source}</span>
                        </div>
                        <div className="text-slate-400">
                          目标: <span className="text-slate-300">{m.Destination}</span>
                        </div>
                        <div className="text-slate-400">权限: {m.RW ? '读写' : '只读'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">(无挂载点)</div>
                )}
              </Section>

              {/* 网络 */}
              <Section icon={<Network size={14} />} title="网络">
                <Row label="IP 地址" value={data.NetworkSettings?.IPAddress || '-'} />
                {data.NetworkSettings?.Ports && (
                  <div className="text-xs text-slate-400">
                    <span className="font-medium text-slate-500">端口映射: </span>
                    <pre className="mt-1 rounded-md bg-slate-800/50 p-2 text-slate-400">
                      {JSON.stringify(data.NetworkSettings.Ports, null, 2)}
                    </pre>
                  </div>
                )}
              </Section>

              {/* 重启策略 */}
              <Section icon={<Box size={14} />} title="重启策略">
                <Row label="策略" value={data.HostConfig?.RestartPolicy?.Name || 'none'} />
                <Row
                  label="最大重试"
                  value={String(data.HostConfig?.RestartPolicy?.MaximumRetryCount || 0)}
                />
              </Section>
            </div>
          ) : null}
        </div>
      </div>

      {/* 容器终端弹层 */}
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
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex text-xs">
      <span className="w-20 shrink-0 text-slate-500">{label}</span>
      <span className="text-slate-300">{value || '-'}</span>
    </div>
  )
}
