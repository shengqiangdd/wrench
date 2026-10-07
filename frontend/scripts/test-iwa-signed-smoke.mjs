import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

function runWithInput(command, args, input, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? frontendDir,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  })
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
      get authMethods() {
        return lines.filter((line) => line.startsWith('AUTH ')).map((line) => line.slice(5))
      },
      stderr: () => stderr,
    }
  } finally {
    clearTimeout(timer)
  }
}

async function startSshServer(address, username, password, authorizedKey) {
  const serverBinary = path.join(tempRoot, 'ssh-smoke-helper')
  const isRoot = process.getuid?.() === 0
  const command = isRoot ? serverBinary : 'sudo'
  const args = isRoot ? [] : ['-n', serverBinary]
  const child = spawn(command, args, {
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  sshProcess = child
  child.stdin.end(
    JSON.stringify({ address, username, password, authorized_key: authorizedKey }) + '\n',
  )
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

async function waitForServerLine(server, pattern, timeout = 5_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const line = server.lines.find((candidate) => pattern.test(candidate))
    if (line) return line
    await delay(25)
  }
  throw new Error(`SSH server did not emit ${pattern}; observed: ${server.lines.join('|')}`)
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
  if (!/^(?:Google )?Chrome(?: for Testing)?\s+\d+\.|^Chromium\s+\d+\./.test(version))
    throw new Error(`Unexpected Chromium version output: ${version}`)

  const signingKey = path.join(tempRoot, 'ephemeral-iwa-ed25519.pem')
  const unsignedBundle = path.join(tempRoot, 'test.wbn')
  const signedBundle = path.join(tempRoot, 'test.swbn')
  const profile = path.join(tempRoot, 'chrome-profile')
  const user = `iwa-smoke-${randomBytes(6).toString('hex')}`
  const password = randomBytes(24).toString('base64url')
  const keyPassphrase = randomBytes(24).toString('base64url')
  const privateKeyPath = path.join(tempRoot, 'ssh-login-key')
  const smokeHelper = path.join(tempRoot, 'ssh-smoke-helper')
  const existingOutputs = generatedOutputs.filter(existsSync)
  if (existingOutputs.length) {
    throw new Error(
      `Refusing to overwrite existing generated IWA outputs; move or remove these first: ${existingOutputs.join(', ')}`,
    )
  }
  outputsCreatedByTest = generatedOutputs

  runChecked('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', signingKey])
  runChecked('go', ['build', '-o', smokeHelper, './smoke-server'], { cwd: sshDir })
  const authorizedKey = runWithInput(
    smokeHelper,
    ['keygen'],
    JSON.stringify({ passphrase: keyPassphrase }) + '\n',
    { cwd: tempRoot },
  )
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

  const server = await startSshServer(address, user, password, authorizedKey)
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
  let nextPromptAnswer
  let nextConfirmAnswer
  await page.addInitScript(() => {
    Object.defineProperty(window, 'wrenchIwaSsh', {
      configurable: true,
      get() {
        return this.__wrenchIwaSshForSmoke
      },
      set(api) {
        const connect = api.connect
        api.connect = async (options) => {
          const sensitiveBuffers = [options.privateKey, options.privateKeyPassphrase].filter(
            Boolean,
          )
          try {
            return await connect(options)
          } finally {
            window.__wrenchIwaSensitiveBuffersCleared = sensitiveBuffers.map((buffer) =>
              Array.from(buffer).every((byte) => byte === 0),
            )
          }
        }
        this.__wrenchIwaSshForSmoke = api
      },
    })
  })
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
    } else if (dialog.type() === 'prompt') {
      if (nextPromptAnswer === undefined) {
        dialogFailure = `Unexpected browser prompt: ${message}`
        await dialog.dismiss()
      } else {
        const answer = nextPromptAnswer
        nextPromptAnswer = undefined
        await dialog.accept(answer)
      }
    } else if (dialog.type() === 'confirm' && message.startsWith('Remote file ')) {
      if (nextConfirmAnswer === undefined) {
        dialogFailure = `Unexpected overwrite confirmation: ${message}`
        await dialog.dismiss()
      } else {
        const answer = nextConfirmAnswer
        nextConfirmAnswer = undefined
        if (answer) await dialog.accept()
        else await dialog.dismiss()
      }
    } else if (dialog.type() === 'confirm' && message.startsWith('Rename ')) {
      await dialog.accept()
    } else if (
      dialog.type() === 'confirm' &&
      (message.startsWith('Delete remote path ') || message.startsWith('Delete symbolic link '))
    ) {
      await dialog.accept()
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
  if (!server.authMethods.includes('password'))
    throw new Error('The smoke SSH server did not observe password authentication.')
  if (dialogFailure) throw new Error(dialogFailure)
  if (firstUsePrompts !== 1)
    throw new Error(`Expected one first-use host-key prompt, got ${firstUsePrompts}.`)
  let terminal = await waitForTerminal(page, 'READY')
  const initialPtyLine = await waitForServerLine(server, /^PTY \d+ \d+$/)
  const initialPty = initialPtyLine.match(/^PTY (\d+) (\d+)$/)
  if (!initialPty) throw new Error(`Could not parse initial SSH PTY size: ${initialPtyLine}`)
  const fittedInitial = await page
    .getByLabel('SSH terminal')
    .evaluate((element) => [element.dataset.ptyCols, element.dataset.ptyRows])
  if (initialPty[1] !== fittedInitial[0] || initialPty[2] !== fittedInitial[1])
    throw new Error(
      `Initial server PTY ${initialPty[1]}x${initialPty[2]} did not match fitted xterm ${fittedInitial[0]}x${fittedInitial[1]}`,
    )
  await page.getByLabel('SSH terminal').evaluate((element) => {
    element.style.width = '1000px'
    element.style.height = '620px'
  })
  const resizedPtyLine = await waitForServerLine(server, /^WINDOW_CHANGE \d+ \d+$/)
  const resizedPty = resizedPtyLine.match(/^WINDOW_CHANGE (\d+) (\d+)$/)
  if (!resizedPty) throw new Error(`Could not parse SSH window-change: ${resizedPtyLine}`)
  if (resizedPty[1] === initialPty[1] && resizedPty[2] === initialPty[2])
    throw new Error(
      `Terminal resize did not change PTY dimensions: ${initialPtyLine} -> ${resizedPtyLine}`,
    )
  if (Number(resizedPty[1]) > 500 || Number(resizedPty[2]) > 300)
    throw new Error(`Terminal resize exceeded dimension bounds: ${resizedPtyLine}`)
  const fittedResize = await page
    .getByLabel('SSH terminal')
    .evaluate((element) => [element.dataset.ptyCols, element.dataset.ptyRows])
  if (resizedPty[1] !== fittedResize[0] || resizedPty[2] !== fittedResize[1])
    throw new Error(
      `Remote window-change ${resizedPty[1]}x${resizedPty[2]} did not match fitted xterm ${fittedResize[0]}x${fittedResize[1]}`,
    )
  console.log(`Remote PTY resized: ${initialPtyLine} -> ${resizedPtyLine}`)
  await page.locator('.xterm-helper-textarea').focus()
  await page.locator('.xterm-helper-textarea').pressSequentially('signed-iwa-terminal-roundtrip')
  await page.locator('.xterm-helper-textarea').press('Enter')
  try {
    terminal = await waitForTerminal(page, 'signed-iwa-terminal-roundtrip')
  } catch (error) {
    const status = await page.locator('section span.self-center.text-sm').innerText()
    const sftpStatus = await page.getByTestId('sftp-status').innerText()
    throw new Error(
      `Terminal echo failed (status: ${status}; SFTP: ${sftpStatus}; server: ${server.lines.join('|')}): ${error}`,
    )
  }
  if (!terminal.includes('READY')) throw new Error('SSH server shell readiness output was missing.')

  await page
    .waitForFunction(
      () => document.querySelector('[data-testid="sftp-status"]')?.textContent === '1 entries',
    )
    .catch(async (error) => {
      const status = await page.getByTestId('sftp-status').innerText()
      throw new Error(
        `SFTP symlink fixture listing timed out (status: ${status}; server: ${server.lines.join('|')}): ${error}`,
      )
    })
  const symlinkRow = page.getByTestId('sftp-entry-browser-symlink-dir')
  if (!(await symlinkRow.isVisible())) throw new Error('SFTP symlink fixture was not listed.')
  if (await symlinkRow.getByRole('button', { name: 'browser-symlink-dir/' }).count())
    throw new Error('Browser exposed directory navigation through a symlink.')
  if (await symlinkRow.getByRole('button', { name: 'Rename browser-symlink-dir' }).count())
    throw new Error('Browser exposed rename for a symlink.')
  await symlinkRow.getByRole('button', { name: 'Delete browser-symlink-dir' }).click()
  await symlinkRow.waitFor({ state: 'detached' })
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sftp-status"]')?.textContent === '0 entries',
  )
  nextPromptAnswer = 'reports'
  await page.getByRole('button', { name: 'New folder' }).click()
  await page.getByTestId('sftp-entry-reports').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'reports/' }).click()
  await page
    .getByTestId('sftp-path')
    .getByText('reports')
    .waitFor({ state: 'visible' })
    .catch(async () => {
      await page.waitForFunction(
        () => document.querySelector('[data-testid="sftp-path"]')?.textContent === 'reports',
      )
    })
  const uploadContents = 'signed IWA SFTP roundtrip\n'
  const uploadBuffer = Buffer.from(uploadContents)
  await page.locator('input[aria-label="Upload file"]').setInputFiles({
    name: 'roundtrip.txt',
    mimeType: 'text/plain',
    buffer: uploadBuffer,
  })
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.getByTestId('sftp-entry-roundtrip.txt').waitFor({ state: 'visible' })
  await page.locator('input[aria-label="Upload file"]').setInputFiles({
    name: 'roundtrip.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('overwrite attempt\n'),
  })
  nextConfirmAnswer = false
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="sftp-status"]')
      ?.textContent?.includes('Upload cancelled'),
  )
  nextConfirmAnswer = true
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="sftp-status"]')?.textContent?.includes(' entries'),
  )
  await page.locator('input[aria-label="Upload file"]').setInputFiles({
    name: 'empty.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(0),
  })
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.getByTestId('sftp-entry-empty.txt').waitFor({ state: 'visible' })
  const emptyDownloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download empty.txt' }).click()
  const emptyDownload = await emptyDownloadEvent
  const emptyPath = path.join(tempRoot, 'sftp-empty.txt')
  await emptyDownload.saveAs(emptyPath)
  if ((await readFile(emptyPath)).length !== 0)
    throw new Error('SFTP zero-byte download was not empty.')
  await page.getByRole('button', { name: 'Delete empty.txt' }).click()
  await page.getByTestId('sftp-entry-empty.txt').waitFor({ state: 'detached' })
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download roundtrip.txt' }).click()
  const download = await downloaded
  const downloadedPath = path.join(tempRoot, 'sftp-roundtrip.txt')
  await download.saveAs(downloadedPath)
  if ((await readFile(downloadedPath, 'utf8')) !== 'overwrite attempt\n')
    throw new Error('SFTP download contents did not match the uploaded file.')
  nextPromptAnswer = '../escape'
  await page.getByRole('button', { name: 'Rename roundtrip.txt' }).click()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="sftp-status"]')?.textContent?.includes('without slashes'),
  )
  if (!(await page.getByTestId('sftp-entry-roundtrip.txt').isVisible()))
    throw new Error('Invalid parent traversal rename changed the remote listing.')
  nextPromptAnswer = 'renamed.txt'
  await page.getByRole('button', { name: 'Rename roundtrip.txt' }).click()
  await page.getByTestId('sftp-entry-renamed.txt').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Delete renamed.txt' }).click()
  await page.getByTestId('sftp-entry-renamed.txt').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Parent', exact: true }).click()
  await page.getByTestId('sftp-entry-reports').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Delete reports' }).click()
  await page.getByTestId('sftp-entry-reports').waitFor({ state: 'detached' })
  if (dialogFailure) throw new Error(dialogFailure)

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
  currentServer = await startSshServer(address, user, password, authorizedKey)
  if (currentServer.fingerprint === previousFingerprint)
    throw new Error('Rotated SSH server unexpectedly reused its host key.')
  console.log('Rotated SSH test host key; renewal prompt must show old and new fingerprints.')
  await page.getByLabel('Authentication').selectOption('private-key')
  await page.locator('input[aria-label="SSH private-key file"]').setInputFiles(privateKeyPath)
  await page.getByLabel('Key passphrase (optional)').fill(keyPassphrase)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  try {
    await waitForText(page, 'section span.self-center.text-sm', /Connected to /, 10_000)
  } catch (error) {
    const status = await page.locator('section span.self-center.text-sm').innerText()
    throw new Error(
      `Private-key SSH did not connect (status: ${status}; auth: ${currentServer.authMethods.join(',')}; renewal: ${renewalPrompts}; dialog: ${dialogFailure}): ${error}`,
    )
  }
  if (!currentServer.authMethods.includes('publickey'))
    throw new Error('The smoke SSH server did not observe public-key authentication.')
  if (dialogFailure) throw new Error(dialogFailure)
  if (renewalPrompts !== 1)
    throw new Error(`Expected one host-key renewal prompt, got ${renewalPrompts}.`)
  terminal = await waitForTerminal(page, 'READY')
  if (!terminal.includes('READY'))
    throw new Error('SSH shell did not restart after host-key renewal.')
  if (page.url() !== bundleId)
    throw new Error('IWA navigation escaped its signed isolated-app origin.')
  const privateKeyText = await readFile(privateKeyPath, 'utf8')
  if (
    consoleMessages.some(
      (message) =>
        message.includes(password) ||
        message.includes(keyPassphrase) ||
        message.includes(privateKeyText),
    )
  )
    throw new Error('An SSH credential appeared in browser console output.')
  if (await page.locator('input[aria-label="SSH private-key file"]').inputValue())
    throw new Error('The local private-key file selection remained after authentication.')
  if (await page.getByLabel('Key passphrase (optional)').inputValue())
    throw new Error('The private-key passphrase remained in the form after authentication.')
  const zeroedBuffers = await page.evaluate(() => window.__wrenchIwaSensitiveBuffersCleared)
  if (
    !Array.isArray(zeroedBuffers) ||
    zeroedBuffers.length !== 2 ||
    zeroedBuffers.some((value) => !value)
  )
    throw new Error(
      'The Go/WASM bridge did not zero its JavaScript private-key and passphrase buffers.',
    )
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sftp-status"]')?.textContent === '1 entries',
  )
  const storedCredentials = await page.evaluate(() =>
    Array.from(
      { length: localStorage.length },
      (_, index) => localStorage.getItem(localStorage.key(index) ?? '') ?? '',
    ),
  )
  if (
    storedCredentials.some(
      (value) => value.includes(keyPassphrase) || value.includes(privateKeyText),
    )
  )
    throw new Error('Private-key material or passphrase was persisted to IWA local storage.')
  if (externalRequests.length)
    throw new Error(`IWA made unexpected external web requests: ${externalRequests.join(', ')}`)
  if (dialogFailure) throw new Error(dialogFailure)
  console.log(
    'PASS: ephemeral signed IWA installed; Direct Sockets permission gate; password and encrypted private-key SSH; SFTP list/upload/download/rename/delete/mkdir, including symlink, empty-file, confirmed overwrite and cancellation, and traversal cases; first-use pin and renewal; initial PTY sizing and live window-change resize; shell input/output; disconnect; no external requests or persisted/logged credentials.',
  )
}

try {
  await runSmoke()
} finally {
  await cleanup()
}
