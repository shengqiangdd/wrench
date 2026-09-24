import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import {
  getDirectSocketsStatus,
  isAllowedSshTcpTarget,
  type DirectSocketEnvironment,
} from '../services/browser-direct-tcp'
import { confirmAndPinHostKey } from './hostkey-pinning'

type IwaSshApi = {
  connect: (options: {
    host: string
    port: number
    socket: InstanceType<NonNullable<DirectSocketEnvironment['TCPSocket']>>
    username: string
    password?: string
    privateKey?: Uint8Array
    privateKeyPassphrase?: Uint8Array
    confirmHostKey: (host: string, keyType: string, fingerprint: string) => Promise<boolean>
    onData: (data: Uint8Array) => void
  }) => Promise<void>
  send: (text: string) => Promise<void>
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
  const privateKeyInput = useRef<HTMLInputElement>(null)
  const termContainer = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | undefined>(undefined)
  const api = useRef<IwaSshApi | undefined>(undefined)
  const capability = getDirectSocketsStatus()
  const permitted = isAllowedSshTcpTarget(host.trim(), 22)

  useEffect(() => {
    if (!termContainer.current) return
    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      theme: { background: '#020617' },
    })
    term.open(termContainer.current)
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
      term.dispose()
      terminal.current = undefined
    }
  }, [])

  useEffect(
    () => () => {
      if (api.current) void api.current.close()
    },
    [],
  )

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
      socket = new Socket(host.trim(), 22, { keepAlive: false, noDelay: true })
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
      if (selectedKeyFile) {
        privateKeyBytes = new Uint8Array(await selectedKeyFile.arrayBuffer())
        passphraseBytes = new TextEncoder().encode(privateKeyPassphrase)
      }
      await client.connect({
        host: host.trim(),
        port: 22,
        socket,
        username: username.trim(),
        ...(privateKeyBytes
          ? { privateKey: privateKeyBytes, privateKeyPassphrase: passphraseBytes }
          : { password }),
        confirmHostKey: async (target, type, fingerprint) => {
          return confirmAndPinHostKey(
            target,
            22,
            fingerprint,
            window.localStorage,
            (firstFingerprint) =>
              window.confirm(
                `First connection to ${target}:22\n${type}\n${firstFingerprint}\n\nVerify this fingerprint with the device owner using a trusted channel before accepting. Store this trust pin in this browser profile?`,
              ),
            (pinned, presented) =>
              window.confirm(
                `SSH host key changed for ${target}:22.\nPreviously trusted: ${pinned}\nPresented: ${presented}\n\nOnly renew this pin if you verified the new fingerprint with the device owner through a separate trusted channel. Replace the saved pin and continue?`,
              ),
          )
        },
        onData: (data) => terminal.current?.write(data),
      })
      api.current = client
      setConnected(true)
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
      if (socket) await Promise.resolve(socket.close()).catch(() => undefined)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      privateKeyBytes?.fill(0)
      passphraseBytes?.fill(0)
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await api.current?.close()
      api.current = undefined
      setConnected(false)
      setStatus('Disconnected')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
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
        Experimental password/private-key + interactive shell vertical slice. Credentials and SSH
        traffic stay in this browser; this app does not send them to Wrench servers. Host keys use
        browser-local TOFU pinning; the first fingerprint must be independently checked. A changed
        key is rejected. No SFTP.
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
        Only RFC1918 IPv4 and IPv6 ULA literals on port 22; hostnames, public IPs, loopback,
        link-local and alternate ports are rejected.
      </p>
      <p className="mb-3 text-xs text-amber-100">
        Pressing Connect opens one TCP connection to the entered private IP on port 22. Chrome may
        also ask you to allow this IWA to access local network devices.
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
        className="h-80 overflow-hidden rounded border border-slate-700 p-2"
        aria-label="SSH terminal"
      />
    </section>
  )
}
