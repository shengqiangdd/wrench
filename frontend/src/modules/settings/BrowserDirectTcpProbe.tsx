import { useState, type FormEvent } from 'react'
import { Cable, ShieldAlert } from 'lucide-react'
import { getDirectSocketsStatus, openSshTcpProbe } from '../../services/browser-direct-tcp'

function unavailableReason(reason: ReturnType<typeof getDirectSocketsStatus>['reason']): string {
  if (reason === 'not-secure') return '需要安全上下文。'
  if (reason === 'not-isolated') return '当前页面未运行在跨源隔离的 IWA 中。'
  return '当前浏览器上下文没有 Direct Sockets API。'
}

export default function BrowserDirectTcpProbe() {
  const status = getDirectSocketsStatus()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  const probe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage('')
    setFailed(false)
    setBusy(true)
    try {
      await openSshTcpProbe(address, 22, (target, port) =>
        window.confirm(
          `Allow one TCP connection from this IWA to ${target}:${port}? No SSH authentication data will be sent.`,
        ),
      )
      setMessage(`TCP connection to ${address}:22 opened and closed. 未测试 SSH 协议。`)
    } catch (error) {
      setFailed(true)
      setMessage(error instanceof Error ? error.message : 'TCP 探测失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-5 rounded-lg border border-amber-700/40 bg-slate-900/60 p-4">
      <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Cable size={16} /> 浏览器 Direct Sockets（实验功能）
      </h4>
      <p className="mb-3 text-xs leading-5 text-slate-400">
        This is a TCP transport smoke test only. It does not implement SSH, verify host keys, or
        send passwords/private keys. Targets are restricted to private IP literals on port 22; each
        connect requires confirmation.
      </p>
      {!status.available ? (
        <p role="status" className="flex items-start gap-2 text-xs text-amber-200">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          Direct Sockets unavailable: {unavailableReason(status.reason)} Open the separately
          installed Chrome IWA to use this TCP probe. The normal Wrench web page cannot open raw TCP
          sockets.
        </p>
      ) : (
        <form onSubmit={(event) => void probe(event)} className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="browser-tcp-target">
            私网 IP 地址
          </label>
          <input
            id="browser-tcp-target"
            className="input min-w-[14rem] flex-1 font-mono text-xs"
            aria-label="私网 IP 地址"
            autoComplete="off"
            spellCheck={false}
            maxLength={45}
            placeholder="192.168.1.20 or fd00::20"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <span className="self-center text-xs text-slate-400">TCP 端口 22</span>
          <button className="btn-primary text-xs" type="submit" disabled={busy || !address}>
            {busy ? '正在连接…' : '确认并探测'}
          </button>
        </form>
      )}
      {message && (
        <p role={failed ? 'alert' : 'status'} className="mt-3 text-xs text-slate-300">
          {message}
        </p>
      )}
    </section>
  )
}
