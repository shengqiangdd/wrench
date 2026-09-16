import { describe, expect, it } from 'vitest'
import {
  QUIET_PROGRESS_ENV,
  QUIET_PROGRESS_LEGACY_STORAGE_KEY,
  QUIET_PROGRESS_STORAGE_KEY,
  buildQuietProgressExportLine,
  buildQuietProgressUnsetLine,
  defaultQuietProgress,
  quietProgressVarNames,
  resolveQuietProgress,
} from '../../utils/quiet-env'

/**
 * 这一组变量是"替用户打字"注入到远端 PTY 的，格式必须严格：
 * `export A=1 B=2` 是会被 word split 的语法，值里一旦有空格，
 * 就会退化成 `export A=1 B=2 C D`（多出来的词被当作变量名 → shell 报错，
 * 或者更糟：把值拆坏）。所以这里有针对"名字合法 / 值无空格"的守卫测试。
 */
describe('quiet-env', () => {
  it('注入行是单行 export，包含全部变量与值', () => {
    const line = buildQuietProgressExportLine()
    expect(line.startsWith('export ')).toBe(true)
    expect(line).not.toContain('\n')
    for (const [name, value] of QUIET_PROGRESS_ENV) {
      expect(line).toContain(`${name}=${value}`)
    }
  })

  it('覆盖 docker 全家族：compose / buildkit / docker CLI', () => {
    const names = quietProgressVarNames()
    expect(names).toContain('COMPOSE_PROGRESS')
    expect(names).toContain('BUILDKIT_PROGRESS')
    const line = buildQuietProgressExportLine()
    // compose 的动画进度块（[+] Pulling）与裸 docker build 的 BuildKit TUI 都要转纯文本
    expect(line).toContain('COMPOSE_PROGRESS=plain')
    expect(line).toContain('BUILDKIT_PROGRESS=plain')
  })

  it('不做单行 \\r 进度条的静音（wget/curl/pip/npm/cargo 保留动画）', () => {
    const line = buildQuietProgressExportLine()
    for (const name of [
      'PIP_PROGRESS_BAR',
      'NPM_CONFIG_PROGRESS',
      'CARGO_TERM_PROGRESS_WHEN',
      'WGET_PROGRESS',
    ]) {
      expect(line).not.toContain(name)
    }
  })

  it('变量名合法、值不含空格（否则 export 行会被 word split 拆坏）', () => {
    for (const [name, value] of QUIET_PROGRESS_ENV) {
      expect(name).toMatch(/^[A-Z_][A-Z0-9_]*$/)
      expect(value).not.toMatch(/\s/)
      expect(value).not.toContain("'")
      expect(value).not.toContain('"')
      expect(value).not.toContain(';')
    }
  })

  it('撤销行 unset 掉同一批变量', () => {
    const line = buildQuietProgressUnsetLine()
    expect(line).toBe(`unset ${quietProgressVarNames().join(' ')}`)
    expect(line).not.toContain('=')
  })

  it('注入与撤销行覆盖同一组变量（不会漏掉或多余）', () => {
    const exportNames = buildQuietProgressExportLine()
      .replace(/^export /, '')
      .split(' ')
      .map((kv) => kv.split('=')[0])
      .sort()
    const unsetNames = buildQuietProgressUnsetLine()
      .replace(/^unset /, '')
      .split(' ')
      .sort()
    expect(exportNames).toEqual(unsetNames)
  })

  it('自定义变量组时按传入内容生成（便于将来扩展）', () => {
    const env = [
      ['A', '1'],
      ['B', 'x'],
    ] as ReadonlyArray<readonly [string, string]>
    expect(buildQuietProgressExportLine(env)).toBe('export A=1 B=x')
    expect(buildQuietProgressUnsetLine(env)).toBe('unset A B')
  })
})

/**
 * 默认值 = **跟随画布**。
 *
 * 回归背景：安静变量组最初默认开启（那时画布还不存在，只有"压成纯文本"这一条路）。
 * 画布上线后几何层已经解决"块高 > 屏高"，默认再注入 plain 就是净损失：
 * 看不到 compose / BuildKit 的动画进度、连接时多三行 `export` 回显。
 */
describe('quiet-env 默认值（跟随画布）', () => {
  it('画布开着（默认）→ 不注入', () => {
    expect(defaultQuietProgress(true)).toBe(false)
  })

  it('画布关掉（贴屏，没有行数兜底）→ 注入', () => {
    expect(defaultQuietProgress(false)).toBe(true)
  })

  it('用户没选过（stored = null）→ 用画布推出来的默认值，且标记为"非显式"', () => {
    expect(resolveQuietProgress(null, true)).toEqual({ value: false, manual: false })
    expect(resolveQuietProgress(null, false)).toEqual({ value: true, manual: false })
  })

  it('用户显式开过 → 画布开着也照旧注入（听用户的）', () => {
    expect(resolveQuietProgress('1', true)).toEqual({ value: true, manual: true })
  })

  it('用户显式关过 → 画布关着也照旧不注入（听用户的）', () => {
    expect(resolveQuietProgress('0', false)).toEqual({ value: false, manual: true })
  })

  it('存储键名保持稳定（改键等于把所有人的选择丢掉）', () => {
    expect(QUIET_PROGRESS_STORAGE_KEY).toBe('wrench_ssh_quiet_progress')
    // 老键（语义已从"只 compose"扩到 docker 全家族）读到就当作显式选择
    expect(QUIET_PROGRESS_LEGACY_STORAGE_KEY).toBe('wrench_ssh_compose_plain')
  })
})
