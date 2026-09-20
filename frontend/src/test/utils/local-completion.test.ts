import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import {
  createLocalCompletionSource,
  getLocalCompletionOptions,
  normalizeCompletionLanguage,
} from '../../utils/local-completion'

describe('local-completion', () => {
  it('normalizes language aliases and falls back to the filename', () => {
    expect(normalizeCompletionLanguage('ts')).toBe('typescript')
    expect(normalizeCompletionLanguage('unknown', 'script.sh')).toBe('shell')
    expect(normalizeCompletionLanguage('unknown', 'README.md')).toBe('markdown')
  })

  it('returns language templates without needing a network source', () => {
    const result = getLocalCompletionOptions('python', 'main.py', 'de', 2)
    const labels = result?.options.map((option) => option.label)

    expect(result?.from).toBe(0)
    expect(labels).toEqual(['def'])
  })

  it('includes symbols found in the current document', () => {
    const doc = 'const importantValue = 1\nfunction renderPage() {}\nre'
    const result = getLocalCompletionOptions('javascript', 'app.js', doc, doc.length)

    expect(result?.options.map((option) => option.label)).toEqual(['renderPage'])
    const symbolResult = getLocalCompletionOptions(
      'javascript',
      'app.js',
      'const importantValue = 1\nimp',
      32,
    )
    expect(symbolResult?.options.map((option) => option.label)).toContain('importantValue')
  })

  it('limits symbol discovery to the local window for very large documents', () => {
    const distantSymbol = 'distantSymbol'
    const nearbySymbol = 'nearbySymbol'
    const doc = distantSymbol + '\n' + 'x '.repeat(300_000) + nearbySymbol + '\nnea'
    const result = getLocalCompletionOptions('javascript', 'app.js', doc, doc.length)

    expect(result?.options.map((option) => option.label)).toContain(nearbySymbol)
    expect(result?.options.map((option) => option.label)).not.toContain(distantSymbol)
  })

  it('filters suggestions by the token before the cursor', () => {
    const result = getLocalCompletionOptions('javascript', 'app.js', 'fun', 3)

    expect(result?.options.map((option) => option.label)).toEqual(['function'])
  })

  it('does not suggest inside comments or quoted strings', () => {
    expect(getLocalCompletionOptions('javascript', 'app.js', '// fun', 6)).toBeNull()
    expect(getLocalCompletionOptions('javascript', 'app.js', 'const value = "fun', 16)).toBeNull()
    expect(getLocalCompletionOptions('python', 'main.py', '# def', 5)).toBeNull()
    expect(getLocalCompletionOptions('javascript', 'app.js', '/* fun', 6)).toBeNull()
  })

  it('only opens implicitly when there is a prefix, but explicit completion works at whitespace', () => {
    expect(getLocalCompletionOptions('json', 'data.json', '{\n  ', 4)).toBeNull()

    const result = getLocalCompletionOptions('json', 'data.json', '{\n  ', 4, true)
    expect(result?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(['object', 'array', 'property']),
    )
  })

  it('creates a CodeMirror-compatible source with a valid replacement range', () => {
    const state = EditorState.create({ doc: 'fun' })
    const source = createLocalCompletionSource('javascript', 'app.js')
    const result = source(new CompletionContext(state, 3, false))

    expect(result && 'from' in result ? result.from : null).toBe(0)
    expect(result && 'validFor' in result ? result.validFor : null).toEqual(/^[\w$-]*$/)
  })
})
