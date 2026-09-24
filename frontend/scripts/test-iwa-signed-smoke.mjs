import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium as playwrightChromium } from '@playwright/test'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(frontendDir, '..')
const sshDir = path.join(repoDir, 'browser-iwa', 'ssh-client')
const toolsDir = path.join(frontendDir, 'node_modules', '.bin')
const permissionsTimeoutMs = 12_000
const tempRoot = await mkdtemp('/tmp/wrench-iwa-signed-smoke-')
await chmod(tempRoot, 0o700)
const generatedOutputs = [
  path.join(repoDir, 'browser-iwa', 'public', 'ssh.wasm'),
  path.join(repoDir, 'browser-iwa', 'public', 'wasm_exec.js'),
  path.join(repoDir, 'browser-iwa', 'dist'),
]
let outputsCreatedByTest = []

let browserProcess
let browser
let sshProcess
let cleanupStarted = false

async function stopProcessGroup(child, label) {
  if (!child?.pid) return
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal)
    } catch {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    }
  }

  signalGroup('SIGTERM')
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5_000)])
  }
  // The group leader can exit before Chromium/sudo descendants do; always clear the group.
  signalGroup('SIGKILL')
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2_000)])
  }
  if (child.exitCode === null && child.signalCode === null)
    console.warn(`Timed out stopping ${label} process group ${child.pid}`)
}

async function cleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  await browser?.close().catch(() => undefined)
  await stopProcessGroup(browserProcess, 'Chromium')
  await stopProcessGroup(sshProcess, 'SSH smoke server')
  await rm(tempRoot, { recursive: true, force: true })
  await Promise.all(
    outputsCreatedByTest.map((output) => rm(output, { recursive: true, force: true })),
  )
}

process.once('SIGINT', () => void cleanup().finally(() => process.exit(130)))
process.once('SIGTERM', () => void cleanup().finally(() => process.exit(143)))

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? frontendDir,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: process.env,
  })
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status ?? result.signal}):\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout ?? ''
}

function privateIpv4Addresses() {
  const addresses = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue
      const parts = entry.address.split('.').map(Number)
      const [first, second] = parts
      const privateAddress =
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      if (privateAddress) addresses.push(entry.address)
    }
  }
  return addresses
}

function findChromium() {
  if (process.env.WRENCH_IWA_CHROMIUM) return process.env.WRENCH_IWA_CHROMIUM
  for (const candidate of ['/usr/bin/chromium', '/usr/bin/google-chrome']) {
    if (existsSync(candidate)) return candidate
  }
  return playwrightChromium.executablePath()
}

async function serverLines(child, initialText = '') {
  let buffer = initialText
  const lines = []
  let acceptCount = 0
  let readyResolve
  let readyReject
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const onData = (chunk) => {
    buffer += chunk.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      lines.push(line)
      if (line.startsWith('READY ')) readyResolve(line.slice('READY '.length))
      else if (line === 'ACCEPT') acceptCount += 1
      else if (line.startsWith('ERROR ')) readyReject(new Error(line))
    }
  }
  child.stdout.on('data', onData)
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.once('error', readyReject)
  child.once('exit', (code, signal) => {
    if (code !== 0) readyReject(new Error(`SSH server exited (${code ?? signal}): ${stderr}`))
  })
  const timer = setTimeout(
    () => readyReject(new Error(`SSH server startup timed out: ${stderr}`)),
    10_000,
  )
  try {
    const fingerprint = await ready
    return {
      fingerprint,
      get acceptCount() {
        return acceptCount
      },
      get lines() {
        return [...lines]
      },
      stderr: () => stderr,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function startSshServer(address, username, password) {
  const serverBinary = path.join(tempRoot, 'ssh-smoke-server')
  if (!existsSync(serverBinary)) {
    runChecked('go', ['build', '-o', serverBinary, './smoke-server'], { cwd: sshDir })
  }
  const isRoot = process.getuid?.() === 0
  const command = isRoot ? serverBinary : 'sudo'
  const args = isRoot ? [] : ['-n', serverBinary]
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  sshProcess = child
  child.stdin.end(JSON.stringify({ address, username, password }) + '\n')
  return serverLines(child)
}

async function waitForText(page, selector, pattern, timeout = 20_000) {
  await page.waitForFunction(
    ({ selector: target, regex }) => {
      const text = document.querySelector(target)?.textContent ?? ''
      return new RegExp(regex).test(text)
    },
    { selector, regex: pattern.source },
    { timeout },
  )
  return page.locator(selector).innerText()
}

async function openChromium(executable, profile, bundlePath) {
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    `--install-isolated-web-app-from-file=${bundlePath}`,
    'about:blank',
  ]
  if (process.env.WRENCH_IWA_CHROMIUM_NO_SANDBOX === '1') args.unshift('--no-sandbox')

  if (process.getuid?.() === 0 && !args.includes('--no-sandbox')) {
    throw new Error(
      'Chromium refuses to run as root with its sandbox disabled. Use an unprivileged user, or explicitly set WRENCH_IWA_CHROMIUM_NO_SANDBOX=1 only for a disposable test container.',
    )
  }

  browserProcess = spawn(executable, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const waitForPort = new Promise((resolve, reject) => {
    const consume = (chunk) => {
      output += chunk.toString()
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) resolve(Number(match[1]))
    }
    browserProcess.stdout.on('data', consume)
    browserProcess.stderr.on('data', consume)
    browserProcess.once('error', reject)
    browserProcess.once('exit', (code, signal) =>
      reject(new Error(`Chromium exited (${code ?? signal}) before CDP was ready:\n${output}`)),
    )
  })
  const timeout = delay(20_000).then(() => {
    throw new Error(`Timed out waiting for Chromium CDP endpoint:\n${output}`)
  })
  const port = await Promise.race([waitForPort, timeout])
  browser = await playwrightChromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 10_000,
  })
  return output
}

