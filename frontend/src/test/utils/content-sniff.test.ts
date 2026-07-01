import { describe, it, expect } from 'vitest'
import { sniffLanguage } from '../../utils/content-sniff'

describe('sniffLanguage', () => {
  it('returns text for unknown extensions without content', () => {
    expect(sniffLanguage('main.ts').language).toBe('text')
    expect(sniffLanguage('main.js').language).toBe('text')
    expect(sniffLanguage('main.py').language).toBe('text')
  })

  it('returns text for unknown extension', () => {
    expect(sniffLanguage('main.unknown').language).toBe('text')
  })

  it('detects language from content shebang', () => {
    const result = sniffLanguage('script', '#!/usr/bin/env node\nconsole.log("hello")')
    expect(result.language).toBe('javascript')
    expect(result.method).toBe('shebang')
  })

  it('detects bash from shebang', () => {
    const result = sniffLanguage('script', '#!/bin/bash\necho "hello"')
    expect(result.language).toBe('shell')
  })

  it('detects python from shebang', () => {
    const result = sniffLanguage('script', '#!/usr/bin/env python3\nprint("hello")')
    expect(result.language).toBe('python')
  })
})
