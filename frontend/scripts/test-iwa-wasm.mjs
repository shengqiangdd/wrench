import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { webcrypto } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(frontendDir, '..')
const goDir = path.join(repoDir, 'browser-iwa', 'ssh-client')
const wasmPath = path.join(repoDir, 'browser-iwa', 'public', 'ssh.wasm')
const runtimePath = path.join(repoDir, 'browser-iwa', 'public', 'wasm_exec.js')
const require = createRequire(import.meta.url)

async function expectResizeFailure(promise, message) {
  try {
    await promise
  } catch (error) {
    if (String(error).includes(message)) return
    throw error
  }
  throw new Error('expected resize to reject with ' + message)
}

async function run() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wrench-iwa-wasm-test-'))
  const serverPath = path.join(
    tempDir,
    process.platform === 'win32' ? 'testserver.exe' : 'testserver',
  )
  const build = spawnSync('go', ['build', '-o', serverPath, './testserver'], {
    cwd: goDir,
    stdio: 'inherit',
  })
  if (build.status !== 0) {
    await rm(tempDir, { recursive: true, force: true })
    throw new Error(`mock SSH server build failed (${build.status ?? build.error})`)
  }
  const server = spawn(serverPath, [], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    let portBuffer = ''
    const serverLines = []
    let portReceived = false
    const sshPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('mock SSH server startup timed out')),
        30_000,
      )
      server.once('error', reject)
      server.stdout.setEncoding('utf8')
      server.stdout.on('data', (chunk) => {
        portBuffer += chunk
        let newline = portBuffer.indexOf('\n')
        while (newline !== -1) {
          const line = portBuffer.slice(0, newline).trim()
          portBuffer = portBuffer.slice(newline + 1)
          if (!portReceived) {
            portReceived = true
            clearTimeout(timeout)
            resolve(Number(line))
          } else {
            serverLines.push(line)
          }
          newline = portBuffer.indexOf('\n')
        }
      })
    })
    if (!sshPort) throw new Error('mock SSH server returned an invalid port')

    class TestTcpSocket {
      constructor() {
        const socket = net.createConnection({ host: '127.0.0.1', port: sshPort })
        this.socket = socket
        this.opened = new Promise((resolve, reject) => {
          const readable = new ReadableStream({
            start(controller) {
              socket.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk)))
              socket.once('end', () => controller.close())
              socket.once('error', (error) => controller.error(error))
            },
            cancel() {
              socket.destroy()
            },
          })
          const writable = new WritableStream({
            write(data) {
              return new Promise((writeResolve, writeReject) =>
                socket.write(Buffer.from(data), (error) =>
                  error ? writeReject(error) : writeResolve(),
                ),
              )
            },
            close() {
              socket.end()
            },
            abort(reason) {
              socket.destroy(reason instanceof Error ? reason : undefined)
            },
          })
          socket.once('connect', () => resolve({ readable, writable }))
          socket.once('error', reject)
        })
      }
      async close() {
        this.socket.destroy()
      }
    }

    globalThis.TCPSocket = TestTcpSocket
    globalThis.crypto ??= webcrypto
    require(runtimePath)
    const go = new globalThis.Go()
    const wasm = await readFile(wasmPath)
    const { instance } = await WebAssembly.instantiate(wasm, go.importObject)
    let wasmError
    void go.run(instance).catch((error) => {
      wasmError = error
    })
    const apiStarted = Date.now()
    while (!globalThis.wrenchIwaSsh && !wasmError && Date.now() - apiStarted < 5000) await delay(10)
    if (wasmError) throw wasmError
    if (!globalThis.wrenchIwaSsh) throw new Error('Go SSH WASM API did not start')

    let terminalOutput = ''
    const deadline = (promise, message, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
    await deadline(
      globalThis.wrenchIwaSsh.connect({
        host: '192.168.1.8',
        port: 22,
        username: 'iwa-test',
        password: 'integration-secret',
        confirmHostKey: async (_host, type, fingerprint) =>
          type === 'ssh-ed25519' && fingerprint.startsWith('SHA256:'),
        onData: (bytes) => {
          terminalOutput += new TextDecoder().decode(bytes)
        },
      }),
      'WASM SSH authentication/shell startup timed out',
    )
    const waitForOutput = async (needle) => {
      const start = Date.now()
      while (!terminalOutput.includes(needle) && Date.now() - start < 5000) await delay(10)
      if (!terminalOutput.includes(needle)) {
        throw new Error(
          `terminal output missing ${JSON.stringify(needle)}: ${JSON.stringify(terminalOutput)}`,
        )
      }
    }
    await waitForOutput('ready')
    await globalThis.wrenchIwaSsh.send('terminal-input-output-check\n')
    await waitForOutput('terminal-input-output-check')
    await globalThis.wrenchIwaSsh.resize(110, 40)
    const serverResizeStarted = Date.now()
    while (!serverLines.includes('WINDOW_CHANGE 110 40') && Date.now() - serverResizeStarted < 5000)
      await delay(10)
    if (!serverLines.includes('WINDOW_CHANGE 110 40'))
      throw new Error('SSH server did not receive window-change 110x40: ' + serverLines.join('|'))
    await expectResizeFailure(globalThis.wrenchIwaSsh.resize(0, 24), 'columns')
    await globalThis.wrenchIwaSsh.close()
    console.log(
      'Go/WASM SSH adapter E2E passed: host-key callback, password auth, PTY shell, terminal I/O, and bounded SSH window-change.',
    )
  } finally {
    try {
      await globalThis.wrenchIwaSsh?.close()
    } catch {}
    server.kill('SIGTERM')
    await new Promise((resolve) => {
      if (server.exitCode !== null || server.signalCode !== null) {
        resolve()
        return
      }
      const timeout = setTimeout(() => {
        server.kill('SIGKILL')
        resolve()
      }, 5000)
      server.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
    await rm(tempDir, { recursive: true, force: true })
  }
}

await run()
