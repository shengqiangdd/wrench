import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeDisconnect,
  formatReconnectCountdown,
  formatReconnectGaveUp,
  maxReconnectAttempts,
  reconnectDelaySeconds,
  shouldAutoReconnect,
  type DisconnectReason,
} from '../utils/terminal-reconnect'

/** 连接稳定多久之后，才算"这次重连成功了"，把次数归零 */
const STABLE_CONNECTION_MS = 20_000
/** 连上之后这么快又被掐断，视为"同一轮故障在继续"，次数不归零（避免 2 秒死循环） */
const QUICK_REDROP_MS = 10_000

export interface ConnectionLostState {
  /** 状态条主文案 */
  message: string
  /** 是否正在自动重连（决定要不要显示倒计时与"停止"按钮） */
  auto: boolean
  attempt: number
  secondsLeft: number
}

interface Options {
  /** 真正去重开会话（由 Terminal 注入，内部按 WS 是否还活着选轻/重两条路） */
  onReconnect: () => void
  /** 自动重连尝试发起时（用于提示） */
  onAttempt?: (attempt: number) => void
}

/**
 * 断线后的自动重连（batch 2b ②）。
 *
 * 之前的行为：断线只有一条"重连"按钮，用户得自己盯着点；而 WsClient 自己虽然会
 * 重连 WebSocket，但 **WS 通了 ≠ SSH 会话回来了** —— 恢复后前端并没有再发 connect，
 * 于是终端一直停在那条红字上等人来点。
 *
 * 这里管第二层：按 `RECONNECT_DELAYS_SECONDS` 退避重开会话，带可见倒计时和「停止」，
 * 8 次都没成功就停下并交回手动按钮（不无限骚扰远端）。
 */
