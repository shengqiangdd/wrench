import { describe, expect, it } from 'vitest'
import {
  CANVAS_ROWS_CAP,
  clampWindowOffset,
  followWindowOffset,
  isCanvasCappedOut,
  isLiveBottom,
  maxWindowOffset,
  nextCanvasRowsForBlock,
  panWindow,
  resolveCanvasRows,
} from '../../utils/terminal-canvas'

describe('resolveCanvasRows', () => {
  it('窄视口抬到下限（手机键盘弹起 12 行 → 30 行画布）', () => {
    expect(resolveCanvasRows(12, 30)).toBe(30)
  })

  it('可见行数已达下限时等于可见行数（桌面零回归）', () => {
    expect(resolveCanvasRows(30, 30)).toBe(30)
    expect(resolveCanvasRows(48, 30)).toBe(48)
  })

  it('非法输入保底', () => {
    expect(resolveCanvasRows(0, 30)).toBe(30)
    expect(resolveCanvasRows(12, 0)).toBe(12)
  })
})

describe('maxWindowOffset / followWindowOffset', () => {
  it('30 行画布 + 12 行可见 → 最大偏移 18', () => {
    expect(maxWindowOffset(30, 12)).toBe(18)
    expect(maxWindowOffset(12, 12)).toBe(0)
  })

  it('光标在画布底部 → 窗口贴底', () => {
    expect(followWindowOffset(29, 12, 18)).toBe(18)
  })

  it('光标在画布顶部（Ctrl+L / clear 之后）→ 窗口贴顶，提示符不会被藏起来', () => {
    expect(followWindowOffset(0, 12, 18)).toBe(0)
    expect(followWindowOffset(5, 12, 18)).toBe(0)
  })

  it('光标在画布中间 → 窗口把光标放在下沿', () => {
    expect(followWindowOffset(20, 12, 18)).toBe(9)
  })

  it('没有画布时（可见 ≥ 逻辑行）偏移恒为 0', () => {
    expect(followWindowOffset(29, 30, 0)).toBe(0)
  })

  it('clampWindowOffset 夹取', () => {
    expect(clampWindowOffset(-5, 18)).toBe(0)
    expect(clampWindowOffset(99, 18)).toBe(18)
  })
})

describe('panWindow', () => {
  const base = { maxOffset: 18, viewportY: 100, baseY: 100 }

  it('上滑：先平移窗口，不动 scrollback', () => {
    const step = panWindow({ ...base, offset: 18, deltaLines: -5 })
    expect(step).toEqual({ offset: 13, bufferScroll: 0 })
  })

  it('上滑：窗口到顶后继续上滑才滚 scrollback（历史可达最老）', () => {
    const step = panWindow({ ...base, offset: 18, deltaLines: -30 })
    expect(step).toEqual({ offset: 0, bufferScroll: -12 })
  })

  it('上滑：窗口已在顶部 → 全部给 scrollback', () => {
    const step = panWindow({ ...base, offset: 0, deltaLines: -7 })
    expect(step).toEqual({ offset: 0, bufferScroll: -7 })
  })

  it('下滑：还在历史里 → 先滚 scrollback', () => {
    const step = panWindow({ offset: 0, maxOffset: 18, viewportY: 90, baseY: 100, deltaLines: 5 })
    expect(step).toEqual({ offset: 0, bufferScroll: 5 })
  })

  it('下滑：到底后剩余的用于下移窗口', () => {
    const step = panWindow({ offset: 4, maxOffset: 18, viewportY: 100, baseY: 100, deltaLines: 5 })
    expect(step).toEqual({ offset: 9, bufferScroll: 0 })
  })

  it('下滑：窗口到底被夹住（不会越界）', () => {
    const step = panWindow({ offset: 16, maxOffset: 18, viewportY: 100, baseY: 100, deltaLines: 9 })
    expect(step).toEqual({ offset: 18, bufferScroll: 0 })
  })

  it('delta 为 0 时不动', () => {
    expect(panWindow({ ...base, offset: 7, deltaLines: 0 })).toEqual({ offset: 7, bufferScroll: 0 })
  })
})

describe('isLiveBottom', () => {
  it('回到跟随偏移且贴底 → 恢复自动跟随（因此无跳变）', () => {
    expect(isLiveBottom({ offset: 18, followOffset: 18, viewportY: 100, baseY: 100 })).toBe(true)
    expect(isLiveBottom({ offset: 17, followOffset: 18, viewportY: 100, baseY: 100 })).toBe(false)
    expect(isLiveBottom({ offset: 18, followOffset: 18, viewportY: 99, baseY: 100 })).toBe(false)
  })
})

describe('nextCanvasRowsForBlock', () => {
  it('块放得下 → 不动', () => {
    expect(nextCanvasRowsForBlock({ currentRows: 30, runTotal: 20, confirmations: 3 })).toBe(0)
  })

  it('12 行视口下观察到 21 行块（runTotal 20）→ 长到 22 行放得下', () => {
    expect(nextCanvasRowsForBlock({ currentRows: 12, runTotal: 20, confirmations: 2 })).toBe(22)
  })

  it('只观察到一次不动手（避免一次性异常序列触发 resize）', () => {
    expect(nextCanvasRowsForBlock({ currentRows: 12, runTotal: 20, confirmations: 1 })).toBe(0)
  })

  it('封顶，并且只增不减', () => {
    expect(nextCanvasRowsForBlock({ currentRows: 12, runTotal: 500, confirmations: 2 })).toBe(
      CANVAS_ROWS_CAP,
    )
    expect(nextCanvasRowsForBlock({ currentRows: 80, runTotal: 500, confirmations: 9 })).toBe(0)
  })
})

describe('isCanvasCappedOut', () => {
  it('还没顶到上限 → false（自适应增高还有余地）', () => {
    expect(isCanvasCappedOut({ currentRows: 30, runTotal: 60 })).toBe(false)
    expect(isCanvasCappedOut({ currentRows: CANVAS_ROWS_CAP - 1, runTotal: 500 })).toBe(false)
  })

  it('已顶到上限且块仍放不下 → true（该引导用户用 plain）', () => {
    // 块高 100 + 1 行余量 = 101 > 80
    expect(isCanvasCappedOut({ currentRows: CANVAS_ROWS_CAP, runTotal: 99 })).toBe(true)
  })

  it('已顶到上限但块刚好放得下（含 1 行余量）→ false', () => {
    // runTotal 79 → 块高 80，+1 余量 = 81 > 80 仍为 true；runTotal 78 → 80 ≤ 80 → false
    expect(isCanvasCappedOut({ currentRows: CANVAS_ROWS_CAP, runTotal: 78 })).toBe(false)
    expect(isCanvasCappedOut({ currentRows: CANVAS_ROWS_CAP, runTotal: 79 })).toBe(true)
  })

  it('画布关（贴屏，行数 = 可视行数）不会误报：行数没到上限', () => {
    expect(isCanvasCappedOut({ currentRows: 12, runTotal: 200 })).toBe(false)
  })

  it('自定义上限可用（与 nextCanvasRowsForBlock 的 cap 语义一致）', () => {
    expect(isCanvasCappedOut({ currentRows: 40, runTotal: 100, cap: 40 })).toBe(true)
    expect(isCanvasCappedOut({ currentRows: 40, runTotal: 38, cap: 40 })).toBe(false)
  })
})
