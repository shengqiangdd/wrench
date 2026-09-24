import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const manifestPath = path.resolve(
  frontendDir,
  '../browser-iwa/public/.well-known/manifest.webmanifest',
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

test('IWA manifest enables Direct Sockets and cross-origin isolation', () => {
  assert.ok(manifest.version)
  assert.deepEqual(manifest.permissions_policy['direct-sockets'], ['self'])
  assert.deepEqual(manifest.permissions_policy['cross-origin-isolated'], ['self'])
  assert.equal(manifest.start_url, '/')
})
