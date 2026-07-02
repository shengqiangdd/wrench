import { describe, it, expect, beforeEach } from 'vitest'
import { useSshStore } from '../../stores/ssh-store'
import type { SshConnection, SshSession, SftpEntry } from '../../types/ssh'

const mockConnection: SshConnection = {
  id: 'conn-1',
  name: 'Test Server',
  host: '192.168.1.1',
  port: 22,
  username: 'admin',
  authType: 'password',
  password: 'encrypted-pass',
  group: 'production',
  createdAt: Date.now(),
}

const mockSession: SshSession = {
  id: 'sess-1',
  connectionId: 'conn-1',
  connectionName: 'Test Server',
  host: '192.168.1.1',
  status: 'connected',
  terminalCols: 80,
  terminalRows: 24,
}

const mockSftpEntry: SftpEntry = {
  name: 'file.txt',
  path: '/home/admin/file.txt',
  type: 'file',
  size: 1024,
  modifyTime: Date.now(),
  permissions: '-rw-r--r--',
  owner: 'admin',
  group: 'admin',
}

function resetSshStore() {
  useSshStore.setState({
    connections: [],
    selectedConnectionId: null,
    sessions: [],
    currentSftpPath: '/',
    currentSftpEntries: [],
  })
}

describe('useSshStore', () => {
  beforeEach(() => {
    resetSshStore()
  })

  describe('connections', () => {
    it('starts with empty connections', () => {
      expect(useSshStore.getState().connections).toHaveLength(0)
    })

    it('adds a connection', () => {
      useSshStore.getState().addConnection(mockConnection)
      const conns = useSshStore.getState().connections
      expect(conns).toHaveLength(1)
      expect(conns[0]!.name).toBe('Test Server')
      expect(conns[0]!.host).toBe('192.168.1.1')
    })

    it('updates a connection partially', () => {
      useSshStore.getState().addConnection(mockConnection)
      useSshStore.getState().updateConnection('conn-1', { port: 2222, username: 'root' })
      const conn = useSshStore.getState().connections[0]!
      expect(conn.port).toBe(2222)
      expect(conn.username).toBe('root')
      // Other fields unchanged
      expect(conn.host).toBe('192.168.1.1')
    })

    it('deletes a connection', () => {
      useSshStore.getState().addConnection(mockConnection)
      useSshStore.getState().deleteConnection('conn-1')
      expect(useSshStore.getState().connections).toHaveLength(0)
    })

    it('clears selectedConnectionId when deleting selected connection', () => {
      useSshStore.getState().addConnection(mockConnection)
      useSshStore.getState().selectConnection('conn-1')
      expect(useSshStore.getState().selectedConnectionId).toBe('conn-1')
      useSshStore.getState().deleteConnection('conn-1')
      expect(useSshStore.getState().selectedConnectionId).toBeNull()
    })

    it('selects a connection', () => {
      useSshStore.getState().selectConnection('conn-1')
      expect(useSshStore.getState().selectedConnectionId).toBe('conn-1')
    })

    it('deselects a connection with null', () => {
      useSshStore.getState().selectConnection('conn-1')
      useSshStore.getState().selectConnection(null)
      expect(useSshStore.getState().selectedConnectionId).toBeNull()
    })
  })

  describe('sessions', () => {
    it('starts with empty sessions', () => {
      expect(useSshStore.getState().sessions).toHaveLength(0)
    })

    it('adds a session', () => {
      useSshStore.getState().addSession(mockSession)
      expect(useSshStore.getState().sessions).toHaveLength(1)
    })

    it('updates a session', () => {
      useSshStore.getState().addSession(mockSession)
      useSshStore.getState().updateSession('sess-1', { host: '10.0.0.1' })
      expect(useSshStore.getState().sessions[0]!.host).toBe('10.0.0.1')
    })

    it('removes a session', () => {
      useSshStore.getState().addSession(mockSession)
      useSshStore.getState().removeSession('sess-1')
      expect(useSshStore.getState().sessions).toHaveLength(0)
    })
  })

  describe('SFTP', () => {
    it('defaults to root path', () => {
      expect(useSshStore.getState().currentSftpPath).toBe('/')
    })

    it('sets SFTP path', () => {
      useSshStore.getState().setCurrentSftpPath('/home/admin')
      expect(useSshStore.getState().currentSftpPath).toBe('/home/admin')
    })

    it('sets SFTP entries', () => {
      useSshStore.getState().setCurrentSftpEntries([mockSftpEntry, { ...mockSftpEntry, name: 'dir1', type: 'directory' }])
      expect(useSshStore.getState().currentSftpEntries).toHaveLength(2)
      expect(useSshStore.getState().currentSftpEntries[1]!.type).toBe('directory')
    })
  })
})
