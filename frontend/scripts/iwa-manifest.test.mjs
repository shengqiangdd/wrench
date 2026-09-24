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
  assert.deepEqual(manifest.permissions_policy['local-network'], ['self'])
  assert.equal(manifest.permissions_policy['direct-sockets-private'], undefined)
  assert.deepEqual(manifest.permissions_policy['cross-origin-isolated'], ['self'])
  assert.equal(manifest.start_url, '/')
})

test('IWA manifest uses a Chrome-installable PNG icon at least 144px square', () => {
  const icon = manifest.icons.find((candidate) => candidate.type === 'image/png')
  assert.ok(icon, 'a PNG icon is required for Chrome IWA installation')
  assert.equal(icon.sizes, '192x192')

  const iconPath = path.resolve(frontendDir, '../browser-iwa/public', icon.src.slice(1))
  const png = readFileSync(iconPath)
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.ok(png.readUInt32BE(16) >= 144)
  assert.ok(png.readUInt32BE(20) >= 144)
})
