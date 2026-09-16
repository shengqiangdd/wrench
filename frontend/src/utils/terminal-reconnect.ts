/**
 * 断线自动重连节奏 —— 纯函数（batch 2b ②）。
 *
 * 两条外部事实决定了这里的形状：
 * 1. 后端的 `disconnected` 消息现在带 `reason`：`exit`(拿到退出码的正常退出) /
 *    `closed`(通道断了但没退出码) / `client`(WebSocket 先断)。
 *    **只有 `closed` 值得自动重连** —— 用户敲 `exit` 之后又给他塞一个新 shell 是骚扰；
 *    而 `client` 那条路由前端 WsClient 自己的退避重连负责（见 services/websocket.ts）。
 * 2. `WsClient` 只负责"WebSocket 通不通"，它自己会退避重连（2s 起，最多 10 次）；
 *    但 WS 恢复 ≠ SSH 会话恢复 —— 所以这里管的是**第二层**：退避重发 SSH connect。
 */

/** 第 1..8 次尝试前的等待（秒）。前几次快、后面封顶 15s，够覆盖一次服务重启/网络抖动。 */
export const RECONNECT_DELAYS_SECONDS = [2, 3, 6, 12, 15, 15, 15, 15]

export type DisconnectReason = 'exit' | 'closed' | 'client' | 'error' | 'unknown'

/** 后端 `disconnected.reason` 的取值；缺省（老后端 / 未带）按 unknown 处理 */
export function normalizeDisconnectReason(raw: unknown): DisconnectReason {
  return raw === 'exit' || raw === 'closed' || raw === 'client' || raw === 'error' ? raw : 'unknown'
}

/**
 * 要不要自动重连。
 * - `exit`：不要（用户自己退出的）
 * - `client`：不要（WebSocket 断开由 WsClient 自己退避重连，那之后我们再重开会话）
 * - `error`：不要（协议/认证类错误，重试只会重复同样的错误）
 * - `closed` / `unknown`：要（掉线、远端重启、网络抖动）
 */
export function shouldAutoReconnect(reason: DisconnectReason): boolean {
  return reason === 'closed' || reason === 'unknown'
}

export function maxReconnectAttempts(): number {
  return RECONNECT_DELAYS_SECONDS.length
}

/** 第 attempt(1 起) 次尝试前的等待秒数；超出上限取最后一档 */
export function reconnectDelaySeconds(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return RECONNECT_DELAYS_SECONDS[0] ?? 2
  const idx = Math.min(Math.floor(attempt), RECONNECT_DELAYS_SECONDS.length) - 1
  return RECONNECT_DELAYS_SECONDS[idx] ?? 15
}

/** 状态条主文案的通用说法；原因文本与它同义时不要套娃成「连接中断（连接中断）」。 */
const GENERIC_DISCONNECT_HEAD = '连接中断'

/**
 * 状态条的头部文案。
 * - 没有原因 → `连接中断`
 * - 原因就是"连接中断" → 仍然是 `连接中断`（`describeDisconnect` 的默认返回值会走到这里，
 *   旧实现会拼出「连接中断（连接中断）」这种重复文案）
 * - 原因更具体但含同样措辞（如"网络连接中断"）→ 直接用原因当主文案，保留"网络"这层信息
 * - 其它原因（如"远端 shell 已退出"）→ `连接中断（<原因>）`
 */
function formatDisconnectHead(reasonText?: string): string {
  const text = reasonText?.trim()
  if (!text) return GENERIC_DISCONNECT_HEAD
  if (text === GENERIC_DISCONNECT_HEAD) return GENERIC_DISCONNECT_HEAD
  if (text.includes(GENERIC_DISCONNECT_HEAD)) return text
  return `${GENERIC_DISCONNECT_HEAD}（${text}）`
}

/** 状态条文案：「连接中断（掉线）· 3 秒后自动重连（第 2/8 次）」 */
export function formatReconnectCountdown(
  attempt: number,
  secondsLeft: number,
  reasonText?: string,
): string {
  const head = formatDisconnectHead(reasonText)
  return `${head} · ${secondsLeft} 秒后自动重连（第 ${attempt}/${maxReconnectAttempts()} 次）`
}

/** 放弃自动重连后的文案 */
export function formatReconnectGaveUp(): string {
  return `自动重连已停止（${maxReconnectAttempts()} 次都没成功）· 可手动重连再试`
}

/** 掉线原因的人话（状态条里显示） */
export function describeDisconnect(reason: DisconnectReason, detail?: string): string {
  if (reason === 'exit') return '远端 shell 已退出'
  if (reason === 'client') return '网络连接中断'
  if (reason === 'error') return '连接出错'
  if (detail) return detail
  return '连接中断'
}
