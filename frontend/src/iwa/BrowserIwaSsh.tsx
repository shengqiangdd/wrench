import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  getDirectSocketsStatus,
  IWA_SSH_PORT,
  isAllowedSshTcpTarget,
  type DirectSocketEnvironment,
} from '../services/browser-direct-tcp'
import { confirmAndPinHostKey } from './hostkey-pinning'
import { createTerminalResizeScheduler } from './terminal-resize'

type SftpEntry = {
  name: string
  size: number
  modTime: number
  kind: 'directory' | 'file' | 'symlink' | 'other'
}

type IwaSshApi = {
  connect: (options: {
    host: string
    port: number
    cols: number
    rows: number
    socket: InstanceType<NonNullable<DirectSocketEnvironment['TCPSocket']>>
    username: string
    password?: string
    privateKey?: Uint8Array
    privateKeyPassphrase?: Uint8Array
    confirmHostKey: (host: string, keyType: string, fingerprint: string) => Promise<boolean>
    onData: (data: Uint8Array) => void
  }) => Promise<void>
  send: (text: string) => Promise<void>
  resize: (cols: number, rows: number) => Promise<void>
  listDirectory: (path: string) => Promise<SftpEntry[]>
  downloadFile: (path: string) => Promise<Uint8Array>
  uploadFile: (path: string, data: Uint8Array, overwrite?: boolean) => Promise<void>
  removePath: (path: string) => Promise<void>
  renamePath: (source: string, destination: string) => Promise<void>
  makeDirectory: (path: string) => Promise<void>
  close: () => Promise<void>
}

declare global {
  interface Window {
    wrenchIwaSsh?: IwaSshApi
    Go?: new () => {
      importObject: WebAssembly.Imports
      run: (instance: WebAssembly.Instance) => Promise<void>
    }
  }
}

let wasmInit: Promise<void> | undefined
function loadSshWasm() {
  if (!wasmInit) {
    wasmInit = new Promise<void>((resolve, reject) => {
      const start = async () => {
        try {
          if (!window.Go) throw new Error('Go WebAssembly runtime not loaded')
          const go = new window.Go()
          const result = await WebAssembly.instantiateStreaming(fetch('/ssh.wasm'), go.importObject)
          void go.run(result.instance)
          const startedAt = Date.now()
          const poll = () => {
            if (window.wrenchIwaSsh) resolve()
            else if (Date.now() - startedAt > 5000)
              reject(new Error('SSH WebAssembly runtime did not start'))
            else window.setTimeout(poll, 10)
          }
          poll()
        } catch (error) {
          reject(error)
        }
      }
      void start()
    })
  }
  return wasmInit
}