export function useTerminalReconnect({ onReconnect, onAttempt }: Options) {
  const [state, setState] = useState<ConnectionLostState | null>(null)
  const attemptRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** 连接稳定 20s 后才把次数归零（连上就断 = 还没稳） */
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reasonRef = useRef<DisconnectReason>('unknown')
  /** 自动重连是否处于活动状态（用户点了"停止"或已放弃即关闭） */
  const autoRef = useRef(false)
  /** 上次 SSH 握手成功的时间：用来识别"连上就立刻又断"，避免 2s 死循环 */
  const lastConnectedAtRef = useRef(0)
  const onReconnectRef = useRef(onReconnect)
  const onAttemptRef = useRef(onAttempt)
  // 回调放 ref 里，保证定时器只认最新一份（不能在 render 里写 ref，见 react-hooks/refs）
  useEffect(() => {
    onReconnectRef.current = onReconnect
    onAttemptRef.current = onAttempt
  }, [onReconnect, onAttempt])

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (tickRef.current) clearInterval(tickRef.current)
    timerRef.current = null
    tickRef.current = null
  }, [])

  const clearStableTimer = useCallback(() => {
    if (stableTimerRef.current) clearTimeout(stableTimerRef.current)
    stableTimerRef.current = null
  }, [])

  const scheduleNext = useCallback(() => {
    clearTimers()
    const attempt = attemptRef.current + 1
    if (attempt > maxReconnectAttempts()) {
      autoRef.current = false
      setState({
        message: formatReconnectGaveUp(),
        auto: false,
        attempt: maxReconnectAttempts(),
        secondsLeft: 0,
      })
      return
    }
    attemptRef.current = attempt
    const delay = reconnectDelaySeconds(attempt)
    let left = delay
    setState({
      message: formatReconnectCountdown(attempt, left, describeDisconnect(reasonRef.current)),
      auto: true,
      attempt,
      secondsLeft: left,
    })
    tickRef.current = setInterval(() => {
      left -= 1
      if (left <= 0) {
        clearTimers()
        // 尝试已经发出去了：停掉倒计时但保持"自动重连"状态（失败会继续退避下一档）
        setState({
          message: '正在重新连接…',
          auto: false,
          attempt,
          secondsLeft: 0,
        })
        onAttemptRef.current?.(attempt)
        onReconnectRef.current()
        return
      }
      setState({
        message: formatReconnectCountdown(attempt, left, describeDisconnect(reasonRef.current)),
        auto: true,
        attempt,
        secondsLeft: left,
      })
    }, 1000)
  }, [clearTimers])

  /**
   * 连接掉了。
   * @param reason  后端给的结束原因（`exit`/`closed`/`client`）/ unknown
   * @param detail  覆盖文案（例如 WS 报的具体错误）
   */
  const notifyLost = useCallback(
    (reason: DisconnectReason, detail?: string) => {
      reasonRef.current = reason
      const quickRedrop =
        lastConnectedAtRef.current > 0 && Date.now() - lastConnectedAtRef.current < QUICK_REDROP_MS
      clearTimers()
      clearStableTimer()
      if (shouldAutoReconnect(reason) && (autoRef.current || quickRedrop)) {
        // 一轮重连还在进行中（或"刚连上就又被掐断"）：不要重置次数，
        // 否则远端一直踢人的时候会变成 2 秒一次的死循环，永远到不了"放弃"。
        autoRef.current = true
        scheduleNext()
        return
      }
      if (!shouldAutoReconnect(reason)) {
        autoRef.current = false
        attemptRef.current = 0
        setState({
          message: detail || describeDisconnect(reason),
          auto: false,
          attempt: 0,
          secondsLeft: 0,
        })
        return
      }
      autoRef.current = true
      attemptRef.current = 0
      setState({
        message: detail || describeDisconnect(reason),
        auto: false,
        attempt: 0,
        secondsLeft: 0,
      })
      scheduleNext()
    },
    [clearStableTimer, clearTimers, scheduleNext],
  )

  /**
   * 连接回来了。
   *
   * 注意：**不立刻把次数归零** —— 否则"连上又被掐断"会永远停在 2 秒一档，
   * 8 次放弃的逻辑也就永远走不到。这里挂一个 20s 稳定计时器，稳住了才算真的好了。
   */
  const notifyConnected = useCallback(
    (wasAuto = false) => {
      clearTimers()
      clearStableTimer()
      autoRef.current = false
      reasonRef.current = 'unknown'
      lastConnectedAtRef.current = Date.now()
      setState(null)
      stableTimerRef.current = setTimeout(() => {
        stableTimerRef.current = null
        attemptRef.current = 0
      }, STABLE_CONNECTION_MS)
      return wasAuto
    },
    [clearStableTimer, clearTimers],
  )

  /** 用户点「停止」：取消自动重连，但保留状态条（手动按钮还在） */
  const stopAuto = useCallback(() => {
    clearTimers()
    clearStableTimer()
    autoRef.current = false
    const attempt = attemptRef.current
    attemptRef.current = 0
    setState({
      message: `${describeDisconnect(reasonRef.current)} · 已停止自动重连`,
      auto: false,
      attempt,
      secondsLeft: 0,
    })
  }, [clearStableTimer, clearTimers])

  /** 用户点「立即重连」：立刻发起一次（不计入退避次数） */
  const retryNow = useCallback(() => {
    clearTimers()
    clearStableTimer()
    onAttemptRef.current?.(attemptRef.current + 1)
    setState({
      message: '正在重新连接…',
      auto: false,
      attempt: attemptRef.current,
      secondsLeft: 0,
    })
    onReconnectRef.current()
  }, [clearStableTimer, clearTimers])

  /**
   * 有一次尝试已经在飞（例如 WS 自己恢复了、我们刚重发了 connect）：
   * 停掉倒计时，但保持"自动重连进行中"，失败时继续退避。
   */
  const markAttempting = useCallback(() => {
    if (!autoRef.current) return
    clearTimers()
    setState({
      message: '正在重新连接…',
      auto: false,
      attempt: attemptRef.current,
      secondsLeft: 0,
    })
  }, [clearTimers])

  /** 尝试失败：继续退避下一档 */
  const notifyAttemptFailed = useCallback(() => {
    if (!autoRef.current) return
    scheduleNext()
  }, [scheduleNext])

  /** 用户点「忽略」：收起状态条 */
  const dismiss = useCallback(() => {
    clearTimers()
    clearStableTimer()
    autoRef.current = false
    setState(null)
  }, [clearStableTimer, clearTimers])

  /** 组件卸载：别留下计时器 */
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current)
    },
    [],
  )

  return {
    state,
    /** 自动重连是否处于活动状态（供"这次重连是不是自动发起的"判断） */
    isAuto: () => autoRef.current,
    notifyLost,
    notifyConnected,
    notifyAttemptFailed,
    markAttempting,
    stopAuto,
    retryNow,
    dismiss,
  }
}
