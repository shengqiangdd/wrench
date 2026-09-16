import { describe, expect, it, vi } from 'vitest'
import {
  findTerminalLinks,
  isCoarsePointer,
  isSafeTerminalHref,
  normalizeTerminalLink,
  openTerminalLink,
  shouldActivateLink,
} from '../../utils/terminal-links'

describe('findTerminalLinks', () => {
  it('识别 http/https', () => {
    const links = findTerminalLinks('see https://example.com/a?b=1 for details')
    expect(links).toHaveLength(1)
    expect(links[0]!.text).toBe('https://example.com/a?b=1')
    expect(links[0]!.href).toBe('https://example.com/a?b=1')
    expect(links[0]!.start).toBe(4)
    expect(links[0]!.end).toBe(4 + 'https://example.com/a?b=1'.length)
  })

  it('www. 补 https://', () => {
    const links = findTerminalLinks('open www.example.com now')
    expect(links[0]!.href).toBe('https://www.example.com')
  })

  it('剥掉句末标点', () => {
    expect(findTerminalLinks('go to https://example.com.')[0]!.text).toBe('https://example.com')
    expect(findTerminalLinks('is it https://example.com?')[0]!.text).toBe('https://example.com')
    expect(findTerminalLinks('list: https://a.io, https://b.io;')[0]!.text).toBe('https://a.io')
  })

  it('括号平衡：句子括号剥掉，URL 自带的括号保留（维基风格）', () => {
    expect(findTerminalLinks('(see https://example.com/a)')[0]!.text).toBe('https://example.com/a')
    expect(findTerminalLinks('https://en.wikipedia.org/wiki/Foo_(bar)')[0]!.text).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    )
  })

  it('不把裸域名/文件名当链接（避免误报）', () => {
    expect(findTerminalLinks('cargo build --release')).toEqual([])
    expect(findTerminalLinks('./target/debug/wrench-backend')).toEqual([])
    expect(findTerminalLinks('main.rs:42: error')).toEqual([])
    expect(findTerminalLinks('package.json')).toEqual([])
  })

  it('一行里多个链接都识别', () => {
    const links = findTerminalLinks('a https://x.io b https://y.io')
    expect(links.map((l) => l.href)).toEqual(['https://x.io', 'https://y.io'])
  })

  it('只有 scheme 不算链接', () => {
    expect(findTerminalLinks('the prefix https:// alone')).toEqual([])
    expect(findTerminalLinks('www.')).toEqual([])
  })

  it('带引号/尖括号的包裹会被排除', () => {
    expect(findTerminalLinks('<https://example.com>')[0]!.text).toBe('https://example.com')
    expect(findTerminalLinks('"https://example.com"')[0]!.text).toBe('https://example.com')
  })

  it('空输入安全', () => {
    expect(findTerminalLinks('')).toEqual([])
  })
})

describe('isSafeTerminalHref / normalizeTerminalLink', () => {
  it('只放行 http/https', () => {
    expect(isSafeTerminalHref('https://example.com')).toBe(true)
    expect(isSafeTerminalHref('http://example.com')).toBe(true)
    expect(isSafeTerminalHref('javascript:alert(1)')).toBe(false)
    expect(isSafeTerminalHref('data:text/html,<script>')).toBe(false)
    expect(isSafeTerminalHref('file:///etc/passwd')).toBe(false)
    expect(isSafeTerminalHref('not a url')).toBe(false)
    expect(isSafeTerminalHref('')).toBe(false)
  })

  it('normalize 拒绝非法 scheme', () => {
    expect(normalizeTerminalLink('javascript:alert(1)')).toBeNull()
    expect(normalizeTerminalLink('https://example.com')).toBe('https://example.com')
  })
})

describe('openTerminalLink', () => {
  it('带 noopener,noreferrer 打开新标签', () => {
    const open = vi.fn(() => ({}))
    expect(openTerminalLink('https://example.com', { open })).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })

  it('非法 scheme 不调用 window.open', () => {
    const open = vi.fn()
    expect(openTerminalLink('javascript:alert(1)', { open })).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('被弹窗拦截时返回 false（调用方据此提示用户）', () => {
    const open = vi.fn(() => null)
    expect(openTerminalLink('https://example.com', { open })).toBe(false)
  })
})

describe('shouldActivateLink / isCoarsePointer', () => {
  it('桌面必须按修饰键（防误点）', () => {
    expect(shouldActivateLink({ hasModifier: false, coarsePointer: false })).toBe(false)
    expect(shouldActivateLink({ hasModifier: true, coarsePointer: false })).toBe(true)
  })

  it('触摸设备无需修饰键（没有 Ctrl 可按）', () => {
    expect(shouldActivateLink({ hasModifier: false, coarsePointer: true })).toBe(true)
  })

  it('粗指针探测：命中 / 不命中 / 没有 matchMedia 都不抛', () => {
    const coarse = { matchMedia: () => ({ matches: true }) } as unknown as Pick<
      Window,
      'matchMedia'
    >
    const fine = { matchMedia: () => ({ matches: false }) } as unknown as Pick<Window, 'matchMedia'>
    expect(isCoarsePointer(coarse)).toBe(true)
    expect(isCoarsePointer(fine)).toBe(false)
    expect(isCoarsePointer(undefined)).toBe(false)
  })
})
