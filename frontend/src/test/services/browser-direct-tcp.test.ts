import { describe, expect, it, vi } from 'vitest'
import {
  DirectSocketsUnavailableError,
  getDirectSocketsStatus,
  IWA_SSH_PORT,
  isAllowedSshTcpTarget,
  openSshTcpProbe,
  type DirectTcpSocket,
  type DirectSocketEnvironment,
  type DirectTcpSocketConstructor,
} from '../../services/browser-direct-tcp'

function mockEnvironment(opened: Promise<unknown> = Promise.resolve({})) {
  const close = vi.fn()
  const construct = vi.fn(function (this: DirectTcpSocket) {
    this.opened = opened as DirectTcpSocket['opened']
    this.close = close
  })
  const environment: DirectSocketEnvironment = {
    isSecureContext: true,
    crossOriginIsolated: true,
    TCPSocket: construct as unknown as DirectTcpSocketConstructor,
  }
  return { environment, construct, close }
}

describe('browser Direct Sockets capability', () => {
  it('requires secure, cross-origin isolated context and the API constructor', () => {
    expect(
      getDirectSocketsStatus({
        isSecureContext: true,
        crossOriginIsolated: true,
        TCPSocket: class {} as unknown as DirectTcpSocketConstructor,
      }),
    ).toEqual({
      available: true,
      reason: 'available',
    })
    expect(
      getDirectSocketsStatus({ isSecureContext: false, crossOriginIsolated: true }),
    ).toMatchObject({
      available: false,
      reason: 'not-secure',
    })
    expect(
      getDirectSocketsStatus({ isSecureContext: true, crossOriginIsolated: false }),
    ).toMatchObject({
      available: false,
      reason: 'not-isolated',
    })
    expect(
      getDirectSocketsStatus({ isSecureContext: true, crossOriginIsolated: true }),
    ).toMatchObject({
      available: false,
      reason: 'api-unavailable',
    })
  })
})

describe('browser SSH TCP transport probe target policy', () => {
  it('defaults to SSH port 22 and permits only the configured IWA port', () => {
    expect(IWA_SSH_PORT).toBe(22)
    expect(isAllowedSshTcpTarget('192.168.1.2', 22)).toBe(true)
    expect(isAllowedSshTcpTarget('192.168.1.2', 22, 22_222)).toBe(false)
    expect(isAllowedSshTcpTarget('192.168.1.2', 22_222, 22_222)).toBe(true)
  })

  it.each(['10.0.0.1', '172.16.1.1', '172.31.255.254', '192.168.1.2', 'fc00::1', 'fdab:1234::7'])(
    'allows private IP literal %s on SSH port',
    (host) => {
      expect(isAllowedSshTcpTarget(host, 22)).toBe(true)
    },
  )

  it.each([
    ['8.8.8.8', 22],
    ['127.0.0.1', 22],
    ['169.254.169.254', 22],
    ['fe80::1', 22],
    ['::ffff:192.168.1.2', 22],
    ['nas.lan', 22],
    ['192.168.001.1', 22],
    ['192.168.1.2', 2222],
    ['192.168.1.2', 0],
  ])('rejects %s:%s', (host, port) => {
    expect(isAllowedSshTcpTarget(String(host), Number(port))).toBe(false)
  })

  it('asks for explicit approval before constructing a socket', async () => {
    const { environment, construct } = mockEnvironment()
    const confirm = vi.fn().mockReturnValue(false)
    await expect(openSshTcpProbe('10.1.2.3', 22, confirm, { environment })).rejects.toThrow(
      'cancelled',
    )
    expect(confirm).toHaveBeenCalledWith('10.1.2.3', 22)
    expect(construct).not.toHaveBeenCalled()
  })

  it('requires an available IWA API and closes a successful raw TCP probe', async () => {
    const { environment, construct, close } = mockEnvironment()
    const confirm = vi.fn().mockReturnValue(true)
    await openSshTcpProbe('192.168.1.8', 22, confirm, { environment })
    expect(construct).toHaveBeenCalledWith('192.168.1.8', 22, { keepAlive: false, noDelay: true })
    expect(close).toHaveBeenCalledOnce()
  })

  it('does not connect when the API is unavailable and always closes after timeout', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    const unavailable = mockEnvironment()
    delete unavailable.environment.TCPSocket
    await expect(
      openSshTcpProbe('192.168.1.8', 22, confirm, { environment: unavailable.environment }),
    ).rejects.toBeInstanceOf(DirectSocketsUnavailableError)
    expect(unavailable.construct).not.toHaveBeenCalled()

    const never = new Promise(() => {})
    const timed = mockEnvironment(never)
    await expect(
      openSshTcpProbe('192.168.1.8', 22, confirm, { environment: timed.environment, timeoutMs: 1 }),
    ).rejects.toThrow('timed out')
    expect(timed.close).toHaveBeenCalledOnce()
  })
})