export default function BrowserIwaSsh() {
  const [host, setHost] = useState('')
  const [username, setUsername] = useState('')
  const [authMethod, setAuthMethod] = useState<'password' | 'private-key'>('password')
  const [password, setPassword] = useState('')
  const [privateKeyFile, setPrivateKeyFile] = useState<File | undefined>(undefined)
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('')
  const [status, setStatus] = useState('Disconnected')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [remotePath, setRemotePath] = useState('.')
  const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([])
  const [sftpStatus, setSftpStatus] = useState('Connect to load remote files')
  const [sftpBusy, setSftpBusy] = useState(false)
  const [uploadSelection, setUploadSelection] = useState<File | undefined>(undefined)
  const sensitiveBuffers = useRef(new Set<Uint8Array>())
  const privateKeyInput = useRef<HTMLInputElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const termContainer = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | undefined>(undefined)
  const terminalDimensions = useRef({ cols: 80, rows: 24 })
  const resizeScheduler = useRef<ReturnType<typeof createTerminalResizeScheduler> | undefined>(
    undefined,
  )
  const api = useRef<IwaSshApi | undefined>(undefined)
  const capability = getDirectSocketsStatus()
  const permitted = isAllowedSshTcpTarget(host.trim(), IWA_SSH_PORT)

  const recordTerminalDimensions = useCallback((cols: number, rows: number) => {
    terminalDimensions.current = { cols, rows }
    if (termContainer.current) {
      termContainer.current.dataset.ptyCols = String(cols)
      termContainer.current.dataset.ptyRows = String(rows)
    }
  }, [])

  const queueTerminalResize = useCallback(() => {
    const term = terminal.current
    if (term) recordTerminalDimensions(term.cols, term.rows)
    if (api.current) resizeScheduler.current?.schedule(terminalDimensions.current)
  }, [recordTerminalDimensions])

  useEffect(() => {
    if (!termContainer.current) return
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: { background: '#020617' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(termContainer.current)
    const resize = term.onResize(({ cols, rows }) => {
      recordTerminalDimensions(cols, rows)
      queueTerminalResize()
    })
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // The terminal container can be temporarily unmeasurable during layout.
      }
    })
    resizeObserver.observe(termContainer.current)
    try {
      fit.fit()
    } catch {
      // Keep the safe 80x24 default until layout becomes measurable.
    }
    recordTerminalDimensions(term.cols, term.rows)
    term.writeln(
      'Local SSH over Chrome IWA Direct Sockets. Host keys are pinned locally after first confirmation.',
    )
    terminal.current = term
    const input = term.onData((data) => {
      if (api.current)
        void api.current.send(data).catch((error: unknown) => setStatus(String(error)))
    })
    return () => {
      input.dispose()
      resize.dispose()
      resizeObserver.disconnect()
      resizeScheduler.current?.cancel()
      term.dispose()
      terminal.current = undefined
    }
  }, [queueTerminalResize, recordTerminalDimensions])

  useEffect(
    () => () => {
      for (const buffer of sensitiveBuffers.current) buffer.fill(0)
      sensitiveBuffers.current.clear()
      resizeScheduler.current?.cancel()
      if (api.current) void api.current.close()
    },
    [],
  )

  async function refreshRemoteDirectory(directory = remotePath) {
    const client = api.current
    if (!client) {
      setSftpStatus('Connect to load remote files')
      return
    }
    setSftpBusy(true)
    setSftpStatus(`Loading ${directory}…`)
    try {
      const entries = await client.listDirectory(directory)
      entries.sort((left, right) => {
        const leftDirectory = left.kind === 'directory' ? 0 : 1
        const rightDirectory = right.kind === 'directory' ? 0 : 1
        return leftDirectory - rightDirectory || left.name.localeCompare(right.name)
      })
      setRemotePath(directory)
      setRemoteEntries(entries)
      setSftpStatus(`${entries.length} entries`)
    } catch (error) {
      setRemoteEntries([])
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSftpBusy(false)
    }
  }

  function childRemotePath(name: string) {
    if (
      !name ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\\') ||
      name.includes('\0')
    )
      throw new Error('Use one remote name without slashes or parent traversal')
    if (remotePath === '.') return name
    if (remotePath === '/') return `/${name}`
    return `${remotePath.replace(/\/$/, '')}/${name}`
  }

  async function createRemoteDirectory() {
    const name = window.prompt('New remote directory name')
    if (name === null) return
    try {
      const destination = childRemotePath(name.trim())
      setSftpBusy(true)
      await api.current?.makeDirectory(destination)
      await refreshRemoteDirectory(remotePath)
    } catch (error) {
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSftpBusy(false)
    }
  }

  async function renameRemoteEntry(entry: SftpEntry) {
    const name = window.prompt(`Rename ${entry.name} to`, entry.name)
    if (name === null) return
    try {
      const source = childRemotePath(entry.name)
      const destination = childRemotePath(name.trim())
      if (
        !window.confirm(
          `Rename ${entry.name} to ${name.trim()}? Existing destinations are never overwritten.`,
        )
      )
        return
      setSftpBusy(true)
      await api.current?.renamePath(source, destination)
      await refreshRemoteDirectory(remotePath)
    } catch (error) {
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSftpBusy(false)
    }
  }

  async function deleteRemoteEntry(entry: SftpEntry) {
    const target = childRemotePath(entry.name)
    const confirmation =
      entry.kind === 'symlink'
        ? `Delete symbolic link ${target}? This unlinks the link itself; its target is not followed.`
        : `Delete remote path ${target}? Empty directories only.`
    if (!window.confirm(confirmation)) return
    setSftpBusy(true)
    try {
      await api.current?.removePath(target)
      await refreshRemoteDirectory(remotePath)
    } catch (error) {
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setSftpBusy(false)
    }
  }

  async function uploadSelectedFile() {
    const file = uploadSelection
    if (!file || !api.current) return
    if (file.size > 16 * 1024 * 1024) {
      setSftpStatus('Uploads must not exceed 16 MiB')
      return
    }
    setSftpBusy(true)
    setSftpStatus(`Uploading ${file.name}…`)
    let data: Uint8Array | undefined
    try {
      data = new Uint8Array(await file.arrayBuffer())
      sensitiveBuffers.current.add(data)
      const destination = childRemotePath(file.name)
      const sendUpload = async (overwrite: boolean) => {
        const transferData = data!.slice()
        sensitiveBuffers.current.add(transferData)
        try {
          await api.current!.uploadFile(destination, transferData, overwrite)
        } finally {
          transferData.fill(0)
          sensitiveBuffers.current.delete(transferData)
        }
      }
      try {
        await sendUpload(false)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('confirm replacement to overwrite')) throw error
        const confirmed = window.confirm(
          `Remote file ${file.name} already exists. Replace it? The replacement is atomic and cannot be undone.`,
        )
        if (!confirmed) {
          setSftpStatus('Upload cancelled; remote file was not changed')
          return
        }
        await sendUpload(true)
      }
      setUploadSelection(undefined)
      if (uploadInput.current) uploadInput.current.value = ''
      await refreshRemoteDirectory(remotePath)
    } catch (error) {
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      if (data) {
        data.fill(0)
        sensitiveBuffers.current.delete(data)
      }
      setSftpBusy(false)
    }
  }

  async function downloadRemoteFile(entry: SftpEntry) {
    setSftpBusy(true)
    setSftpStatus(`Downloading ${entry.name}…`)
    let data: Uint8Array | undefined
    try {
      data = await api.current!.downloadFile(childRemotePath(entry.name))
      const blob = new Blob([data])
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = entry.name
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      data.fill(0)
      setSftpStatus(`Downloaded ${entry.name}`)
    } catch (error) {
      setSftpStatus(error instanceof Error ? error.message : String(error))
    } finally {
      data?.fill(0)
      setSftpBusy(false)
    }
  }

  async function connect() {
    const selectedKeyFile = authMethod === 'private-key' ? privateKeyFile : undefined
    const hasCredential = authMethod === 'password' ? Boolean(password) : Boolean(selectedKeyFile)
    if (!permitted || !username.trim() || !hasCredential) return
    if (selectedKeyFile && (selectedKeyFile.size === 0 || selectedKeyFile.size > 64 * 1024)) {
      setStatus('Private-key files must be between 1 byte and 64 KiB')
      return
    }
    setBusy(true)
    setStatus('Requesting local network connection…')
    let socket: InstanceType<NonNullable<DirectSocketEnvironment['TCPSocket']>> | undefined
    let privateKeyBytes: Uint8Array | undefined
    let passphraseBytes: Uint8Array | undefined
    try {
      const Socket = (globalThis as DirectSocketEnvironment).TCPSocket
      if (!Socket) throw new Error('Chrome IWA Direct Sockets is unavailable')
      // Construct synchronously in the Connect click handler so Chrome can show its
      // Local Network permission prompt while user activation is still present.
      socket = new Socket(host.trim(), IWA_SSH_PORT, { keepAlive: false, noDelay: true })
      let socketTimeout: number | undefined
      try {
        await Promise.race([
          socket.opened,
          new Promise<never>((_, reject) => {
            socketTimeout = window.setTimeout(
              () =>
                reject(
                  new Error(
                    'TCP connection timed out. Allow Local Network access for this IWA in Chrome, then retry.',
                  ),
                ),
              12_000,
            )
          }),
        ])
      } finally {
        if (socketTimeout !== undefined) window.clearTimeout(socketTimeout)
      }
      await loadSshWasm()
      const client = window.wrenchIwaSsh
      if (!client) throw new Error('SSH client unavailable')
      const initialDimensions = terminalDimensions.current
      resizeScheduler.current?.cancel()
      resizeScheduler.current = createTerminalResizeScheduler(
        (cols, rows) => api.current?.resize(cols, rows) ?? Promise.resolve(),
        (error) => setStatus('Terminal resize failed: ' + String(error)),
      )
      resizeScheduler.current.setInitial(initialDimensions)
      if (selectedKeyFile) {
        privateKeyBytes = new Uint8Array(await selectedKeyFile.arrayBuffer())
        passphraseBytes = new TextEncoder().encode(privateKeyPassphrase)
        sensitiveBuffers.current.add(privateKeyBytes)
        sensitiveBuffers.current.add(passphraseBytes)
      }
      await client.connect({
        host: host.trim(),
        port: IWA_SSH_PORT,
        cols: initialDimensions.cols,
        rows: initialDimensions.rows,
        socket,
        username: username.trim(),
        ...(privateKeyBytes
          ? { privateKey: privateKeyBytes, privateKeyPassphrase: passphraseBytes }
          : { password }),
        confirmHostKey: async (target, type, fingerprint) => {
          return confirmAndPinHostKey(
            target,
            IWA_SSH_PORT,
            fingerprint,
            window.localStorage,
            (firstFingerprint) =>
              window.confirm(
                `First connection to ${target}:${IWA_SSH_PORT}\n${type}\n${firstFingerprint}\n\nVerify this fingerprint with the device owner using a trusted channel before accepting. Store this trust pin in this browser profile?`,
              ),
            (pinned, presented) =>
              window.confirm(
                `SSH host key changed for ${target}:${IWA_SSH_PORT}.\nPreviously trusted: ${pinned}\nPresented: ${presented}\n\nOnly renew this pin if you verified the new fingerprint with the device owner through a separate trusted channel. Replace the saved pin and continue?`,
              ),
          )
        },
        onData: (data) => terminal.current?.write(data),
      })
      api.current = client
      setConnected(true)
      queueTerminalResize()
      void refreshRemoteDirectory('.')
      if (authMethod === 'password') {
        setPassword('')
        setStatus(`Connected to ${host.trim()}; password cleared from the form`)
      } else {
        setPrivateKeyFile(undefined)
        setPrivateKeyPassphrase('')
        if (privateKeyInput.current) privateKeyInput.current.value = ''
        setStatus(`Connected to ${host.trim()} with a local private key; key fields cleared`)
      }
      terminal.current?.focus()
    } catch (error) {
      resizeScheduler.current?.cancel()
      resizeScheduler.current = undefined
      if (socket) await Promise.resolve(socket.close()).catch(() => undefined)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      privateKeyBytes?.fill(0)
      passphraseBytes?.fill(0)
      if (privateKeyBytes) sensitiveBuffers.current.delete(privateKeyBytes)
      if (passphraseBytes) sensitiveBuffers.current.delete(passphraseBytes)
      if (selectedKeyFile) {
        setPrivateKeyFile(undefined)
        setPrivateKeyPassphrase('')
        if (privateKeyInput.current) privateKeyInput.current.value = ''
      }
      setBusy(false)
    }
  }

  async function disconnect() {
    resizeScheduler.current?.cancel()
    setBusy(true)
    try {
      await api.current?.close()
      api.current = undefined
      resizeScheduler.current = undefined
      setConnected(false)
      setRemotePath('.')
      setRemoteEntries([])
      setSftpStatus('Connect to load remote files')
      setStatus('Disconnected')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      for (const buffer of sensitiveBuffers.current) buffer.fill(0)
      sensitiveBuffers.current.clear()
      setUploadSelection(undefined)
      if (uploadInput.current) uploadInput.current.value = ''
      setPassword('')
      setPrivateKeyFile(undefined)
      setPrivateKeyPassphrase('')
      if (privateKeyInput.current) privateKeyInput.current.value = ''
      setBusy(false)
    }
  }

  function changeAuthMethod(method: 'password' | 'private-key') {
    setAuthMethod(method)
    setPassword('')
    setPrivateKeyFile(undefined)
    setPrivateKeyPassphrase('')
    if (privateKeyInput.current) privateKeyInput.current.value = ''
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h2 className="mb-2 text-lg font-semibold">Browser-side SSH (IWA only)</h2>
      <p className="mb-4 text-sm text-amber-200">
        Experimental password/private-key SSH terminal and SFTP file transfer. Credentials and SSH
        traffic stay in this browser; this app does not send them to Wrench servers. Host keys use
        browser-local TOFU pinning; independently verify the first fingerprint, and verify a changed
        fingerprint before explicitly renewing its pin.
      </p>
      {!capability.available && (
        <p className="mb-3 text-sm text-rose-300">
          Direct Sockets unavailable: {capability.reason}. Install a supported signed IWA in Chrome.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Private IP address
          <input
            className="mt-1 w-full rounded bg-slate-800 p-2"
            autoComplete="off"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.20 or fd00::20"
          />
        </label>
        <label className="text-sm">
          SSH username
          <input
            className="mt-1 w-full rounded bg-slate-800 p-2"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Authentication
          <select
            className="mt-1 w-full rounded bg-slate-800 p-2"
            value={authMethod}
            disabled={busy || connected}
            onChange={(e) => changeAuthMethod(e.target.value as 'password' | 'private-key')}
          >
            <option value="password">Password</option>
            <option value="private-key">Private key</option>
          </select>
        </label>
        {authMethod === 'password' ? (
          <label className="text-sm">
            SSH password (browser memory only)
            <input
              className="mt-1 w-full rounded bg-slate-800 p-2"
              type="password"
              autoComplete="off"
              value={password}
              disabled={busy || connected}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="text-sm">
              SSH private-key file (max 64 KiB)
              <input
                ref={privateKeyInput}
                className="mt-1 block w-full rounded bg-slate-800 p-2"
                type="file"
                aria-label="SSH private-key file"
                disabled={busy || connected}
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0]
                  if (file && file.size > 64 * 1024) {
                    setPrivateKeyFile(undefined)
                    e.currentTarget.value = ''
                    setStatus('Private-key files must not exceed 64 KiB')
                  } else {
                    setPrivateKeyFile(file)
                    setStatus(file ? `Selected local key: ${file.name}` : 'Disconnected')
                  }
                }}
              />
            </label>
            <label className="text-sm">
              Key passphrase (optional)
              <input
                className="mt-1 w-full rounded bg-slate-800 p-2"
                type="password"
                autoComplete="off"
                value={privateKeyPassphrase}
                disabled={busy || connected}
                onChange={(e) => setPrivateKeyPassphrase(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      <p className="my-2 text-xs text-slate-400">
        Only RFC1918 IPv4 and IPv6 ULA literals on port {IWA_SSH_PORT}; hostnames, public IPs,
        loopback, link-local and alternate ports are rejected.
      </p>
      <p className="mb-3 text-xs text-amber-100">
        Pressing Connect opens one TCP connection to the entered private IP on port {IWA_SSH_PORT}.
        Chrome may also ask you to allow this IWA to access local network devices.
      </p>
      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-blue-700 px-3 py-2 disabled:opacity-50"
          disabled={
            busy ||
            !capability.available ||
            !permitted ||
            !username ||
            (authMethod === 'password' ? !password : !privateKeyFile) ||
            connected
          }
          onClick={() => void connect()}
        >
          Connect
        </button>
        <button
          className="rounded bg-slate-700 px-3 py-2 disabled:opacity-50"
          disabled={busy || !connected}
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
        <span className="self-center text-sm text-slate-300">{status}</span>
      </div>
      <div
        ref={termContainer}
        className="h-[min(60vh,32rem)] min-h-48 overflow-hidden rounded border border-slate-700 p-2"
        aria-label="SSH terminal"
      />
      <section
        aria-label="SFTP file transfer"
        className="mt-5 rounded-lg border border-slate-700 p-3"
      >
        <h3 className="mb-2 font-semibold">SFTP files</h3>
        <p className="mb-3 text-xs text-slate-300">
          Uses the same pinned SSH connection and account permissions. Files are limited to 16 MiB
          per transfer. Replacing a regular file requires confirmation; symlinks cannot be opened,
          renamed, or replaced. Rename stays in this directory and never replaces an existing path.
          Remote permissions follow server defaults. Path checks are not a filesystem sandbox.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span data-testid="sftp-path" className="mr-auto font-mono text-sm break-all">
            {remotePath}
          </span>
          <button
            className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50"
            disabled={!connected || sftpBusy || remotePath === '.' || remotePath === '/'}
            onClick={() => {
              const parent =
                remotePath === '.' || remotePath === '/'
                  ? remotePath
                  : remotePath.lastIndexOf('/') < 0
                    ? '.'
                    : remotePath.lastIndexOf('/') === 0
                      ? '/'
                      : remotePath.slice(0, remotePath.lastIndexOf('/'))
              void refreshRemoteDirectory(parent)
            }}
          >
            Parent
          </button>
          <button
            className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50"
            disabled={!connected || sftpBusy}
            onClick={() => void refreshRemoteDirectory()}
          >
            Refresh
          </button>
          <button
            className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50"
            disabled={!connected || sftpBusy}
            onClick={() => void createRemoteDirectory()}
          >
            New folder
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            ref={uploadInput}
            aria-label="Upload file"
            type="file"
            disabled={!connected || sftpBusy}
            onChange={(event) => setUploadSelection(event.currentTarget.files?.[0])}
          />
          <button
            className="rounded bg-blue-700 px-3 py-1 disabled:opacity-50"
            disabled={!connected || sftpBusy || !uploadSelection}
            onClick={() => void uploadSelectedFile()}
          >
            Upload
          </button>
          <span data-testid="sftp-status" className="text-xs text-slate-300">
            {sftpStatus}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="p-2">Name</th>
                <th className="p-2">Type</th>
                <th className="p-2">Size</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {remoteEntries.map((entry) => (
                <tr
                  key={entry.name}
                  data-testid={`sftp-entry-${entry.name}`}
                  className="border-b border-slate-800"
                >
                  <td className="max-w-64 p-2 break-all">
                    {entry.kind === 'directory' ? (
                      <button
                        className="text-sky-300 underline"
                        disabled={sftpBusy}
                        onClick={() => void refreshRemoteDirectory(childRemotePath(entry.name))}
                      >
                        {entry.name}/
                      </button>
                    ) : (
                      entry.name
                    )}
                  </td>
                  <td className="p-2">{entry.kind}</td>
                  <td className="p-2">
                    {entry.kind === 'file' ? entry.size.toLocaleString() : '—'}
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {entry.kind === 'file' && (
                        <button
                          className="rounded bg-slate-700 px-2 py-1"
                          disabled={sftpBusy}
                          onClick={() => void downloadRemoteFile(entry)}
                        >
                          Download {entry.name}
                        </button>
                      )}
                      {entry.kind !== 'symlink' && (
                        <button
                          className="rounded bg-slate-700 px-2 py-1"
                          disabled={sftpBusy}
                          onClick={() => void renameRemoteEntry(entry)}
                        >
                          Rename {entry.name}
                        </button>
                      )}
                      <button
                        className="rounded bg-rose-900 px-2 py-1"
                        disabled={sftpBusy}
                        onClick={() => void deleteRemoteEntry(entry)}
                      >
                        Delete {entry.name}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
