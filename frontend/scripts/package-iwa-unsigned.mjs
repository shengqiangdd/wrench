import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const iwaDir = path.resolve(frontendDir, '../browser-iwa')
const distDir = path.join(iwaDir, 'dist')
const bundle = path.join(iwaDir, 'wrench-browser-iwa-preview-unsigned.wbn')
if (!existsSync(distDir)) throw new Error('Build the IWA assets first with npm run build:iwa')

rmSync(bundle, { force: true })
try {
  execFileSync(
    path.join(frontendDir, 'node_modules', '.bin', 'wbn'),
    [
      '--dir',
      distDir,
      '--baseURL',
      'https://wrench-browser-iwa-unsigned.invalid/',
      '--output',
      bundle,
    ],
    { stdio: 'inherit' },
  )
  if (!statSync(bundle).size) throw new Error('Unsigned preview bundle is empty')
} catch (error) {
  rmSync(bundle, { force: true })
  throw error
}
console.log(
  `Created ${bundle}. This generic unsigned preview is for archive inspection only and cannot be installed as an IWA.`,
)
