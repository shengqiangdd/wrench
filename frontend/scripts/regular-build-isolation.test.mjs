import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const buildDir = path.join(frontendDir, 'dist')

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(dir, entry.name)
      return entry.isDirectory() ? filesUnder(entryPath) : [entryPath]
    }),
  )
  return nested.flat()
}

test('regular frontend build does not include the IWA TCP probe UI', async () => {
  const files = await filesUnder(buildDir)
  const contents = await Promise.all(files.map((file) => readFile(file)))
  const bundleText = Buffer.concat(contents).toString('utf8')
  assert.equal(bundleText.includes('这里只测试 TCP 传输'), false)
  assert.equal(bundleText.includes('私网 IP 地址'), false)
})
