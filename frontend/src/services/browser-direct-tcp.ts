export type DirectTcpSocketOpenInfo = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

export type DirectTcpSocket = {
  opened: Promise<DirectTcpSocketOpenInfo>
  close: () => void | Promise<void>
}

export type DirectTcpSocketConstructor = new (
  remoteAddress: string,
  remotePort: number,
  options?: { keepAlive?: boolean; noDelay?: boolean },
) => DirectTcpSocket

export type DirectSocketEnvironment = {
  isSecureContext?: boolean
  crossOriginIsolated?: boolean
  TCPSocket?: DirectTcpSocketConstructor
}

export type DirectSocketsStatus = {
  available: boolean
  reason: 'available' | 'not-secure' | 'not-isolated' | 'api-unavailable'
}

export function getDirectSocketsStatus(
  environment: DirectSocketEnvironment = globalThis as DirectSocketEnvironment,
): DirectSocketsStatus {
  if (!environment.isSecureContext) return { available: false, reason: 'not-secure' }
  if (!environment.crossOriginIsolated) return { available: false, reason: 'not-isolated' }
  if (typeof environment.TCPSocket !== 'function') {
    return { available: false, reason: 'api-unavailable' }
  }
  return { available: true, reason: 'available' }
}

/** Only RFC1918 IPv4 and IPv6 ULA literals are accepted. No DNS or mapped IPs. */
export function isAllowedSshTcpTarget(address: string, port: number): boolean {
  if (port !== 22 || address.length > 45 || address.trim() !== address) return false
  return isRfc1918Ipv4(address) || isIpv6Ula(address)
}

function isRfc1918Ipv4(address: string): boolean {
  const parts = address.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((part) => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return -1
    const value = Number(part)
    return value <= 255 ? value : -1
  })
  if (octets.some((value) => value < 0)) return false
  const [a = -1, b = -1] = octets
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

function isIpv6Ula(address: string): boolean {
  if (
    !address.includes(':') ||
    address.includes('%') ||
    address.includes('.') ||
    address.includes('[')
  ) {
    return false
  }
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return false
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = [...left, ...right]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false
  if (halves.length === 1 && groups.length !== 8) return false
  if (halves.length === 2 && groups.length >= 8) return false
  const first = Number.parseInt(groups[0] ?? '', 16)
  return Number.isFinite(first) && (first & 0xfe00) === 0xfc00
}

export class DirectSocketsUnavailableError extends Error {
  constructor(reason: DirectSocketsStatus['reason']) {
    super(`Chrome IWA Direct Sockets is unavailable (${reason})`)
    this.name = 'DirectSocketsUnavailableError'
  }
}

/** Opens one TCP connection to RFC1918/ULA SSH port 22 after explicit confirmation, then closes it. */
export async function openSshTcpProbe(
  address: string,
  port: number,
  confirmTarget: (address: string, port: number) => boolean | Promise<boolean>,
  options: {
    environment?: DirectSocketEnvironment
    timeoutMs?: number
  } = {},
): Promise<void> {
  if (!isAllowedSshTcpTarget(address, port)) {
    throw new Error('Target must be an RFC1918 IPv4 or IPv6 ULA literal on TCP port 22')
  }
  if (!(await confirmTarget(address, port))) throw new Error('Connection cancelled by user')

  const environment = options.environment ?? (globalThis as DirectSocketEnvironment)
  const status = getDirectSocketsStatus(environment)
  if (!status.available || !environment.TCPSocket)
    throw new DirectSocketsUnavailableError(status.reason)

  const socket = new environment.TCPSocket(address, port, { keepAlive: false, noDelay: true })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      socket.opened,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('TCP connect timed out')),
          options.timeoutMs ?? 10_000,
        )
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    await socket.close()
  }
}
