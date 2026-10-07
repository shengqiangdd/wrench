import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const configPath = path.join(frontendDir, 'vite.iwa.config.ts')
const source = await readFile(configPath, 'utf8')

test('IWA SSH port defaults to 22 and can be overridden for smoke builds', () => {
  assert.match(source, /process\.env\.VITE_IWA_SSH_PORT\s*\?\?\s*22/)
  assert.match(source, /__WRENCH_IWA_SSH_PORT__:\s*JSON\.stringify\(sshPort\)/)
  assert.match(source, /sshPort < 1 \|\| sshPort > 65535/)
})
