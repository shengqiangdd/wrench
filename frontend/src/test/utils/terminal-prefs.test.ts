import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TERMINAL_PREFS,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TERMINAL_PREFS_STORAGE_KEY,
  clampFontSize,
  normalizeTerminalPrefs,
  patchTerminalPrefs,
  readTerminalPrefs,
  stepFontSize,
  writeTerminalPrefs,
} from '../../utils/terminal-prefs'

/** 内存版 Storage，避免依赖 jsdom 的 localStorage 全局状态 */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('clampFontSize / stepFontSize', () => {
  it('夹到合法区间', () => {
    expect(clampFontSize(4)).toBe(FONT_SIZE_MIN)
    expect(clampFontSize(999)).toBe(FONT_SIZE_MAX)
  })

  it('非数字回退默认值（不吐 NaN 给 xterm）', () => {
    expect(clampFontSize(Number.NaN)).toBe(FONT_SIZE_DEFAULT)
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(FONT_SIZE_DEFAULT)
  })

  it('从当前值步进，且不会越过边界', () => {
    expect(stepFontSize(13, 1)).toBe(14)
    expect(stepFontSize(13, -1)).toBe(12)
    expect(stepFontSize(FONT_SIZE_MAX, 1)).toBe(FONT_SIZE_MAX)
    expect(stepFontSize(FONT_SIZE_MIN, -1)).toBe(FONT_SIZE_MIN)
  })

  it('当前值本身越界时先夹再步进（坏数据不会一路漂）', () => {
    expect(stepFontSize(999, -1)).toBe(FONT_SIZE_MAX - 1)
  })
})

describe('normalizeTerminalPrefs', () => {
  it('空/非对象 → 全默认', () => {
    expect(normalizeTerminalPrefs(undefined)).toEqual(DEFAULT_TERMINAL_PREFS)
    expect(normalizeTerminalPrefs('nope')).toEqual(DEFAULT_TERMINAL_PREFS)
    expect(normalizeTerminalPrefs(42)).toEqual(DEFAULT_TERMINAL_PREFS)
  })

  it('逐字段回退：坏字段不影响好字段', () => {
    const prefs = normalizeTerminalPrefs({
      fontSize: '18',
      fontFamily: '   ',
      cursorStyle: 'sparkle',
      cursorBlink: false,
      scrollback: -5,
      lineHeight: 99,
      copyOnSelect: 'yes',
    })
    expect(prefs.fontSize).toBe(18)
    expect(prefs.fontFamily).toBe(DEFAULT_TERMINAL_PREFS.fontFamily)
    expect(prefs.cursorStyle).toBe('block')
    expect(prefs.cursorBlink).toBe(false)
    expect(prefs.scrollback).toBe(DEFAULT_TERMINAL_PREFS.scrollback)
    expect(prefs.lineHeight).toBe(1.8)
    expect(prefs.copyOnSelect).toBe(false)
  })

  it('macOptionIsMeta 缺省为 true（macOS 上 Option 组合键的合理默认）', () => {
    expect(DEFAULT_TERMINAL_PREFS.macOptionIsMeta).toBe(true)
    expect(normalizeTerminalPrefs({}).macOptionIsMeta).toBe(true)
    expect(normalizeTerminalPrefs({ macOptionIsMeta: false }).macOptionIsMeta).toBe(false)
  })
})

describe('read / write / patch', () => {
  it('空存储 → 默认值', () => {
    expect(readTerminalPrefs(memoryStorage())).toEqual(DEFAULT_TERMINAL_PREFS)
  })

  it('损坏 JSON 不抛异常，回退默认值', () => {
    const storage = memoryStorage({ [TERMINAL_PREFS_STORAGE_KEY]: '{ not json' })
    expect(readTerminalPrefs(storage)).toEqual(DEFAULT_TERMINAL_PREFS)
  })

  it('写入的是归一化后的值（越界字号落盘即被夹住）', () => {
    const storage = memoryStorage()
    const saved = writeTerminalPrefs({ ...DEFAULT_TERMINAL_PREFS, fontSize: 100 }, storage)
    expect(saved.fontSize).toBe(FONT_SIZE_MAX)
    expect(JSON.parse(storage.map.get(TERMINAL_PREFS_STORAGE_KEY)!)).toEqual(saved)
  })

  it('patch 只改指定字段，其余保持', () => {
    const storage = memoryStorage()
    writeTerminalPrefs({ ...DEFAULT_TERMINAL_PREFS, fontSize: 16, copyOnSelect: true }, storage)
    const after = patchTerminalPrefs({ cursorStyle: 'bar' }, storage)
    expect(after.fontSize).toBe(16)
    expect(after.copyOnSelect).toBe(true)
    expect(after.cursorStyle).toBe('bar')
  })

  it('存储键名稳定（改键名会让所有老用户的偏好悄悄丢失）', () => {
    expect(TERMINAL_PREFS_STORAGE_KEY).toBe('wrench_terminal_prefs')
  })
})
