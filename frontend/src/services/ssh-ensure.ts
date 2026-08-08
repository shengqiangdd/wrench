/**
 * ssh-ensure.ts — 确保 SSH 连接存在并返回 connectionId。
 *
 * Docker/Logs/Monitor 页可在执行命令前调用 ensureSshConnection()，
 * 无需用户先去 SSH 页连接。同一 host:port:username 会复用已有连接。
 */

import { authedFetch } from './auth'
import { decryptField } from './secure-store'

const _pending: Record<string, Promise<string>> = {}

export interface SshCredentials {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
}

/**
 * 确保到指定主机的 SSH 连接存在。
 * 如果已有活跃连接（后端 state.connections），直接返回 connectionId；
 * 否则通过 REST API 创建新连接。
 *
 * 注意：密码/私钥可能来自客户端 SQLite（加密存储），
 * 本函数会自动解密后再发送给后端。
 *
 * @param creds - SSH 凭据（host/username/password 或 privateKey）
 * @returns connectionId — 可用于后续 REST API 调用
 * @throws 如果连接失败
 */
export async function ensureSshConnection(creds: SshCredentials): Promise<string> {
  const key = `${creds.host}:${creds.port || 22}:${creds.username}`

  // 去重：同一 host 的并发调用共享同一个 Promise
  if (_pending[key]) {
    return _pending[key]!
  }

  const promise = (async () => {
    try {
      // 自动解密加密存储的密码/私钥
      const password = await decryptField(creds.password)
      const privateKey = await decryptField(creds.privateKey)

      const res = await authedFetch('/api/ssh/ensure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: creds.host,
          port: creds.port || 22,
          username: creds.username,
          password: password || '',
          privateKey: privateKey || '',
        }),
      })
      const json = (await res.json()) as {
        success?: boolean
        data?: { connection_id?: string; connectionId?: string; host?: string }
        error?: string
        msg?: string
      }
      const cid = json.data?.connection_id ?? json.data?.connectionId
      if (json.success && cid) {
        return cid
      }
      throw new Error(json.error || json.msg || 'SSH 连接失败')
    } finally {
      delete _pending[key]
    }
  })()

  _pending[key] = promise
  return promise
}
