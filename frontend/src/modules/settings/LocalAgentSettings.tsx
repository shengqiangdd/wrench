import { useEffect, useState } from 'react'
import { Laptop, Link2, Unlink } from 'lucide-react'
import {
  checkLocalAgent,
  clearLocalAgentSession,
  getLocalAgentSession,
  pairLocalAgent,
} from '../../services/local-agent'

export default function LocalAgentSettings() {
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
          Agent 运行在你的电脑上，只监听 127.0.0.1 随机端口。每次连接必须在 Agent 终端输入 yes；未知
          SSH host key
          会显示并要求首次信任，之后密钥变化将拒绝连接。网页不会把本机模式密码或私钥发给 Wrench
          服务端。
        </p>
        <p className="text-[11px] text-slate-500">
          公网部署需使用 HTTPS；浏览器可能会询问是否允许本站访问本机网络。Agent
          只接受启动时指定的网页 origin。
        </p>
        <p className="text-[11px] text-slate-500">
          先从 Wrench 项目构建并启动{' '}
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
    </section>
  )
}
