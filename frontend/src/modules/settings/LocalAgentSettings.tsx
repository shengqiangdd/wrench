import { useEffect, useState } from 'react'
import { Laptop, Link2, Unlink } from 'lucide-react'
import { getLocalAgentPlatform } from '../../services/local-agent-platform'
import BrowserDirectTcpProbe from './BrowserDirectTcpProbe'
import {
  checkLocalAgent,
  clearLocalAgentSession,
  getLocalAgentSession,
  pairLocalAgent,
} from '../../services/local-agent'

export default function LocalAgentSettings() {
  const platform = getLocalAgentPlatform()
  const [agent, setAgent] = useState(getLocalAgentSession)
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!agent) return
    let active = true
    const check = async () => {
      const result = await checkLocalAgent(agent)
      if (active) setOnline(result)
    }
    void check()
    const timer = setInterval(() => void check(), 10_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [agent])

  const pair = async () => {
    setBusy(true)
    setMessage('')
    try {
      await pairLocalAgent(endpoint, token)
      setAgent(getLocalAgentSession())
      setToken('')
      setMessage('本机 Agent 已配对（仅当前标签页有效）')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '配对失败')
    } finally {
      setBusy(false)
    }
  }

  const unpair = () => {
    clearLocalAgentSession()
    setAgent(null)
    setMessage('已清除当前标签页中的 Agent 会话令牌')
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Laptop size={14} /> 本机 SSH Agent
      </h3>
      <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <p className="text-xs leading-5 text-slate-400">
          Agent 必须运行在打开此网页的同一台设备上，只监听 127.0.0.1 随机端口。每次连接必须在 Agent
          终端输入 yes；未知 SSH host key
          会显示并要求首次信任，之后密钥变化将拒绝连接。网页不会把本机模式密码或私钥发给 Wrench
          服务端。
        </p>
        <p className="text-[11px] text-slate-500">
          公网部署需使用 HTTPS；浏览器可能会询问是否允许本站访问本机网络。Agent
          只接受启动时指定的网页 origin。
        </p>
        {platform === 'android' && (
          <p className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
            Android：Agent 需要在这台手机上的 Termux 等本机终端运行。目前没有 Android
            下载包，也未完成 Termux 构建和真机浏览器验证；请把它视为实验路径。Agent
            必须保持运行，并在每次连接时切到终端批准。
          </p>
        )}
        {platform === 'ios' && (
          <p className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-200">
            iPhone/iPad：Safari 不能运行当前 Rust Agent，当前也没有 iOS
            Agent。请在连接表单中明确选择 Wrench
            服务端模式（要求服务端可达目标）；不会自动把本机连接改送到服务端。
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          在 Agent 所在设备构建并启动{' '}
          <code className="text-slate-300">wrench-agent https://你的-wrench-网页来源</code>，从
          Agent 终端复制随机地址和一次性令牌。浏览器只允许配对 http://127.0.0.1 地址。
        </p>
        {agent ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-700/40 bg-emerald-950/20 p-3">
            <span className={`text-xs ${online ? 'text-emerald-300' : 'text-amber-300'}`}>
              {online ? 'Agent 在线' : '配对已保存，Agent 离线'}：{agent.endpoint}
            </span>
            <button className="btn-secondary flex items-center gap-1.5 text-xs" onClick={unpair}>
              <Unlink size={13} />
              取消配对
            </button>
          </div>
        ) : platform === 'ios' ? (
          <p className="rounded border border-slate-700/50 p-3 text-xs text-slate-400">
            此设备不能启动受支持的本机 Agent，因此无法在这里配对。可以在同一台电脑运行 Agent
            后用那台电脑的浏览器连接，或在手机连接表单中手动选择服务端模式。
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input
              className="input font-mono text-xs"
              aria-label="Agent 地址"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://127.0.0.1:随机端口"
            />
            <input
              className="input font-mono text-xs"
              aria-label="一次性配对令牌"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="一次性配对令牌"
              autoComplete="off"
            />
            <button
              className="btn-primary flex items-center justify-center gap-1.5 text-xs"
              disabled={busy || !token}
              onClick={() => void pair()}
            >
              <Link2 size={14} />
              配对
            </button>
          </div>
        )}
        {message && (
          <p role="status" className="text-xs text-slate-300">
            {message}
          </p>
        )}
      </div>
      <BrowserDirectTcpProbe />
    </section>
  )
}
