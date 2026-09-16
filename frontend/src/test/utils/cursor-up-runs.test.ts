import { describe, expect, it } from 'vitest'
import { createCursorUpRunState, scanCursorUpRuns } from '../../utils/cursor-up-runs'

/** 真实 `docker compose pull` 一帧的形态（抓自 44 列 PTY 原始流）：21 行 + 21 个 ESC[1A */
const REAL_COMPOSE_FRAME =
  '[+] Pulling 0/20\r\n' +
  ' \x1b[33m⠋\x1b[0m s11 Pulling                         \x1b[34m0.1s \x1b[0m\r\n' +
  ' \x1b[33m⠋\x1b[0m s03 Pulling                         \x1b[34m0.1s \x1b[0m\r\n' +
  '\x1b[?25h' +
  '\x1b[1A'.repeat(21) +
  '\x1b[0G\x1b[?25l'

describe('scanCursorUpRuns', () => {
  it('识别真实 compose 帧：连续 21 个 ESC[1A 累计成块高 22', () => {
    const state = createCursorUpRunState()
    expect(scanCursorUpRuns(REAL_COMPOSE_FRAME, state)).toBe(21)
    expect(state.runTotal).toBe(21)
  })

  it('单个 ESC[nA 也计数（大块跳转）', () => {
    const state = createCursorUpRunState()
    expect(scanCursorUpRuns('\x1b[30A', state)).toBe(30)
  })

  it('换行会打断回移段（单行动画不该被当成整块重画）', () => {
    const state = createCursorUpRunState()
    expect(scanCursorUpRuns('progress 1%\r\x1b[1A', state)).toBe(1)
    state.runTotal = 0
    // 行与行之间夹着换行的多次回移，各自算一段
    expect(scanCursorUpRuns('a\r\n\x1b[1A\x1b[1Ab\r\n\x1b[1A', state)).toBe(2)
  })

  it('光标下移 / 绝对定位 / 清屏都会重置累计', () => {
    const state = createCursorUpRunState()
    scanCursorUpRuns('\x1b[1A\x1b[1A\x1b[1A', state)
    expect(state.runTotal).toBe(3)
    scanCursorUpRuns('\x1b[2B', state)
    expect(state.runTotal).toBe(0)
    scanCursorUpRuns('\x1b[1A\x1b[1A', state)
    expect(state.runTotal).toBe(2)
    scanCursorUpRuns('\x1b[10;1H', state)
    expect(state.runTotal).toBe(0)
    scanCursorUpRuns('\x1b[1A', state)
    scanCursorUpRuns('\x1b[2J', state)
    expect(state.runTotal).toBe(0)
  })

  it('颜色/清行/横向移动/私有模式不打断累计', () => {
    const state = createCursorUpRunState()
    const chunk = '\x1b[1A\x1b[32m\x1b[K\x1b[0G\x1b[?25l\x1b[1A\x1b[0m\x1b[1A'
    expect(scanCursorUpRuns(chunk, state)).toBe(3)
  })

  it('跨 chunk 累计：切开的回移段仍然算得对', () => {
    const state = createCursorUpRunState()
    const total = 21
    let seen = 0
    for (let i = 0; i < total; i += 7) {
      const part = '\x1b[1A'.repeat(Math.min(7, total - i))
      seen = Math.max(seen, scanCursorUpRuns(part, state))
    }
    expect(state.runTotal).toBe(21)
    expect(seen).toBe(21)
  })

  it('OSC 标题不会被当成文本或被误判', () => {
    const state = createCursorUpRunState()
    expect(scanCursorUpRuns('\x1b]0;title\x07\x1b[1A\x1b[1A', state)).toBe(2)
    expect(scanCursorUpRuns('\x1b]0;a\x1b\\\x1b[1A', state)).toBe(3)
  })

  it('普通输出（无回移）不产生块高', () => {
    const state = createCursorUpRunState()
    expect(scanCursorUpRuns('hello\r\nworld\r\n$ ', state)).toBe(0)
    expect(state.runTotal).toBe(0)
  })
})
