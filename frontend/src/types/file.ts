export type FileSource = 'local' | 'sftp'

export interface FileTab {
  id: string
  name: string
  path: string
  source: FileSource
  language: string
  content?: string
  originalContent?: string
  isDirty: boolean
  sessionId?: string // SFTP session ID
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
  isDirectory: boolean
  children?: FileEntry[]
}

export interface FileSystemNode {
  id: string
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileSystemNode[]
  isExpanded?: boolean
  size?: number
  modifiedAt?: number
}
