/**
 * session-credentials.ts — 模块级凭据存储 + 按需解密兜底
 *
 * 用于在 SshPlaceholder 和 FileManager 之间共享 SSH 凭据。
 * 使用模块级 Map 而非 useRef，避免 React refs-during-render 限制。
 *
 * 🔧 兜底机制：
 * 页面刷新后 session 通过 Zustand persist 恢复，但内存 Map 为空。
 * 当凭据不在 Map 中时，自动从 connection 配置解密并缓存。
 */

import type { SshCredentials } from '../modules/ssh/Terminal'

/** 每个 session 的解密凭据（供 Terminal 组件建立独立 WS 连接使用） */
export const sessionCredentials = new Map<string, SshCredentials>()

/** 设置 session 凭据 */
export function setSessionCredentials(sessionId: string, credentials: SshCredentials): void {
  sessionCredentials.set(sessionId, credentials)
}

/** 删除 session 凭据 */
export function deleteSessionCredentials(sessionId: string): void {
  sessionCredentials.delete(sessionId)
}

/**
 * 获取 session 凭据（带兜底解密）
 *
 * 1. 先从内存 Map 查找
 * 2. 找不到时根据 session 的 connectionId 查找对应 connection 并解密
 * 3. 解密后缓存到 Map，后续直接命中
 */
export async function resolveSessionCredentials(
  sessionId: string,
): Promise<SshCredentials | undefined> {
  // 1. 内存缓存直接命中
  const cached = sessionCredentials.get(sessionId)
  if (cached) return cached

  // 2. 按需解密（页面刷新后内存 Map 为空的兜底）
  //    延迟导入避免循环依赖
  const { useSshStore, decryptConnection } = await import('../stores/ssh-store')
  const sessions = useSshStore.getState().sessions
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return undefined

  const conn = useSshStore.getState().getConnectionById(session.connectionId)
  if (!conn) return undefined

  try {
    const decrypted = await decryptConnection(conn)
    const creds: SshCredentials = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: decrypted.password,
      privateKey: decrypted.privateKey,
      sudoPassword: decrypted.sudoPassword || decrypted.password,
    }
    // 缓存到 Map，避免重复解密
    sessionCredentials.set(sessionId, creds)
    return creds
  } catch {
    return undefined
  }
}
