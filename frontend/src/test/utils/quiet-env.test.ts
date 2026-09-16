import { describe, expect, it } from 'vitest'
import {
  QUIET_PROGRESS_ENV,
  buildQuietProgressExportLine,
  buildQuietProgressUnsetLine,
  quietProgressVarNames,
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
