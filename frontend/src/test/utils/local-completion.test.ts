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
    expect(labels).toContain('def')
    expect(labels).toContain('class')
  })

  it('includes symbols found in the current document', () => {
    const doc = 'const importantValue = 1\nfunction renderPage() {}\nre'
    const result = getLocalCompletionOptions('javascript', 'app.js', doc, doc.length)

    expect(result?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(['importantValue', 'renderPage']),
    )
  })

  it('only opens implicitly when there is a prefix, but explicit completion works at whitespace', () => {
    expect(getLocalCompletionOptions('json', 'data.json', '{\n  ', 4)).toBeNull()

    const result = getLocalCompletionOptions('json', 'data.json', '{\n  ', 4, true)
    expect(result?.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(['object', 'array', 'property']),
    )
  })

  it('creates a CodeMirror-compatible source with a valid replacement range', () => {
    const state = EditorState.create({ doc: 'con' })
    const source = createLocalCompletionSource('javascript', 'app.js')
    const result = source(new CompletionContext(state, 3, false))

    expect(result && 'from' in result ? result.from : null).toBe(0)
    expect(result && 'validFor' in result ? result.validFor : null).toEqual(/^[\w$-]*$/)
  })
})
