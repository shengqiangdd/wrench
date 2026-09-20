import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/auth', () => ({
  authedFetch: vi.fn(),
}))

import { authedFetch } from '../../services/auth'
import {
  clearSftpMetadataCache,
  invalidateSftpMetadata,
  sftpApi,
  sftpMetadataCacheKey,
  isSftpRequestCurrent,
  shouldFinishSftpListLoading,
  sftpParentPath,
  sftpMetadataPriority,
} from '../../modules/ssh/sftp-utils'

const mockedFetch = vi.mocked(authedFetch)

function response(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ success: true, code: 0, msg: 'ok', data }),
  } as Response
}

describe('SFTP request lifecycle', () => {
  it('accepts only the latest request response', () => {
    expect(isSftpRequestCurrent(4, 4)).toBe(true)
    expect(isSftpRequestCurrent(3, 4)).toBe(false)
    expect(shouldFinishSftpListLoading(true, false)).toBe(true)
    expect(shouldFinishSftpListLoading(true, true)).toBe(false)
    expect(shouldFinishSftpListLoading(false, false)).toBe(false)
  })
})

describe('SFTP metadata cache', () => {
  it('prioritizes directory navigation over metadata detail reads', () => {
    expect(sftpMetadataPriority('list')).toBeLessThan(sftpMetadataPriority('stat'))
  })

  beforeEach(() => {
    clearSftpMetadataCache()
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue(response([]))
  })

  it('隔离 session/connection/path，并规范化父目录', () => {
    expect(
      sftpMetadataCacheKey('list', { sessionId: 's1', connectionId: 'c1', path: '/a' }),
    ).not.toBe(sftpMetadataCacheKey('list', { sessionId: 's2', connectionId: 'c1', path: '/a' }))
    expect(sftpMetadataCacheKey('stat', { connectionId: 'c1', path: '/a' })).not.toBe(
      sftpMetadataCacheKey('list', { connectionId: 'c1', path: '/a' }),
    )
    expect(sftpParentPath('/a/b/')).toBe('/a')
    expect(sftpParentPath('/file')).toBe('/')
    expect(sftpParentPath('/')).toBe('/')
  })

  it('合并同一 metadata 请求并在短 TTL 内复用结果', async () => {
    const body = { sessionId: 's1', connectionId: 'c1', path: '/tmp' }
    const first = sftpApi('list', body)
    const second = sftpApi('list', body)
    await expect(Promise.all([first, second])).resolves.toEqual([[], []])
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    await sftpApi('list', body)
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('旧请求不应删除新请求的去重项', async () => {
    let releaseFirst!: (value: Response) => void
    let releaseSecond!: (value: Response) => void
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve
    })
    const secondResponse = new Promise<Response>((resolve) => {
      releaseSecond = resolve
    })
    mockedFetch
      .mockImplementationOnce(async () => firstResponse)
      .mockImplementationOnce(async () => secondResponse)
    const body = { sessionId: 's1', connectionId: 'c1', path: '/tmp' }
    const first = sftpApi('list', body)
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))
    clearSftpMetadataCache()
    const second = sftpApi('list', body)
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2))
    releaseFirst(response([]))
    await first
    const third = sftpApi('list', body)
    expect(mockedFetch).toHaveBeenCalledTimes(2)
    releaseSecond(response(['fresh']))
    await expect(Promise.all([second, third])).resolves.toEqual([['fresh'], ['fresh']])
  })
  it('限制缓存容量并按最近使用顺序淘汰', async () => {
    for (let index = 0; index < 128; index += 1) {
      await sftpApi('list', { sessionId: 's1', connectionId: 'c1', path: `/entry-${index}` })
    }

    // Touch the oldest entry so it becomes MRU before the next insertion.
    await sftpApi('list', { sessionId: 's1', connectionId: 'c1', path: '/entry-0' })
    await sftpApi('list', { sessionId: 's1', connectionId: 'c1', path: '/entry-128' })
    expect(mockedFetch).toHaveBeenCalledTimes(129)

    await sftpApi('list', { sessionId: 's1', connectionId: 'c1', path: '/entry-0' })
    await sftpApi('list', { sessionId: 's1', connectionId: 'c1', path: '/entry-1' })
    expect(mockedFetch).toHaveBeenCalledTimes(130)
  })

  it('写操作失效目标路径的旧 metadata 请求', async () => {
    let releaseList!: (value: Response) => void
    const pendingList = new Promise<Response>((resolve) => {
      releaseList = resolve
    })
    mockedFetch
      .mockImplementationOnce(async () => pendingList)
      .mockResolvedValue(response(['fresh']))
    const body = { sessionId: 's1', connectionId: 'c1', path: '/tmp/file' }
    const staleList = sftpApi('list', { ...body, path: '/tmp' })
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))
    invalidateSftpMetadata('upload', body)

    const freshList = sftpApi('list', { ...body, path: '/tmp' })
    await expect(freshList).resolves.toEqual(['fresh'])
    expect(mockedFetch).toHaveBeenCalledTimes(2)

    releaseList(response(['stale']))
    await expect(staleList).resolves.toEqual(['stale'])
  })
  it('目录失效会淘汰子树中的旧 metadata 请求', async () => {
    let releaseList!: (value: Response) => void
    const pendingList = new Promise<Response>((resolve) => {
      releaseList = resolve
    })
    mockedFetch
      .mockImplementationOnce(async () => pendingList)
      .mockResolvedValue(response(['fresh']))
    const body = { sessionId: 's1', connectionId: 'c1', path: '/tmp' }
    const staleList = sftpApi('list', { ...body, path: '/tmp/sub' })
    await vi.waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1))
    invalidateSftpMetadata('delete', body)

    const freshList = sftpApi('list', { ...body, path: '/tmp/sub' })
    await expect(freshList).resolves.toEqual(['fresh'])
    expect(mockedFetch).toHaveBeenCalledTimes(2)

    releaseList(response(['stale']))
    await expect(staleList).resolves.toEqual(['stale'])
  })
  it('切换连接清空缓存，写入成功失效目标文件和父目录', async () => {
    const body = { sessionId: 's1', connectionId: 'c1', path: '/dir/file' }
    await sftpApi('stat', body)
    await sftpApi('list', { ...body, path: '/dir' })
    expect(mockedFetch).toHaveBeenCalledTimes(2)

    await sftpApi('list', { ...body, sessionId: 's2' })
    expect(mockedFetch).toHaveBeenCalledTimes(3)

    await sftpApi('upload', { ...body, data: 'base64' })
    await sftpApi('stat', body)
    await sftpApi('list', { ...body, path: '/dir' })
    expect(mockedFetch).toHaveBeenCalledTimes(6)
  })
})
