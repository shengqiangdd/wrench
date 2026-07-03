import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  aiCodeAction,
  computeDiffLines,
  ACTION_LABELS,
  ACTION_ICONS,
  type AiCodeAction,
} from '../../services/ai-operations'

describe('ai-operations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('ACTION_LABELS', () => {
    it('has labels for all actions', () => {
      const actions: AiCodeAction[] = [
        'explain',
        'refactor',
        'fix',
        'optimize',
        'comment',
        'translate',
      ]
      for (const action of actions) {
        expect(typeof ACTION_LABELS[action]).toBe('string')
        expect(ACTION_LABELS[action].length).toBeGreaterThan(0)
      }
    })
  })

  describe('ACTION_ICONS', () => {
    it('has icons for all actions', () => {
      const actions: AiCodeAction[] = [
        'explain',
        'refactor',
        'fix',
        'optimize',
        'comment',
        'translate',
      ]
      for (const action of actions) {
        expect(typeof ACTION_ICONS[action]).toBe('string')
      }
    })
  })

  describe('computeDiffLines', () => {
    it('returns 0,0 for identical strings', () => {
      const result = computeDiffLines('hello\nworld', 'hello\nworld')
      expect(result).toEqual({ added: 0, removed: 0 })
    })

    it('detects added lines', () => {
      const result = computeDiffLines('a', 'a\nb\nc')
      expect(result.added).toBe(2)
      expect(result.removed).toBe(0)
    })

    it('detects removed lines', () => {
      const result = computeDiffLines('a\nb\nc', 'a')
      expect(result.added).toBe(0)
      expect(result.removed).toBe(2)
    })

    it('handles empty strings', () => {
      // "".split('\n') returns [''] (1 element), so length matches "a".split('\n') = ['a'] (1 element)
      expect(computeDiffLines('', '')).toEqual({ added: 0, removed: 0 })
      expect(computeDiffLines('', 'a')).toEqual({ added: 0, removed: 0 })
      expect(computeDiffLines('a', '')).toEqual({ added: 0, removed: 0 })
      // Multi-line empty vs non-empty
      expect(computeDiffLines('', 'a\nb')).toEqual({ added: 1, removed: 0 })
    })

    it('handles same line count but different content', () => {
      // computeDiffLines only compares line counts, not content
      const result = computeDiffLines('a\nb', 'x\ny')
      expect(result).toEqual({ added: 0, removed: 0 })
    })
  })

  describe('aiCodeAction', () => {
    it('parses code block from AI response', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: '```code\nconst x = 1;\n```\n```explanation\nAdded a variable.\n```',
            },
          },
        ],
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
          text: () => Promise.resolve(''),
        }),
      )

      const result = await aiCodeAction(
        'explain',
        'let x;',
        'javascript',
        'sk-test',
        'gpt-4',
        'https://api.openai.com/v1',
      )
      expect(result.modified).toBe('const x = 1;')
      expect(result.explanation).toContain('Added a variable')
      expect(result.original).toBe('let x;')
    })

    it('falls back to original code when no code block in response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'This code declares a variable.' } }],
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockResponse),
          text: () => Promise.resolve(''),
        }),
      )

      const result = await aiCodeAction(
        'explain',
        'let x;',
        'javascript',
        'sk-test',
        'gpt-4',
        'https://api.openai.com/v1',
      )
      expect(result.modified).toBe('let x;')
    })

    it('throws on API error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('Unauthorized'),
        }),
      )

      await expect(
        aiCodeAction('fix', 'code', 'python', 'bad-key', 'gpt-4', 'https://api.openai.com/v1'),
      ).rejects.toThrow('AI API 错误 (401)')
    })

    it('strips trailing slashes from baseUrl', async () => {
      const mockResponse = { choices: [{ message: { content: 'result' } }] }
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
        text: () => Promise.resolve(''),
      })
      vi.stubGlobal('fetch', fetchSpy)

      await aiCodeAction(
        'explain',
        'code',
        'js',
        'sk-test',
        'gpt-4',
        'https://api.example.com/v1///',
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.com/v1/chat/completions',
        expect.anything(),
      )
    })
  })
})
