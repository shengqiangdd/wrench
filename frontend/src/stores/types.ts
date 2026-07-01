export type Theme = 'dark' | 'light' | 'system'
export type NavId = 'ssh' | 'commands' | 'files' | 'logs' | 'plugins' | 'settings' | 'docker' | 'monitor'

/** SSH 页面分屏定义 */
export interface SplitDef {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  /** 命令同步组：同一组的分屏会同步输入（空字符串表示不同步） */
  syncGroup?: string
}

/** 文件管理页面连接状态 */
export interface SftpState {
  connId: string | null
  sessionId: string | null
  pathCache: Record<string, string>
}
