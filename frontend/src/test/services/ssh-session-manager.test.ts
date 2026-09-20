/**
 * SshSessionManager — 文件管理（SFTP）复用会话的契约测试。
 *
 * 背景（真机 bug）：文件管理页面「明明有自动连接逻辑就是连不上」。
 * 终端页的会话走 WebSocket，文件管理走 REST；两者是否互相认账必须实测
 * （POST /api/sftp/stat）。这里钉住两件事：
 *   1. 会话确实可用（stat 成功）→ 复用同一个 session id，不再新建连接；
 *   2. 会话不可用 / 是个失效 id → **不**把它当 SFTP 会话用，改走 /api/ssh/ensure
 *      新建一个（并写进 store）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth', () => ({
  authedFetch: vi.fn(),
}))

import { authedFetch } from '../../services/auth'
import { sshSessionManager } from '../../services/ssh-session-manager'
import { useSshStore } from '../../stores/ssh-store'
import type { SshConnection, SshSession } from '../../types/ssh'

const mockedFetch = vi.mocked(authedFetch)

/** 直接塞 wsClient，绕开 setWsClient 的定时器（预热/健康检查） */
function installFakeWsClient() {
  const internals = sshSessionManager as unknown as {
    wsClient: unknown
    sessions: Map<string, unknown>
    connectionLifecycle: Map<string, unknown>
  }
  internals.sessions.clear()
  internals.connectionLifecycle.clear()
  internals.wsClient = {
    send: vi.fn(),
    request: vi.fn(),
    onStatus: vi.fn(),
  }
}

function addConn() {
  const conn: SshConnection = {
    id: 'c1',
    name: 'prod-local',
    host: '192.168.2.9',
    port: 22,
    username: 'admin',
    authType: 'password',
    password: 'pw',
    createdAt: Date.now(),
  }
  useSshStore.getState().addConnection(conn)
}

function addSession(id: string, status: SshSession['status'] = 'connected') {
  useSshStore.getState().addSession({
    id,
    connectionId: 'c1',
    connectionName: 'prod-local',
    host: '192.168.2.9',
    status,
    terminalCols: 80,
    terminalRows: 24,
  })
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  mockedFetch.mockClear()
  installFakeWsClient()
  useSshStore.setState({
    connections: [],
    connectionMap: new Map(),
    sessions: [],
    selectedConnectionId: null,
  })
  localStorage.clear()
})

describe('getOrCreateSftpSession', () => {
  it('会话可用时复用同一个 session（验证通过才算数）', async () => {
    addConn()
    addSession('sess_ssh_live')
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/sftp/stat') return jsonResponse({ success: true })
      throw new Error(`unexpected call: ${url}`)
    })

    const sid = await sshSessionManager.getOrCreateSftpSession('c1')

    expect(sid).toBe('sess_ssh_live')
    expect(mockedFetch).toHaveBeenCalledWith('/api/sftp/stat', expect.anything())
    // 验证通过就不该再建新连接
    const ensureCalls = mockedFetch.mock.calls.filter(([u]) =>
      String(u).includes('/api/ssh/ensure'),
    )
    expect(ensureCalls).toHaveLength(0)
  })

  it('会话不可用时不复用，改走 /api/ssh/ensure 新建', async () => {
    addConn()
    addSession('sess_ssh_stale') // 场景：占着 id 但后端已经不认（跨空间/已断）
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/sftp/stat') return jsonResponse({ success: false })
      if (url === '/api/ssh/ensure')
        return jsonResponse({ success: true, data: { connection_id: 'sess_ssh_fresh' } })
      throw new Error(`unexpected call: ${url}`)
    })

    const sid = await sshSessionManager.getOrCreateSftpSession('c1')

    expect(sid).toBe('sess_ssh_fresh')
    expect(sid).not.toBe('sess_ssh_stale')
    expect(useSshStore.getState().sessions.map((s) => s.id)).toContain('sess_ssh_fresh')
  })

  it('没有任何已有会话时直接新建', async () => {
    addConn()
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/ssh/ensure')
        return jsonResponse({ success: true, data: { connection_id: 'sess_ssh_only' } })
      throw new Error(`unexpected call: ${url}`)
    })

    await expect(sshSessionManager.getOrCreateSftpSession('c1')).resolves.toBe('sess_ssh_only')
  })

  it('新建失败返回 null（调用方据此显示失败原因，而不是假装已连接）', async () => {
    addConn()
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/sftp/stat') return jsonResponse({ success: false })
      if (url === '/api/ssh/ensure') return jsonResponse({ success: false, error: '主机不可达' })
      throw new Error(`unexpected call: ${url}`)
    })

    const statuses: string[] = []
    const sid = await sshSessionManager.getOrCreateSftpSession('c1', {
      onStatus: (m) => statuses.push(m),
    })

    expect(sid).toBeNull()
    expect(statuses.some((s) => s.includes('连接失败'))).toBe(true)
  })
})

describe('connection lifecycle coordination', () => {
  it('shares one pending promise between concurrent SSH/SFTP recovery calls', async () => {
    addConn()
    let release!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      release = resolve
    })
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/ssh/ensure') return response
      throw new Error(`unexpected call: ${url}`)
    })

    const first = sshSessionManager.getOrCreateSftpSession('c1')
    const second = sshSessionManager.getOrCreateSftpSession('c1')
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))

    release(jsonResponse({ success: true, data: { connection_id: 'shared-session' } }))
    await expect(first).resolves.toBe('shared-session')
    await expect(second).resolves.toBe('shared-session')
  })

  it('drops an old result after disconnect and cleans the backend session', async () => {
    addConn()
    let release!: (response: Response) => void
    const response = new Promise<Response>((resolve) => {
      release = resolve
    })
    mockedFetch.mockImplementation(async (url: string) => {
      if (url === '/api/ssh/ensure') return response
      throw new Error(`unexpected call: ${url}`)
    })

    const pending = sshSessionManager.getOrCreateSftpSession('c1')
    sshSessionManager.disconnectAll('c1')
    release(jsonResponse({ success: true, data: { connection_id: 'stale-session' } }))

    await expect(pending).resolves.toBeNull()
    expect(useSshStore.getState().sessions).toHaveLength(0)
    expect(
      (sshSessionManager as unknown as { wsClient: { send: ReturnType<typeof vi.fn> } }).wsClient
        .send,
    ).toHaveBeenCalledWith({ type: 'disconnect', connectionId: 'stale-session' })
  })

  it('keeps forceNew independent from the shared pending request', async () => {
    addConn()
    let firstRelease!: (response: Response) => void
    const firstResponse = new Promise<Response>((resolve) => {
      firstRelease = resolve
    })
    mockedFetch
      .mockImplementationOnce(async () => firstResponse)
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { connection_id: 'forced-session' } }),
      )

    const automatic = sshSessionManager.getOrCreateSftpSession('c1')
    const forced = sshSessionManager.getOrCreateSftpSession('c1', { forceNew: true })
    await expect(forced).resolves.toBe('forced-session')
    firstRelease(jsonResponse({ success: true, data: { connection_id: 'old-session' } }))
    await expect(automatic).resolves.toBeNull()
    expect(mockedFetch).toHaveBeenCalledTimes(2)
  })
})
