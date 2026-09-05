import { describe, expect, it } from 'vitest'
import {
  AnsiStreamBuffer,
  findIncompleteEscapeStart,
  preprocessAnsiOutput,
} from '../../utils/ansi-preprocessor'

const CSI = '\x1b['

describe('findIncompleteEscapeStart', () => {
  it('完整文本无 ESC → -1', () => {
    expect(findIncompleteEscapeStart('hello\r\nworld')).toBe(-1)
  })

  it('完整 CSI 上移/擦行/列定位 → -1', () => {
    const s = `${CSI}10A${CSI}2K${CSI}0Gdone`
    expect(findIncompleteEscapeStart(s)).toBe(-1)
  })

  it('末尾半截 CSI 参数 → 指向 ESC', () => {
    const s = `ok${CSI}12`
    expect(findIncompleteEscapeStart(s)).toBe(2)
  })

  it('末尾单独 ESC → 指向 ESC', () => {
    const s = `ok\x1b`
    expect(findIncompleteEscapeStart(s)).toBe(2)
  })

  it('完整 OSC BEL 终止 → -1', () => {
    expect(findIncompleteEscapeStart('\x1b]0;title\x07next')).toBe(-1)
  })

  it('完整 OSC ST 终止 → -1', () => {
    expect(findIncompleteEscapeStart('\x1b]0;title\x1b\\next')).toBe(-1)
  })

  it('未完成 OSC → 指向 ESC', () => {
    expect(findIncompleteEscapeStart('pre\x1b]0;ti')).toBe(3)
  })
})

describe('AnsiStreamBuffer', () => {
  it('完整 chunk 原样透传，不剥光标', () => {
    const buf = new AnsiStreamBuffer()
    const frame = `\r${CSI}9A${CSI}2K${CSI}0G[+] Running 7/9\r\n`
    expect(buf.push(frame)).toBe(frame)
    expect(buf.getPending()).toBe('')
  })

  it('跨 chunk 拼接半截 CSI', () => {
    const buf = new AnsiStreamBuffer()
    expect(buf.push(`hello${CSI}1`)).toBe('hello')
    expect(buf.getPending()).toBe(`${CSI}1`)
    expect(buf.push(`0A${CSI}2Kworld`)).toBe(`${CSI}10A${CSI}2Kworld`)
    expect(buf.getPending()).toBe('')
  })

  it('ESC 落在第一片末尾，第二片补齐', () => {
    const buf = new AnsiStreamBuffer()
    expect(buf.push('ab\x1b')).toBe('ab')
    expect(buf.push('[2Kcd')).toBe(`${CSI}2Kcd`)
  })

  it('Docker Compose 典型分片：上移被切断', () => {
    const buf = new AnsiStreamBuffer()
    const a = `\r${CSI}2K[+] Running 1/1\n${CSI}`
    const b = `1A${CSI}2K  ✔ layer Pull complete\n`
    expect(buf.push(a)).toBe(`\r${CSI}2K[+] Running 1/1\n`)
    expect(buf.push(b)).toBe(`${CSI}1A${CSI}2K  ✔ layer Pull complete\n`)
  })

  it('连续多帧进度条全部保留光标序列', () => {
    const buf = new AnsiStreamBuffer()
    const frames = Array.from({ length: 5 }, (_, i) => {
      const n = i + 1
      return `${CSI}3A${CSI}2K[+] Running ${n}/9\n${CSI}2K  pulling\n${CSI}2K  ${n}.0s\n`
    }).join('')
    const out = buf.push(frames)
    expect(out).toBe(frames)
    expect((out.match(/\x1b\[3A/g) || []).length).toBe(5)
    expect((out.match(/\x1b\[2K/g) || []).length).toBe(15)
  })

  it('reset 丢弃 pending', () => {
    const buf = new AnsiStreamBuffer()
    buf.push('\x1b[')
    buf.reset()
    expect(buf.getPending()).toBe('')
    expect(buf.push('X')).toBe('X')
  })

  it('preprocessAnsiOutput 是纯透传', () => {
    const s = `${CSI}10A${CSI}2K\rkeep`
    expect(preprocessAnsiOutput(s)).toBe(s)
  })
})
