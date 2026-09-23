import { describe, expect, it } from 'vitest'
import {
  getLocalAgentPlatform,
  getLocalAgentUnavailableMessage,
} from '../../services/local-agent-platform'

describe('local SSH Agent platform guidance', () => {
  it('recognizes Android browsers as a same-device experimental path', () => {
    expect(getLocalAgentPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/142')).toBe(
      'android',
    )
  })

  it('recognizes iPhone and iPad browsers', () => {
    expect(getLocalAgentPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(
      'ios',
    )
    expect(
      getLocalAgentPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari/605', 5),
    ).toBe('ios')
  })

  it('explains unsupported mobile states without switching to server mode', () => {
    expect(getLocalAgentUnavailableMessage('android')).toContain('不会自动切换')
    expect(getLocalAgentUnavailableMessage('ios')).toContain('明确改选 Wrench 服务端模式')
  })

  it('leaves desktop browsers on the supported native Agent path', () => {
    expect(getLocalAgentPlatform('Mozilla/5.0 (X11; Linux x86_64) Firefox/132')).toBe('desktop')
  })
})
