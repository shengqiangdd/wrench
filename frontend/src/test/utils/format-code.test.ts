import { describe, it, expect } from 'vitest'
import { formatCode, formatJsonNative, formatXml, isFormatSupported } from '../../utils/format-code'

describe('isFormatSupported', () => {
  it('supports prettier languages and xml', () => {
    expect(isFormatSupported('javascript')).toBe(true)
    expect(isFormatSupported('typescript')).toBe(true)
    expect(isFormatSupported('json')).toBe(true)
    expect(isFormatSupported('yaml')).toBe(true)
    expect(isFormatSupported('html')).toBe(true)
    expect(isFormatSupported('css')).toBe(true)
    expect(isFormatSupported('markdown')).toBe(true)
    expect(isFormatSupported('xml')).toBe(true)
    expect(isFormatSupported('JSON')).toBe(true) // 大小写不敏感
  })

  it('rejects unsupported languages', () => {
    expect(isFormatSupported('python')).toBe(false)
    expect(isFormatSupported('go')).toBe(false)
    expect(isFormatSupported('rust')).toBe(false)
    expect(isFormatSupported('shell')).toBe(false)
    expect(isFormatSupported('text')).toBe(false)
    expect(isFormatSupported('image')).toBe(false)
    expect(isFormatSupported('')).toBe(false)
  })
})

describe('formatJsonNative', () => {
  it('pretty-prints minified JSON', () => {
    const result = formatJsonNative('{"a":1,"b":[1,2]}')
    expect(result).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('returns null for invalid JSON', () => {
    expect(formatJsonNative('{not json}')).toBeNull()
    expect(formatJsonNative('')).toBeNull()
  })
})

describe('formatXml', () => {
  it('indents nested elements and keeps self-closing tags', () => {
    const input = '<?xml version="1.0"?><root><a>1</a><b/><c><d>2</d></c></root>'
    expect(formatXml(input)).toBe(
      '<?xml version="1.0"?>\n<root>\n  <a>1</a>\n  <b/>\n  <c>\n    <d>2</d>\n  </c>\n</root>\n',
    )
  })

  it('keeps comments and CDATA without changing depth', () => {
    const input = '<root><!-- note --><a><![CDATA[<b>raw</b>]]></a></root>'
    const out = formatXml(input)!
    expect(out).toContain('<!-- note -->')
    // CDATA 作为 <a> 唯一子节点时保持内联
    expect(out).toContain('<a><![CDATA[<b>raw</b>]]></a>')
    expect(out).toBe('<root>\n  <!-- note -->\n  <a><![CDATA[<b>raw</b>]]></a>\n</root>\n')
  })
})

describe('formatCode', () => {
  it('formats minified JSON with prettier', async () => {
    const input = '{"a":{"b":1},"c":[1,2]}'
    const res = await formatCode(input, 'json')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.formatted).not.toBe(input)
      // 结果仍是合法 JSON，且与原数据一致
      expect(JSON.parse(res.formatted)).toEqual({ a: { b: 1 }, c: [1, 2] })
    }
  })

  it('reports syntax errors for invalid JSON', async () => {
    const res = await formatCode('{invalid}', 'json')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('语法错误')
    }
  })

  it('formats JS with prettier', async () => {
    const res = await formatCode('const a=1;function f(){return a}', 'javascript')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.formatted).toBe('const a = 1;\nfunction f() {\n  return a;\n}\n')
    }
  })

  it('formats YAML flow list spacing', async () => {
    const res = await formatCode('foo: [1,2,3]', 'yaml')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.formatted).toBe('foo: [1, 2, 3]\n')
      expect(res.unchanged).toBe(false)
    }
  })

  it('formats XML with built-in fallback', async () => {
    const res = await formatCode('<root><a>1</a></root>', 'xml')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.formatted).toBe('<root>\n  <a>1</a>\n</root>\n')
    }
  })

  it('formats only the selected range for JS', async () => {
    const code = 'const a=1;\nfunction foo(){return 42}\nconst b=2;'
    // 选区覆盖第二行的 function foo(){return 42}（偏移 12..37）
    const res = await formatCode(code, 'javascript', { from: 12, to: 37 })
    expect(res.ok).toBe(true)
    if (res.ok) {
      // 选区内的函数被格式化
      expect(res.formatted).toContain('function foo() {\n  return 42;\n}')
      // 选区外保持不变
      expect(res.formatted.startsWith('const a=1;')).toBe(true)
      expect(res.formatted.endsWith('const b=2;')).toBe(true)
    }
  })

  it('returns unchanged=true when already formatted', async () => {
    const code = 'const a = 1;\n'
    const res = await formatCode(code, 'javascript')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.unchanged).toBe(true)
    }
  })

  it('handles empty input', async () => {
    const res = await formatCode('   ', 'json')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.unchanged).toBe(true)
      expect(res.formatted).toBe('   ')
    }
  })

  it('rejects unsupported languages', async () => {
    const res = await formatCode('print(1)', 'python')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('暂不支持')
    }
  })
})
