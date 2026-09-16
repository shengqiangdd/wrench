/**
 * Backspace / Delete 的「双通路去重」判定。
 *
 * 背景：xterm 的删除键可能从两条通路各来一次 —— 桌面端是 keydown，
 * 移动端虚拟键盘还会额外走 textarea 的 input 事件（xterm 内部同样触发 onData）。
 * 两条都发出去就会一次退格删两个字符，所以 keydown 手动发送后需要把
 * 「紧接着的同一次按键」从 onData 里丢掉。
 *
 * ⚠️ 历史 bug（用户报的"删掉命令再打字不显示"就是它）：旧实现是一个裸布尔
 * `skipNextOnData`，`onData` 里无条件吞掉**下一条**数据。而桌面端 xterm 的
 * onData 对该次 Backspace 根本不会再来（自定义 keydown 处理器 return false 已把它
 * 拦掉），于是这个布尔一直挂着，被**用户接下来输入的第一个真实字符**吃掉 ——
 * 字符没送到远端，远端自然也不回显，看起来就是"打了字不显示"。
 *
 * 修法：把标记绑到「具体字节 + 时间窗」上。
 * - 只有**同一个删除序列**（`\x7f` 对 `\x7f`、`\x1b[3~` 对 `\x1b[3~`）且落在窗口内才算重复；
 * - 任何别的字符都原样放行（不再可能被吞）；
 * - 超出窗口（对端没有任何第二条通路）自动失效。
 */

/** 去重窗口：虚拟键盘的 input 事件通常紧跟 keydown（毫秒级），150ms 足够宽裕。 */
export const DELETE_DEDUP_WINDOW_MS = 150

export interface PendingDelete {
  /** 已经手动发送出去的删除序列（`\x7f` 或 `\x1b[3~`） */
  data: string
  /** 发送时刻（`Date.now()`） */
  at: number
}

export function markDeleteSent(data: string, now: number): PendingDelete {
  return { data, at: now }
}

/**
 * 这条 onData 是不是同一次删除按键的第二条通路？
 *
 * 调用方约定：读到非 `null` 的 pending 后**无论真假都要清空**它 ——
 * 这正是旧实现缺的那一步（旧的只在"跳过"时才清）。
 */
export function isDuplicateDelete(
  pending: PendingDelete | null,
  data: string,
  now: number,
): boolean {
  if (!pending) return false
  return data === pending.data && now - pending.at <= DELETE_DEDUP_WINDOW_MS
}
