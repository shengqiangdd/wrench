import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { getDirectSocketsStatus, isAllowedSshTcpTarget } from '../services/browser-direct-tcp'
import { confirmAndPinHostKey } from './hostkey-pinning'

type IwaSshApi = {
  connect: (options: {
    host: string
    port: number
    username: string
    password: string
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
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState('Disconnected')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
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
    if (
      !permitted ||
      !username.trim() ||
      !password ||
      !window.confirm(`Open a local TCP connection to ${host.trim()}:22 from this installed IWA?`)
    )
      return
    setBusy(true)
    setStatus('Starting browser SSH client…')
    try {
      await loadSshWasm()
      const client = window.wrenchIwaSsh
      if (!client) throw new Error('SSH client unavailable')
      await client.connect({
        host: host.trim(),
        port: 22,
        username: username.trim(),
        password,
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
              window.alert(
                `SSH host key changed for ${target}:22. Connection refused.\nPreviously trusted: ${pinned}\nPresented: ${presented}`,
              ),
          )
        },
        onData: (data) => terminal.current?.write(data),
      })
      api.current = client
      setConnected(true)
      setPassword('')
      setStatus(`Connected to ${host.trim()}; password cleared from the form`)
      terminal.current?.focus()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
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
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <h2 className="mb-2 text-lg font-semibold">Browser-side SSH (IWA only)</h2>
      <p className="mb-4 text-sm text-amber-200">
        Experimental password + interactive shell vertical slice. Credentials and SSH traffic stay
        in this browser; this app does not send them to Wrench servers. Host keys use browser-local
        TOFU pinning; the first fingerprint must be independently checked. A changed key is
        rejected. No SFTP.
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
        <label className="text-sm sm:col-span-2">
          SSH password (memory only)
          <input
            className="mt-1 w-full rounded bg-slate-800 p-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <p className="my-2 text-xs text-slate-400">
        Only RFC1918 IPv4 and IPv6 ULA literals on port 22; hostnames, public IPs, loopback,
        link-local and alternate ports are rejected.
      </p>
      <div className="mb-3 flex gap-2">
        <button
          className="rounded bg-blue-700 px-3 py-2 disabled:opacity-50"
          disabled={
            busy || !capability.available || !permitted || !username || !password || connected
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
