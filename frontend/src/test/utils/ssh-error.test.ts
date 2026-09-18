import { describe, expect, it } from 'vitest'
import { presentSshError } from '../../utils/ssh-error'

describe('presentSshError', () => {
  it('explains egress denial without exposing internal jargon as the title', () => {
    const result = presentSshError('出口策略拒绝了SSH/SFTP 连接 192.168.2.7:22：内网地址')
    expect(result.kind).toBe('egress')
    expect(result.title).toContain('不允许')
    expect(result.message).toContain('部署者')
  })

  it('distinguishes authentication from network policy', () => {
    expect(presentSshError('SSH authentication failed').kind).toBe('auth')
    expect(presentSshError('connection timed out').kind).toBe('timeout')
    expect(presentSshError('lookup DNS failed').kind).toBe('dns')
  })
})
