/**
 * 输出流里的「整块重画」探测：统计连续回移光标的行数（= 块高 - 1）。
 *
 * 真实 `docker compose pull`（44 列）的原始字节形态是：
 *
 * ```
 * [+] Pulling 9/40\r\n ✔ s11 Pulled ...\r\n ✔ s01 Pulled ...\r\n ...（共 21 行）
 * \x1b[?25h\x1b[1A\x1b[1A ... ×21 \x1b[0G\x1b[?25l   ← 光标连续回移到块首
 * ```
 *
 * 关键点：compose 用的是 **21 个 `ESC[1A`**（不是 `ESC[21A`），所以只认单个
 * `ESC[nA` 的 n 是没用的，必须把**连续的一段回移累计起来**才是块高。
 *
 * 用途：块高 > 当前画布行数时，把画布自适应长高（见 terminal-canvas.ts）。
 * 这里只做识别，不做任何输出改写 —— 探测错了最坏只是多一次 resize，**绝不丢数据**。
 */

export interface CursorUpRunState {
  /** 当前"连续回移段"已累计的行数 */
  runTotal: number
}

export function createCursorUpRunState(): CursorUpRunState {
  return { runTotal: 0 }
}

/** 单次探测累计上限（防病态输入把计数撑爆；画布增高另有 cap） */
const RUN_TOTAL_CAP = 1000

/** 会打断"连续回移段"的 CSI 终结符：光标往下走或整屏跳转 */
const BREAKING_FINALS = new Set(['B', 'E', 'F', 'H', 'f', 'd', 'J', 'r', 'L', 'M', 'S', 'T'])

/** 不打断的（改颜色、清行、横向移动、私有模式开关等纯装饰序列）默认保留 */
export function scanCursorUpRuns(chunk: string, state: CursorUpRunState): number {
  let maxRun = 0
  let i = 0
  const n = chunk.length

  while (i < n) {
    const ch = chunk[i]

    if (ch === '\x1b') {
      const next = chunk[i + 1]

      // OSC（标题等）：跳到 BEL 或 ST
      if (next === ']') {
        let j = i + 2
        while (j < n && chunk[j] !== '\x07' && !(chunk[j] === '\x1b' && chunk[j + 1] === '\\')) j++
        i = chunk[j] === '\x07' ? j + 1 : Math.min(n, j + 2)
        continue
      }

      // CSI：ESC [ 参数 终结符
      if (next === '[') {
        let j = i + 2
        while (j < n && /[0-9;:?<>=" ]/.test(chunk.charAt(j))) j++
        const final = chunk[j]
        if (final === undefined) {
          // 序列不完整（正常不该发生：上游 ansi-preprocessor 已拼接）
          break
        }
        if (final === 'A') {
          const params = chunk.slice(i + 2, j).replace(/[?<>="]/g, '')
          const first = params.split(';')[0] ?? ''
          const amount = first === '' ? 1 : Number.parseInt(first, 10)
          const step = Number.isFinite(amount) && amount > 0 ? Math.min(amount, RUN_TOTAL_CAP) : 1
          state.runTotal = Math.min(RUN_TOTAL_CAP, state.runTotal + step)
          if (state.runTotal > maxRun) maxRun = state.runTotal
        } else if (BREAKING_FINALS.has(final)) {
          state.runTotal = 0
        }
        i = j + 1
        continue
      }

      // 其它 ESC 序列（含 ESC 7/8 存光标）：不打断
      i += 2
      continue
    }

    if (ch === '\n') {
      // 换行 = 光标往下走，回移段结束
      state.runTotal = 0
      i++
      continue
    }

    // 普通字符（含 \r、SGR 之外的控制符）不打断：块内文字重写仍是同一段
    i++
  }

  return maxRun
}
