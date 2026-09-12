/**
 * AccountSection.tsx — 账户与登录状态 + 私有空间
 *
 * 三块内容：
 * 1. 登录与安全：会话有效期、退出登录。
 * 2. 门户口令：在网页里修改（服务端只存 PBKDF2 哈希）。
 * 3. 我的空间：空间码（唯一凭据）、换设备/换浏览器时的「用空间码进入」、重新生成码。
 *
 * 说明：本实例「人人平等」，没有管理员角色；但每个人的主机、Vault、定时任务、
 * 通知渠道、审计记录都按空间隔离，别人看不到。
 */

import { useCallback, useEffect, useState } from 'react'
import { Copy, KeyRound, LogOut, RefreshCw, ShieldAlert, ShieldCheck, Users } from 'lucide-react'

import {
  attachSpace,
  changePassword,
  clearSpaceResetFlag,
  getSession,
  getSpaceCode,
  getSpaceInfo,
  logout,
  reloadPage,
  rotateSpaceCode,
  wasSpaceReset,
  type SpaceInfo,
} from '../../services/auth'

function fmtTime(value: string): string {
  if (!value) return '未知'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false })
}

export default function AccountSection() {
  const session = getSession()
  const [confirming, setConfirming] = useState(false)

  const expiryText = session?.exp
    ? new Date(session.exp).toLocaleString('zh-CN', { hour12: false })
    : '未知'

  const handleLogout = async () => {
    setConfirming(false)
    const { getWsClientSync } = await import('../../services/websocket')
    try {
      getWsClientSync().disconnect()
    } catch (err) {
      console.warn('[Account] failed to disconnect WS before logout:', err)
    }
    logout()
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
          <ShieldCheck size={14} />
          登录与安全
        </h3>

        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
            <ShieldAlert size={14} className="text-emerald-500" />
            <span>已登录（服务端校验）</span>
          </div>
          <p className="mb-4 text-[11px] text-slate-500">
            当前会话有效期至 <span className="text-slate-300">{expiryText}</span>。
            令牌由入口口令签发；修改口令后所有已签发令牌立即失效，需要重新登录。
          </p>

          {confirming ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleLogout()}
                className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                确认退出
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="flex items-center gap-2 rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
            >
              <LogOut size={14} />
              退出登录
            </button>
          )}
        </div>
      </section>

      <PasswordSection />
      <SpaceSection />
    </div>
  )
}

/** 修改门户口令（在网页里完成，不需要再碰 .env / docker exec） */
function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setError(null)
    setDone(false)
    if (next.length < 8) {
      setError('新口令至少 8 位')
      return
    }
    if (next !== confirm) {
      setError('两次输入的新口令不一致')
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <KeyRound size={14} />
        入口口令
      </h3>

      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <p className="mb-4 text-[11px] text-slate-500">
          服务端只保存 PBKDF2 哈希，明文不落盘。修改后所有人需要重新登录一次，
          <span className="text-slate-300">各自的私有空间数据不受影响</span>。
        </p>

        <div className="grid gap-2 sm:grid-cols-3">
          <input
            data-testid="pw-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="当前口令"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500"
          />
          <input
            data-testid="pw-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="新口令（≥8 位）"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500"
          />
          <input
            data-testid="pw-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="确认新口令"
            className="rounded border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500"
          />
        </div>

        {error && <p className="mt-3 text-[11px] text-red-400">{error}</p>}
        {done && <p className="mt-3 text-[11px] text-emerald-400">口令已更新</p>}

        <button
          data-testid="pw-submit"
          onClick={() => void submit()}
          disabled={busy || !current || !next}
          className="mt-4 rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? '提交中...' : '修改口令'}
        </button>
      </div>
    </section>
  )
}

