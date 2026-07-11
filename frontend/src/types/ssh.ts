export type AuthType = 'password' | 'key' | 'none'

export interface SshConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKey?: string
  /** sudo 密码，用于 sudo -S 提权执行日志读取/文件操作等 */
  sudoPassword?: string
  group?: string
  createdAt: number
  lastConnectedAt?: number
}

export interface SshSession {
  id: string
  connectionId: string
  connectionName: string
  host: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  terminalCols: number
  terminalRows: number
}

export interface SftpEntry {
  name: string
  path: string
  type: 'file' | 'directory' | 'symlink' | 'block_device' | 'char_device' | 'fifo' | 'socket'
  size: number
  modifyTime: number
  permissions: string
  owner: string
  group: string
}

export interface SftpOperation {
  type: 'list' | 'read' | 'write' | 'rename' | 'delete' | 'mkdir' | 'chmod'
  path: string
}

export interface SftpProgress {
  operation: 'upload' | 'download'
  filename: string
  progress: number // 0-100
  speed?: string
}
