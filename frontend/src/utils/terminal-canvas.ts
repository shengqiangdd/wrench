/**
 * 终端「画布」几何 —— 把 PTY 的逻辑尺寸与可视区尺寸解耦。
 *
 * ## 为什么需要它（实测证据）
 *
 * 用真实 `docker compose pull`（20 服务、44 列）在 PTY 上抓原始流，再用行数账
 * 模拟器统计"被推进 scrollback 的行数"（重复行就是这么来的）：
 *
 * ```
 * 44x12  → 2383 行      ← 手机键盘弹起时的真实视口，就是堆叠现场
 * 44x21  →  241 行
 * 44x24  →    1 行      ← 干净
 * 44x30  →    0 行      ← 干净
 * 60x12  → 2381 行      ← 加宽列数没用
 * 80x12  → 2381 行
 * 80x24  →    0 行
 * ```
 *
 * 结论：这类程序的进度块高 B = 1 + 服务数（20 服务 = 21 行），**只要屏高 < B
 * 就每帧往下丢行**；列数完全不影响（compose 自己把行压到 ≤ 45 列）。
 * 也就是说：问题的根源是"程序拿到的屏高不够"，与程序怎么画无关——
 * 逐程序关动画（COMPOSE_PROGRESS=plain 那一套）只是绕过，不是根治。
 *
 * ## 本模块的做法：给程序一块够大的逻辑屏，可视区只是这扇屏上的一扇窗
 *
 * - 逻辑行数 `rows = max(可见行数, 30)`；**列数不放大**（避免横向裁切）。
 * - 可见行数 ≥ 30 时（桌面）逻辑尺寸 = 可视尺寸，行为与改造前完全一致，零回归。
 * - 窗口偏移 `W ∈ [0, rows - 可见行数]`，渲染时整块上移 `W * 行高`，
 *   容器 overflow:hidden —— 用户看到的是逻辑屏的一段。
 * - 默认**跟随光标**（光标永远可见：Ctrl+L / clear 后提示符回到屏顶也能看见）；
 *   上滑时先把窗口往上平移（看画布更上面），到顶后继续滚 scrollback，全程连续，
 *   最老的历史也到得了（不会像"固定下对齐裁剪"那样把顶部永久埋掉）。
 * - 备用屏（vim / less / htop 走 smcup）自动退回 1:1，行为与今天一致。
 *
 * 本文件只放纯函数，便于单测；实际渲染接线在 modules/ssh/Terminal.tsx。
 */

/** 逻辑画布最小行数：24 行是 compose 20 服务块（21 行）的干净阈值，30 行留余量 */
export const CANVAS_ROWS_FLOOR = 30

/** 自适应增高上限：再大的块请用 plain 芯片或更大的显示设备 */
export const CANVAS_ROWS_CAP = 80

/** 自适应增高需要"同一块高连续观察到两次"，避免一次性异常序列触发 resize */
export const CANVAS_GROW_CONFIRMATIONS = 2

/** 观测窗口：超过这个时间没再看到同样的块高就重新计数 */
export const CANVAS_GROW_MEMORY_MS = 3000

/** 逻辑行数：可见行数 ≥ 下限时与今天一致（桌面零回归） */
export function resolveCanvasRows(visibleRows: number, floor: number = CANVAS_ROWS_FLOOR): number {
  const rows = Math.max(1, Math.floor(visibleRows))
  const want = Math.max(1, Math.floor(floor))
  return Math.max(rows, want)
}

/** 窗口最大偏移：逻辑屏比可视区高出多少行 */
export function maxWindowOffset(canvasRows: number, visibleRows: number): number {
  return Math.max(0, Math.floor(canvasRows) - Math.max(1, Math.floor(visibleRows)))
}

export function clampWindowOffset(offset: number, maxOffset: number): number {
  const max = Math.max(0, maxOffset)
  return Math.min(Math.max(Math.floor(offset), 0), max)
}

/**
 * 跟随光标时的窗口偏移：让光标落在窗口**下沿**。
 *
 * 这样三种情形都自然：
 * - 普通输出：光标在逻辑屏底部 → 窗口贴底（看起来和普通终端一样）；
 * - Ctrl+L / clear：光标回到屏顶 → 窗口贴顶，提示符不会被藏起来；
 * - 进度块重画：光标停在被重画的块尾/块首 → 窗口覆盖该块的可视部分。
 */
export function followWindowOffset(
  cursorRow: number,
  visibleRows: number,
  maxOffset: number,
): number {
  const visible = Math.max(1, Math.floor(visibleRows))
  return clampWindowOffset(Math.floor(cursorRow) - (visible - 1), maxOffset)
}

export interface WindowStep {
  /** 新的窗口偏移 */
  offset: number
  /** 需要交给 xterm.scrollLines 的行数：正 = 看更近的内容，负 = 看更早的内容 */
  bufferScroll: number
}

/**
 * 一次滚动手势（或滚轮）对「窗口 + 缓冲区」的分配。
 *
 * 关键顺序：往更早内容翻时**先平移窗口、平移到顶再滚 scrollback**，
 * 反向（往更新内容翻）**先滚 scrollback、到底再平移窗口**。
 * 两个方向都满足"内容连续移动、无跳变"，而且缓冲区最老的行也够得着。
 */
export function panWindow(input: {
  offset: number
  deltaLines: number
  maxOffset: number
  viewportY: number
  baseY: number
}): WindowStep {
  const maxOffset = Math.max(0, Math.floor(input.maxOffset))
  let offset = clampWindowOffset(input.offset, maxOffset)
  const delta = Math.trunc(input.deltaLines)
  let bufferScroll = 0

  if (delta < 0) {
    // 往更早内容：先平移窗口（最多到顶），剩下的交给 scrollback
    let up = -delta
    const take = Math.min(up, offset)
    offset -= take
    up -= take
    bufferScroll = up === 0 ? 0 : -up
  } else if (delta > 0) {
    // 往更新内容：先滚 scrollback（最多到底），剩下的用来下移窗口
    const room = Math.max(0, Math.floor(input.baseY) - Math.floor(input.viewportY))
    const take = Math.min(delta, room)
    bufferScroll = take
    offset = clampWindowOffset(offset + (delta - take), maxOffset)
  }

  return { offset, bufferScroll }
}

/** 是否已回到"跟随光标 / 贴底"的实时视图（此时恢复自动跟随，且构造成无跳变） */
export function isLiveBottom(input: {
  offset: number
  followOffset: number
  viewportY: number
  baseY: number
}): boolean {
  return input.offset === input.followOffset && input.viewportY >= input.baseY
}

/**
 * 自适应增高：块高超过当前画布时把画布长到刚好放下。
 *
 * @param runTotal 观察到的"连续回移行数"累计（= 块高 - 1）
 * @returns 新行数；0 表示不需要动
 */
export function nextCanvasRowsForBlock(input: {
  currentRows: number
  runTotal: number
  cap?: number
  /** 已经连续几次观察到同一个块高（含本次） */
  confirmations: number
}): number {
  const cap = input.cap ?? CANVAS_ROWS_CAP
  const rows = Math.max(1, Math.floor(input.currentRows))
  const blockRows = Math.max(0, Math.floor(input.runTotal)) + 1
  // 块要放得下：块高 + 1 行余量（重画时光标要能回到块首之上）
  const required = blockRows + 1
  if (required <= rows) return 0
  if (input.confirmations < CANVAS_GROW_CONFIRMATIONS) return 0
  const target = Math.min(cap, Math.max(required, rows + 1))
  return target > rows ? target : 0
}