/** 我的空间：空间码 + 进入其他空间 + 重新生成码 */
function SpaceSection() {
  const [info, setInfo] = useState<SpaceInfo | null>(null)
  const [code, setCode] = useState<string | null>(() => getSpaceCode())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 之前会话里空间码失效过 → 服务端已给了一个空空间，提醒用户可以把旧码贴回来
  const [wasReset] = useState(() => wasSpaceReset())

  useEffect(() => {
    if (wasReset) clearSpaceResetFlag()
  }, [wasReset])

  const refresh = useCallback(async () => {
    try {
      setInfo(await getSpaceInfo())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    // 延到下一个任务：避免在 effect 内同步 setState
    const timer = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(timer)
  }, [refresh])

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setNotice('空间码已复制')
    } catch {
      setNotice('复制失败，请手动选中复制')
    }
  }

  const doAttach = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const nextInfo = await attachSpace(input.trim())
      setInfo(nextInfo)
      setCode(getSpaceCode())
      setInput('')
      setNotice('已切换到该空间，正在重新加载…')
      // 数据域整体换了一套，直接刷新最稳妥
      setTimeout(() => reloadPage(), 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const doRotate = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const newCode = await rotateSpaceCode()
      setCode(newCode)
      setNotice('已生成新空间码，旧码立即失效。请把新码保存到安全的地方。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Users size={14} />
        我的空间
      </h3>

      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <p className="mb-4 text-[11px] text-slate-500">
          本实例人人平等，每个人都用独立空间：你的 SSH 主机、Vault、定时任务、通知渠道与审计记录
          <span className="text-slate-300"> 只属于你</span>，其他人的浏览器看不到。
          换设备时用下面的空间码找回自己的数据。
        </p>

        {wasReset && (
          <p
            data-testid="space-reset-notice"
            className="mb-4 rounded border border-amber-700/60 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300"
          >
            原来的空间码已失效（可能被在别处重新生成）。已自动为你新建一个空空间；
            如果这不是你要的，请在下面「用空间码进入」粘贴正确的空间码，数据会立刻回来。
          </p>
        )}

        <dl className="mb-4 grid gap-1 text-[11px] text-slate-500 sm:grid-cols-2">
          <div>
            空间 ID：<span className="font-mono text-slate-300">{info?.id ?? '…'}</span>
          </div>
          <div>
            创建于：<span className="text-slate-300">{info ? fmtTime(info.createdAt) : '…'}</span>
          </div>
          <div>
            最近使用：<span className="text-slate-300">{info ? fmtTime(info.lastSeenAt) : '…'}</span>
          </div>
          <div>
            数据量：
            <span className="text-slate-300">
              {info?.counts?.reduce((sum, c) => sum + c.count, 0) ?? '…'} 条
            </span>
          </div>
        </dl>

        <div className="mb-2 text-xs text-slate-400">空间码（本机唯一凭据）</div>
        {code ? (
          <div className="mb-3 flex items-center gap-2">
            <code
              data-testid="space-code"
              className="flex-1 truncate rounded border border-slate-600 bg-slate-900 px-3 py-1.5 font-mono text-xs text-emerald-300"
            >
              {code}
            </code>
            <button
              onClick={() => void copy()}
              className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50"
            >
              <Copy size={12} />
              复制
            </button>
            <button
              data-testid="space-rotate"
              onClick={() => void doRotate()}
              disabled={busy}
              className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50 disabled:opacity-50"
            >
              <RefreshCw size={12} />
              重新生成
            </button>
          </div>
        ) : (
          <p className="mb-3 text-[11px] text-amber-400">
            本浏览器没有保存空间码（可能是清过缓存或换了浏览器）。如果这是你自己的空间，
            请在下面粘贴当初保存的码；否则继续使用会新建一个空空间。
          </p>
        )}

        <div className="mb-2 text-xs text-slate-400">用空间码进入</div>
        <div className="flex items-center gap-2">
          <input
            data-testid="space-attach-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="粘贴空间码"
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-3 py-1.5 font-mono text-xs text-slate-200 outline-none focus:border-blue-500"
          />
          <button
            data-testid="space-attach"
            onClick={() => void doAttach()}
            disabled={busy || input.trim().length === 0}
            className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? '处理中...' : '进入'}
          </button>
        </div>

        {error && <p className="mt-3 text-[11px] text-red-400">{error}</p>}
        {notice && <p className="mt-3 text-[11px] text-emerald-400">{notice}</p>}
      </div>
    </section>
  )
}
