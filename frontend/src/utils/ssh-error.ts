export type SshErrorKind = 'egress' | 'auth' | 'dns' | 'timeout' | 'network' | 'unknown'

export interface SshErrorPresentation {
  kind: SshErrorKind
  title: string
  message: string
  action?: string
}

/** 把后端/SSH 原始错误转换成用户下一步能执行的提示。 */
export function presentSshError(raw: string): SshErrorPresentation {
  const text = raw.trim()
  if (/出口策略拒绝|egress/i.test(text)) {
    const privateTarget = /内网地址|环回地址|链路本地|元数据地址/i.test(text)
    return {
      kind: 'egress',
      title: '当前实例不允许连接这个目标',
      message: privateTarget
        ? '这是内网目标。请让部署者把准确的主机和 SSH 端口加入出口策略，或先连接一台已允许的跳板机。'
        : '该目标被服务器的出口策略拦截，请检查主机和端口。',
      action: '检查主机地址与端口',
    }
  }
  if (/authentication failed|permission denied|认证失败|密码错误|invalid user/i.test(text)) {
    return {
      kind: 'auth',
      title: 'SSH 凭据不正确',
      message: '网络已经连通，但目标主机拒绝了用户名、密码或私钥。',
      action: '检查用户名和认证方式',
    }
  }
  if (/dns|resolve|解析失败|name or service not known/i.test(text)) {
    return {
      kind: 'dns',
      title: '找不到这台主机',
      message: '请确认域名拼写；如果是内网域名，请确认部署实例能解析该域名。',
      action: '检查主机名',
    }
  }
  if (/timeout|timed out|超时/i.test(text)) {
    return {
      kind: 'timeout',
      title: '连接超时',
      message: '目标主机没有在规定时间内响应，请检查主机是否在线、防火墙和 SSH 端口。',
      action: '重试连接',
    }
  }
  if (/connection refused|拒绝连接|unreachable|network is down|网络/i.test(text)) {
    return {
      kind: 'network',
      title: '无法建立网络连接',
      message: '请检查主机地址、端口和网络路由。',
      action: '检查端口或重试',
    }
  }
  return {
    kind: 'unknown',
    title: '连接失败',
    message: text || '未能建立 SSH 连接。',
    action: '检查连接参数后重试',
  }
}
