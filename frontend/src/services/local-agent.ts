import { getSpaceCode } from './auth'

const STORAGE_KEY = 'wrench-local-agent-session-v1'

export interface LocalAgentSession {
  endpoint: string
  websocketUrl: string
  sessionToken: string
  spaceCode: string
}

export function getLocalAgentSession(): LocalAgentSession | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) || 'null',
    ) as LocalAgentSession | null
    if (
      !value ||
      typeof value.endpoint !== 'string' ||
      typeof value.sessionToken !== 'string' ||
      typeof value.spaceCode !== 'string'
    )
      return null
    if (!getSpaceCode() || value.spaceCode !== getSpaceCode()) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return value
  } catch {
    return null
  }
}

export async function pairLocalAgent(endpointInput: string, oneTimeToken: string): Promise<void> {
  const spaceCode = getSpaceCode()
  if (!spaceCode) throw new Error('当前浏览器空间尚未初始化；请刷新后重试')
  const endpoint = new URL(endpointInput)
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '') ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('Agent 地址必须是 http://127.0.0.1:<随机端口>')
  }
  const response = await fetch(new URL('/pair', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: oneTimeToken.trim() }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
  const data = (await response.json()) as {
    paired?: boolean
    session_token?: string
    message?: string
  }
  if (!response.ok || !data.paired || !data.session_token) {
    throw new Error(data.message || '配对失败；检查 Agent 地址、网页来源和一次性令牌')
  }
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      endpoint: endpoint.origin,
      websocketUrl: `ws://127.0.0.1:${endpoint.port}/ws`,
      sessionToken: data.session_token,
      spaceCode,
    } satisfies LocalAgentSession),
  )
}

export function clearLocalAgentSession(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}

export async function checkLocalAgent(session: LocalAgentSession): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', session.endpoint), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    })
    return response.ok
  } catch {
    return false
  }
}