async function waitForTerminal(page, needle) {
  await page.waitForFunction(
    (text) => document.querySelector('.xterm-screen')?.innerText?.includes(text) ?? false,
    needle,
    { timeout: 5_000 },
  )
  return page.locator('.xterm-screen').innerText()
}

async function runSmoke() {
  if (!process.env.DISPLAY) {
    throw new Error('A graphical display is required. Run this script under xvfb-run in CI.')
  }
  if (process.platform !== 'linux')
    throw new Error('The signed IWA smoke test currently supports Linux Chromium only.')

  const address = privateIpv4Addresses()[0]
  if (!address) throw new Error('No RFC1918 IPv4 address is assigned to this machine.')
  const executable = findChromium()
  const version = runChecked(executable, ['--version']).trim()
  console.log(`Chromium: ${version}\nRFC1918 test target: ${address}:22`)
  if (!/^Chrom(?:e|ium)\s+\d+\./.test(version))
    throw new Error(`Unexpected Chromium version output: ${version}`)

  const signingKey = path.join(tempRoot, 'ephemeral-iwa-ed25519.pem')
  const unsignedBundle = path.join(tempRoot, 'test.wbn')
  const signedBundle = path.join(tempRoot, 'test.swbn')
  const profile = path.join(tempRoot, 'chrome-profile')
  const user = `iwa-smoke-${randomBytes(6).toString('hex')}`
  const password = randomBytes(24).toString('base64url')
  const existingOutputs = generatedOutputs.filter(existsSync)
  if (existingOutputs.length) {
    throw new Error(
      `Refusing to overwrite existing generated IWA outputs; move or remove these first: ${existingOutputs.join(', ')}`,
    )
  }
  outputsCreatedByTest = generatedOutputs

  runChecked('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', signingKey])
  await chmod(signingKey, 0o600)
  runChecked('node', ['scripts/build-iwa.mjs'])

  const bundleId = runChecked(path.join(toolsDir, 'wbn-dump-id'), [
    '--with-iwa-scheme',
    '--key',
    signingKey,
  ]).trim()
  if (!/^isolated-app:\/\/[a-z0-9-]+\/$/.test(bundleId))
    throw new Error(`Unexpected ephemeral bundle ID: ${bundleId}`)
  runChecked(path.join(toolsDir, 'wbn'), [
    '--dir',
    path.join(repoDir, 'browser-iwa', 'dist'),
    '--baseURL',
    bundleId,
    '--output',
    unsignedBundle,
  ])
  runChecked(path.join(toolsDir, 'wbn-sign'), [
    'sign',
    '-o',
    signedBundle,
    unsignedBundle,
    signingKey,
  ])
  await rm(unsignedBundle, { force: true })

  await chmod(tempRoot, 0o700)
  await mkdir(profile, { mode: 0o700 })
  await writeFile(
    path.join(profile, 'Local State'),
    JSON.stringify({
      browser: {
        enabled_labs_experiments: [
          'enable-isolated-web-app-dev-mode@1',
          'enable-isolated-web-apps@1',
        ],
      },
    }),
    { mode: 0o600 },
  )

  const server = await startSshServer(address, user, password)
  let currentServer = server
  console.log(`Ephemeral SSH host key: ${server.fingerprint}`)
  await openChromium(executable, profile, signedBundle)

  const context = browser.contexts()[0]
  const internalPage = await context.newPage()
  await internalPage.goto('chrome://web-app-internals/')
  const appList = internalPage.locator('web-app-internals-app')
  await appList.waitFor({ state: 'attached', timeout: 10_000 })
  await internalPage.waitForFunction(
    ({ id }) => {
      const app = document.querySelector('web-app-internals-app')
      return app?.shadowRoot?.querySelector('#json')?.textContent?.includes(id) ?? false
    },
    { id: bundleId.slice('isolated-app://'.length, -1) },
    { timeout: 15_000 },
  )
  const internalJson = await appList.evaluate(
    (element) => element.shadowRoot?.querySelector('#json')?.textContent ?? '',
  )
  if (!internalJson.includes('main.swbn'))
    throw new Error('Chrome did not register the signed bundle as an installed IWA.')

  const cdp = await browser.newBrowserCDPSession()
  await cdp.send('Browser.resetPermissions', { origin: bundleId })
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  const consoleMessages = []
  const externalRequests = []
  page.on('console', (message) => consoleMessages.push(message.text()))
  page.on('request', (request) => {
    if (!request.url().startsWith(bundleId)) externalRequests.push(request.url())
  })

  let firstUsePrompts = 0
  let renewalPrompts = 0
  let dialogFailure = ''
  let previousFingerprint = ''
  page.on('dialog', async (dialog) => {
    const message = dialog.message()
    if (message.startsWith(`First connection to ${address}:22\n`)) {
      firstUsePrompts += 1
      const correct = message.includes('ssh-ed25519') && message.includes(currentServer.fingerprint)
      if (!correct) dialogFailure = `Unexpected first-use host-key prompt: ${message}`
      if (correct) await dialog.accept()
      else await dialog.dismiss()
    } else if (message.startsWith(`SSH host key changed for ${address}:22.`)) {
      renewalPrompts += 1
      const correct =
        message.includes(`Previously trusted: ${previousFingerprint}`) &&
        message.includes(`Presented: ${currentServer.fingerprint}`)
      if (!correct) dialogFailure = `Unexpected host-key renewal prompt: ${message}`
      if (correct) await dialog.accept()
      else await dialog.dismiss()
    } else {
      dialogFailure = `Unexpected browser dialog: ${message}`
      await dialog.dismiss()
    }
  })

  await page.goto(bundleId, { waitUntil: 'domcontentloaded' })
  const capabilities = await page.evaluate(async () => ({
    secure: isSecureContext,
    isolated: crossOriginIsolated,
    tcp: typeof TCPSocket,
    directSockets: document.featurePolicy?.allowsFeature('direct-sockets') ?? false,
    localNetworkPolicy: document.featurePolicy?.allowsFeature('local-network') ?? false,
    localNetwork: (await navigator.permissions.query({ name: 'local-network' })).state,
  }))
  console.log(`Installed IWA capabilities: ${JSON.stringify(capabilities)}`)
  if (
    !capabilities.secure ||
    !capabilities.isolated ||
    capabilities.tcp !== 'function' ||
    !capabilities.directSockets ||
    !capabilities.localNetworkPolicy ||
    capabilities.localNetwork !== 'prompt'
  ) {
    throw new Error(
      `IWA or Local Network permission preconditions failed: ${JSON.stringify(capabilities)}`,
    )
  }

  await page.locator('input').nth(0).fill(address)
  await page.locator('input').nth(1).fill(user)
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  const ungrantedStatus = await waitForText(
    page,
    'section span.self-center.text-sm',
    /TCP connection timed out|not allowed|NotAllowed/i,
    permissionsTimeoutMs + 5_000,
  )
  if (!ungrantedStatus.includes('timed out') && !/not allowed|NotAllowed/i.test(ungrantedStatus))
    throw new Error(`Unexpected result with Local Network permission ungranted: ${ungrantedStatus}`)
  if (currentServer.acceptCount !== 0)
    throw new Error(
      `SSH server received ${currentServer.acceptCount} TCP connections before permission grant.`,
    )
  if (firstUsePrompts || renewalPrompts)
    throw new Error('SSH host-key callback ran before Local Network permission was granted.')
  console.log(
    'Permission gate: prompt state blocked the socket; server accepted zero TCP connections.',
  )

  await cdp.send('Browser.grantPermissions', {
    origin: bundleId,
    permissions: ['localNetwork'],
  })
  const granted = await page.evaluate(
    async () => (await navigator.permissions.query({ name: 'local-network' })).state,
  )
  if (granted !== 'granted') throw new Error(`Local Network permission did not grant: ${granted}`)

  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await waitForText(page, 'section span.self-center.text-sm', /Connected to /)
  if (dialogFailure) throw new Error(dialogFailure)
  if (firstUsePrompts !== 1)
    throw new Error(`Expected one first-use host-key prompt, got ${firstUsePrompts}.`)
  let terminal = await waitForTerminal(page, 'READY')
  await page.locator('.xterm-helper-textarea').focus()
  await page.locator('.xterm-helper-textarea').pressSequentially('signed-iwa-terminal-roundtrip')
  await page.locator('.xterm-helper-textarea').press('Enter')
  terminal = await waitForTerminal(page, 'signed-iwa-terminal-roundtrip')
  if (!terminal.includes('READY')) throw new Error('SSH server shell readiness output was missing.')
  if (await page.locator('input[type=password]').inputValue())
    throw new Error('SSH password remained in the form after successful login.')
  previousFingerprint = currentServer.fingerprint
  const pinStorage = await page.evaluate(() =>
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index) ?? ''
      return [key, localStorage.getItem(key) ?? '']
    }),
  )
  if (
    !pinStorage.some(
      ([key, value]) => key.includes('wrench-iwa-ssh-hostkey-v1') && value === previousFingerprint,
    )
  ) {
    throw new Error('The verified SSH host key was not pinned in IWA-local storage.')
  }
  if (
    pinStorage.some(
      ([key, value]) => key.toLowerCase().includes('password') || value.includes(password),
    )
  )
    throw new Error('SSH password was persisted to IWA local storage.')
  await page.getByRole('button', { name: 'Disconnect' }).click()
  const disconnectedStatus = await waitForText(
    page,
    'section span.self-center.text-sm',
    /Disconnected|close|socket|TCP/i,
    5_000,
  )
  if (disconnectedStatus.trim() !== 'Disconnected')
    throw new Error(`IWA disconnect did not complete cleanly: ${disconnectedStatus}`)

  // Reload to dispose the first WASM session while retaining origin-local host-key pins.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('input').nth(0).waitFor({ state: 'visible' })
  await page.locator('input').nth(0).fill(address)
  await page.locator('input').nth(1).fill(user)

  await stopProcessGroup(sshProcess, 'SSH host-key generation 1')
  sshProcess = undefined
  currentServer = await startSshServer(address, user, password)
  if (currentServer.fingerprint === previousFingerprint)
    throw new Error('Rotated SSH server unexpectedly reused its host key.')
  console.log('Rotated SSH test host key; renewal prompt must show old and new fingerprints.')
  await page.locator('input[type=password]').fill(password)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await waitForText(page, 'section span.self-center.text-sm', /Connected to /)
  if (dialogFailure) throw new Error(dialogFailure)
  if (renewalPrompts !== 1)
    throw new Error(`Expected one host-key renewal prompt, got ${renewalPrompts}.`)
  terminal = await waitForTerminal(page, 'READY')
  if (!terminal.includes('READY'))
    throw new Error('SSH shell did not restart after host-key renewal.')
  if (page.url() !== bundleId)
    throw new Error('IWA navigation escaped its signed isolated-app origin.')
  if (consoleMessages.some((message) => message.includes(password)))
    throw new Error('SSH password appeared in browser console output.')
  if (externalRequests.length)
    throw new Error(`IWA made unexpected external web requests: ${externalRequests.join(', ')}`)
  if (dialogFailure) throw new Error(dialogFailure)
  console.log(
    'PASS: ephemeral signed IWA installed; Direct Sockets permission gate; password SSH; first-use pin and renewal; shell input/output; disconnect; no external web requests or stored/logged password.',
  )
}

try {
  await runSmoke()
} finally {
  await cleanup()
}
