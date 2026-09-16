import { describe, it, expect } from 'vitest'
import { formatPerms, parsePermsOctal, permsToOctalInput } from '../../modules/ssh/sftp-utils'

/**
 * 回归：后端 `SftpEntry.permissions` 是**八进制字符串**（`format!("{:o}", p & 0o7777)`），
 * 之前三处显示 + chmod 预填都拿 `parseInt(x, 16)` 去解析它 —— 显示乱码，
 * 且 chmod 输入框会被预填成危险值（`600` → `3000`）。
 */
describe('parsePermsOctal', () => {
  it('按八进制解析后端的 permissions 字符串', () => {
    expect(parsePermsOctal('755')).toBe(0o755)
    expect(parsePermsOctal('644')).toBe(0o644)
    expect(parsePermsOctal('1777')).toBe(0o1777)
    expect(parsePermsOctal('000')).toBe(0)
  })

  it('哨兵值与非法输入一律按 0（不抛异常、不产生 NaN 显示）', () => {
    expect(parsePermsOctal('----')).toBe(0)
    expect(parsePermsOctal('')).toBe(0)
    expect(parsePermsOctal(undefined)).toBe(0)
    expect(parsePermsOctal(null)).toBe(0)
    // 含 8/9 或超长：不是八进制，拒绝
    expect(parsePermsOctal('8')).toBe(0)
    expect(parsePermsOctal('75512345')).toBe(0)
  })

  it('按 16 进制解析是错的（把当年的 bug 钉住）', () => {
    // 旧实现：parseInt('755', 16) = 1877 → 低 9 位 0o525 → r-x-w-r-x
    expect(formatPerms(parseInt('755', 16))).toBe('r-x-w-r-x')
    expect(formatPerms(parsePermsOctal('755'))).toBe('rwxr-xr-x')
  })
})

describe('formatPerms', () => {
  it('常见权限位渲染成 9 字符', () => {
    expect(formatPerms(0o755)).toBe('rwxr-xr-x')
    expect(formatPerms(0o644)).toBe('rw-r--r--')
    expect(formatPerms(0o600)).toBe('rw-------')
    expect(formatPerms(0o777)).toBe('rwxrwxrwx')
    expect(formatPerms(0)).toBe('---------')
  })

  it('小于 0o100 的权限也补齐 9 字符', () => {
    expect(formatPerms(0o060)).toBe('---rw----')
  })
})

describe('permsToOctalInput（chmod 输入框预填）', () => {
  it('原样回填真实权限，而不是十六进制误解出来的值', () => {
    expect(permsToOctalInput('600')).toBe('0600')
    expect(permsToOctalInput('644')).toBe('0644')
    expect(permsToOctalInput('755')).toBe('0755')
    expect(permsToOctalInput('1777')).toBe('1777')
    expect(permsToOctalInput('----')).toBe('0000')
  })

  it('P0 回归：600 的私钥绝不能被预填成 3000（setgid+sticky 且抹掉所有者读写）', () => {
    expect(permsToOctalInput('600')).not.toBe('3000')
    expect(permsToOctalInput('644')).not.toBe('3104')
    expect(permsToOctalInput('755')).not.toBe('3525')
  })
})
