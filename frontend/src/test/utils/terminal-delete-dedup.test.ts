/**
 * Backspace/Delete 双通路去重（utils/terminal-delete-dedup.ts）的判定契约。
 *
 * 回归背景（用户报的"删掉命令再打字不显示"）：旧实现是裸布尔
 * `skipNextOnData`，onData 里无条件吞下一条数据。桌面端 xterm 对那次 Backspace
 * 不会再走 onData（已被自定义 keydown 处理器拦掉），于是标记一直挂着，
 * 把用户**紧接着输入的第一个真实字符**吃掉 → 远端收不到 → 不回显 → "打字不显示"。
 * 下面第 3 条就是钉死这个场景。
 */

import { describe, it, expect } from 'vitest'
import {
  DELETE_DEDUP_WINDOW_MS,
  isDuplicateDelete,
  markDeleteSent,
} from '@/utils/terminal-delete-dedup'

const BS = '\x7f' // Backspace
const DEL = '\x1b[3~' // Delete

describe('isDuplicateDelete', () => {
  it('同一次删除的第二条通路（同字节 + 窗口内）判为重复', () => {
    const pending = markDeleteSent(BS, 1000)
    expect(isDuplicateDelete(pending, BS, 1004)).toBe(true)
    const del = markDeleteSent(DEL, 1000)
    expect(isDuplicateDelete(del, DEL, 1000 + DELETE_DEDUP_WINDOW_MS)).toBe(true)
  })

  it('超出时间窗就不算重复（对端没有第二条通路时，标记必须自动失效）', () => {
    const pending = markDeleteSent(BS, 1000)
    expect(isDuplicateDelete(pending, BS, 1000 + DELETE_DEDUP_WINDOW_MS + 1)).toBe(false)
  })

  it('回归：删除之后用户输入的第一个真实字符绝不能被吞掉', () => {
    // 桌面端真实序列：keydown(Backspace) 之后 xterm 不再产生 onData，
    // 紧接着来的是用户敲的第一个字符 —— 旧裸布尔的实现会在这里 return 掉它。
    const pending = markDeleteSent(BS, 5000)
    for (const ch of ['P', 'A', 'K', 'B', '\r', '\x03', '中', '\x1b[A']) {
      expect(isDuplicateDelete(pending, ch, 5002), `字符 ${JSON.stringify(ch)} 被误吞`).toBe(false)
    }
  })

  it('两种删除序列互不混淆', () => {
    expect(isDuplicateDelete(markDeleteSent(BS, 0), DEL, 1)).toBe(false)
    expect(isDuplicateDelete(markDeleteSent(DEL, 0), BS, 1)).toBe(false)
  })

  it('没有待处理标记时一律放行', () => {
    expect(isDuplicateDelete(null, BS, 0)).toBe(false)
  })

  it('连续删除：每次 keydown 用新时间戳刷新，第二条通路仍按各自窗口判定', () => {
    const first = markDeleteSent(BS, 0)
    expect(isDuplicateDelete(first, BS, 10)).toBe(true)
    const second = markDeleteSent(BS, 200) // 用户第二次按退格（20ms 之外，窗口已过期）
    expect(isDuplicateDelete(second, BS, 205)).toBe(true)
    // 第二条通路迟到超过窗口 → 不再当作重复（宁可多发一次删除，也不吞字符）
    expect(isDuplicateDelete(second, BS, 200 + DELETE_DEDUP_WINDOW_MS + 1)).toBe(false)
  })
})
