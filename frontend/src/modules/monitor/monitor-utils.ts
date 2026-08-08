/**
 * Monitor module utility functions — SSH output parsers
 */

/** 解析 CPU 使用率（来自 top/sar/mpstat 输出） */
export function parseCpuUsage(stdout: string): number {
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 12 && parts[0] !== 'avg-cpu:') {
      if (parts.length >= 12) {
        const idle = parseFloat(parts[10] || parts[7] || '0')
        if (!isNaN(idle) && idle >= 0 && idle <= 100) {
          return Math.round((100 - idle) * 10) / 10
        }
      }
    }
    // sar -u 1 1 格式
    if (line.includes('all')) {
      const p = line.trim().split(/\s+/)
      if (p.length >= 8) {
        const idle = parseFloat(p[p.length - 1]!)
        if (!isNaN(idle) && idle >= 0 && idle <= 100) {
          return Math.round((100 - idle) * 10) / 10
        }
      }
    }
  }
  return 0
}

/** 解析内存使用情况（来自 /proc/meminfo） */
export function parseMemory(stdout: string): {
  total: number
  used: number
  pct: number
} {
  const lines = stdout.trim().split('\n')
  let total = 0,
    available = 0
  for (const line of lines) {
    if (line.startsWith('MemTotal:')) {
      total = parseInt(line.split(/\s+/)[1]!) || 0
    }
    if (line.startsWith('MemAvailable:')) {
      available = parseInt(line.split(/\s+/)[1]!) || 0
    }
  }
  if (total === 0) return { total: 0, used: 0, pct: 0 }
  const used = total - available
  return { total, used, pct: Math.round((used / total) * 100) }
}

/** 解析磁盘使用情况（来自 df 命令） */
export function parseDisk(stdout: string): {
  total: number
  used: number
  pct: number
} {
  const lines = stdout.trim().split('\n')
  // 找根分区 /
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 6 && parts[5] === '/') {
      const total = parseInt(parts[1]!) || 0
      const used = parseInt(parts[2]!) || 0
      if (total === 0) continue
      return { total, used, pct: Math.round((used / total) * 100) }
    }
  }
  return { total: 0, used: 0, pct: 0 }
}

/** 解析系统 uptime（人性化格式） */
export function parseUptime(stdout: string): string {
  // " 11:47:35 up 42 days,  3:22,  1 user,  load average: ..."
  const m = stdout.match(/up\s+(.+?)(?:,\s*\d+\s*user|\s*,\s*load|\s*$)/)
  if (!m) return stdout.trim().slice(0, 40)
  const raw = m[1]!.trim()

  const days = raw.match(/(\d+)\s*day/)
  const hours = raw.match(/(\d+)\s*hour/)
  const mins = raw.match(/(\d+)\s*min/)
  const timeMatch = raw.match(/(\d+):(\d+)/)

  const parts: string[] = []
  if (days) parts.push(`${days[1]}天`)
  if (hours) parts.push(`${hours[1]}时`)
  if (mins) parts.push(`${mins[1]}分`)
  if (parts.length > 0) return parts.join(' ')

  if (days && timeMatch) return `${days[1]}天 ${timeMatch[1]}时${timeMatch[2]}分`
  if (timeMatch && !days) return `${timeMatch[1]}时${timeMatch[2]}分`

  return raw
}

/** 解析系统负载平均值 */
export function parseLoadAvg(stdout: string): string {
  const m = stdout.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`
  return '—'
}

/**
 * 解析 /proc/net/dev 获取累计字节数（非速率）
 * 返回累计 rx/tx 字节，速率由调用方计算
 */
export function parseNetRxTx(stdout: string): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    // 跳过表头行
    if (line.includes('Inter') || line.includes('face') || line.trim().startsWith('Iface')) continue
    // 匹配 "  eth0: 12345 ..."
    const m = line.match(/^\s*(\S+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/)
    if (!m) continue
    const iface = m[1]!
    // 跳过 lo、veth、docker、br-、virbr 等虚拟网卡
    if (/^(lo|veth|docker|br-|virbr|cni|flannel|calico|weave)/.test(iface)) continue
    rx += parseInt(m[2]!) || 0
    tx += parseInt(m[4]!) || 0
  }
  return { rx, tx }
}

/**
 * 解析 /proc/diskstats 获取累计扇区数
 * 返回累计 read/write 扇区数，速率由调用方计算
 */
export function parseDiskIo(stdout: string): { readSectors: number; writeSectors: number } {
  let readSectors = 0
  let writeSectors = 0
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    // /proc/diskstats 格式: major minor name reads ... read_sectors ... writes ... write_sectors ...
    if (parts.length < 14) continue
    const name = parts[2]!
    // 跳过分区（只统计整盘 sda/vda/nvme0n1，不统计 sda1）
    if (/^(loop|ram|dm-)/.test(name)) continue
    if (/^(sd|vd|xvd|nvme\d+n\d+)$/.test(name) === false) continue
    const rs = parseInt(parts[5]!) || 0
    const ws = parseInt(parts[9]!) || 0
    readSectors += rs
    writeSectors += ws
  }
  return { readSectors, writeSectors }
}

/** 解析 top 进程列表（来自 ps aux --sort=-%cpu 输出） */
export function parseTopProcs(
  stdout: string,
): Array<{ pid: number; user: string; cpu: number; mem: number; command: string }> {
  const procs: Array<{ pid: number; user: string; cpu: number; mem: number; command: string }> = []
  const lines = stdout.trim().split('\n')
  for (const line of lines) {
    // 跳过标题行
    if (line.startsWith('USER') || line.startsWith('PID') || line.trim() === '') continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 11) continue
    procs.push({
      user: parts[0]!,
      pid: parseInt(parts[1]!) || 0,
      cpu: parseFloat(parts[2]!) || 0,
      mem: parseFloat(parts[3]!) || 0,
      command: parts.slice(10).join(' ').slice(0, 80),
    })
    if (procs.length >= 5) break
  }
  return procs
}

/** 格式化字节数为可读字符串 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
