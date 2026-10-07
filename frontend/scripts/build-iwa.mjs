import { spawnSync } from 'node:child_process'
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(frontendDir, '..')
const goDir = path.join(repoDir, 'browser-iwa', 'ssh-client')
const publicDir = path.join(repoDir, 'browser-iwa', 'public')
const output = path.join(publicDir, 'ssh.wasm')
await mkdir(publicDir, { recursive: true })
const buildArgs = ['build', '-trimpath']
if (process.env.WRENCH_IWA_SMOKE_BUILD === '1') buildArgs.push('-tags=iwa_smoke')
buildArgs.push('-o', output, '.')
const build = spawnSync('go', buildArgs, {
  cwd: goDir,
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)
const goroot = spawnSync('go', ['env', 'GOROOT'], { encoding: 'utf8' })
if (goroot.status !== 0) process.exit(goroot.status ?? 1)
const runtimePath = path.join(goroot.stdout.trim(), 'lib', 'wasm', 'wasm_exec.js')
await cp(runtimePath, path.join(publicDir, 'wasm_exec.js'))
const vite = spawnSync(
  process.execPath,
  [
    path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    'vite.iwa.config.ts',
  ],
  {
    cwd: frontendDir,
    stdio: 'inherit',
  },
)
process.exit(vite.status ?? 1)
