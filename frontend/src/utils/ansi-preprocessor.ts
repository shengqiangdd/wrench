/**
 * ANSI 流缓冲（透传 + 跨分片拼接）
 *
 * 设计对齐 VS Code / ttyd / xterm.js 自身：终端仿真器负责解释 CSI/OSC，
 * 上层不要剥光标、不要把 `\r` 改成 `\n`。Docker Compose 多行进度条依赖
 * `\x1b[NA` 上移 + `\x1b[2K` 擦行 + `\x1b[NG` 列定位在原地重绘；剥掉这些
 * 序列后每一帧都会变成新行，进度条会爆炸性增长。
 *
 * xterm.js 的 EscapeSequenceParser 本身跨 write() 有状态，多数分片已经安全。
 * 这里仍做一层 chunk 边界保护：若本片以未完成的 ESC/CSI/OSC/DCS 结尾，
 * 先攒着，等后续字节凑齐再一次性交给 xterm，避免个别集成路径把半截
 * CSI 当普通字符打印。
 */

const ESC = 0x1b
const BEL = 0x07
const MAX_PENDING = 8192

function consumeEscape(data: string, i: number): number {
  // i 指向 ESC。返回序列结束后的下标；未完成返回 -1。
  if (i + 1 >= data.length) return -1
  const next = data.charCodeAt(i + 1)

  // CSI: ESC [ params intermediates final
  if (next === 0x5b) {
    let j = i + 2
    while (j < data.length) {
      const c = data.charCodeAt(j)
      if (c >= 0x30 && c <= 0x3f) {
        j++
        continue
      }
      break
    }
    while (j < data.length) {
      const c = data.charCodeAt(j)
      if (c >= 0x20 && c <= 0x2f) {
        j++
        continue
      }
      break
    }
    if (j >= data.length) return -1
    const c = data.charCodeAt(j)
    if (c >= 0x40 && c <= 0x7e) return j + 1
    return j + 1
  }

  // OSC: ESC ] ... BEL | ST(ESC \)
  if (next === 0x5d) {
    return consumeStringSeq(data, i + 2)
  }

  // DCS ESC P / SOS ESC X / PM ESC ^ / APC ESC _
  if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
    return consumeStringSeq(data, i + 2)
  }

  // nF: ESC intermediates final
  if (next >= 0x20 && next <= 0x2f) {
    let j = i + 1
    while (j < data.length) {
      const c = data.charCodeAt(j)
      if (c >= 0x20 && c <= 0x2f) {
        j++
        continue
      }
      if (c >= 0x30 && c <= 0x7e) return j + 1
      return j + 1
    }
    return -1
  }

  // 2-byte ESC Fp/Fe
  if (next >= 0x30 && next <= 0x7e) return i + 2
  return i + 2
}

function consumeStringSeq(data: string, j: number): number {
  while (j < data.length) {
    const c = data.charCodeAt(j)
    if (c === BEL) return j + 1
    if (c === ESC) {
      if (j + 1 >= data.length) return -1
      if (data.charCodeAt(j + 1) === 0x5c) return j + 2 // ST
      return j // OSC 被新的 ESC 取消，外层从这里重新解析
    }
    j++
  }
  return -1
}

/** 返回应暂存的起始下标；全部完整则 -1 */
export function findIncompleteEscapeStart(data: string): number {
  let i = 0
  while (i < data.length) {
    const esc = data.indexOf('\x1b', i)
    if (esc === -1) return -1
    const end = consumeEscape(data, esc)
    if (end < 0) return esc
    if (end === esc) {
      i = esc + 1
      continue
    }
    i = end
  }
  return -1
}

export class AnsiStreamBuffer {
  private pending = ''

  reset(): void {
    this.pending = ''
  }

  /** 已攒但尚未凑齐的尾部（测试用） */
  getPending(): string {
    return this.pending
  }

  /**
   * 喂入一片 PTY 输出。返回可以立刻交给 xterm.write() 的完整前缀；
   * 未完成的 ESC 留在内部，下一片再拼。
   */
  push(chunk: string): string {
    if (!chunk) return ''
    const data = this.pending + chunk
    const cut = findIncompleteEscapeStart(data)
    if (cut < 0) {
      this.pending = ''
      return data
    }
    const ready = data.slice(0, cut)
    this.pending = data.slice(cut)
    if (this.pending.length > MAX_PENDING) {
      const flushed = this.pending
      this.pending = ''
      return ready + flushed
    }
    return ready
  }
}

/**
 * 无状态透传（单片完整数据）。跨分片请用 {@link AnsiStreamBuffer}。
 * 保留此函数以免旧调用点误剥光标。
 */
export function preprocessAnsiOutput(data: string): string {
  return data
}
