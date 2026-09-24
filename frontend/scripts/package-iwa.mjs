import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const iwaDir = path.resolve(frontendDir, '../browser-iwa')
const key = process.env.WRENCH_IWA_SIGNING_KEY
const unsignedBundle = path.join(iwaDir, 'wrench-browser-iwa.wbn')
const signedBundle = path.join(iwaDir, 'wrench-browser-iwa.swbn')
if (!key) {
  throw new Error(
    'Set WRENCH_IWA_SIGNING_KEY to an Ed25519 PEM private key; never commit or publish the key.',
  )
}
if (!existsSync(key)) throw new Error(`Signing key does not exist: ${key}`)
const bin = (name) => path.join(frontendDir, 'node_modules', '.bin', name)
const run = (name, args) => execFileSync(bin(name), args, { stdio: 'inherit' })
const bundleId = execFileSync(bin('wbn-dump-id'), ['--with-iwa-scheme', '--key', key], {
  encoding: 'utf8',
}).trim()
if (!/^isolated-app:\/\/[a-z0-9-]+\/$/.test(bundleId))
  throw new Error(`Unexpected IWA bundle ID: ${bundleId}`)
rmSync(unsignedBundle, { force: true })
rmSync(signedBundle, { force: true })
try {
  run('wbn', [
    '--dir',
    path.join(iwaDir, 'dist'),
    '--baseURL',
    bundleId,
    '--output',
    unsignedBundle,
  ])
  run('wbn-sign', ['sign', '-o', signedBundle, unsignedBundle, key])
} catch (error) {
  rmSync(signedBundle, { force: true })
  throw error
} finally {
  rmSync(unsignedBundle, { force: true })
}
console.log(`Created ${signedBundle} for ${bundleId}`)
