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

/** 解析系统 uptime */
export function parseUptime(stdout: string): string {
  const m = stdout.match(/up\s+(.+?)(?:,\s+\d+ users|\s*$)/)
  return m ? m[1]!.trim() : stdout.trim().slice(0, 40)
}

/** 解析系统负载平均值 */
export function parseLoadAvg(stdout: string): string {
  const m = stdout.match(/load average:\s+(.+)/)
  return m ? m[1]!.trim() : ''
}

/** 解析网络流量（来自 sar -n DEV 1 1） */
export function parseNetRxTx(stdout: string): { rx: number; tx: number } {
  const lines = stdout.trim().split('\n')
  let rxTotal = 0,
    txTotal = 0
  let ifaceCount = 0
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 10 && parts[0] !== 'Inter-|' && parts[0] !== 'face') {
      const name = parts[0]!
      if (
        name === 'lo' ||
        name.startsWith('eth0') ||
        name.startsWith('docker') ||
        name.startsWith('br-') ||
        name.startsWith('veth') ||
        name.startsWith('virbr') ||
        name.startsWith('cni')
      )
        continue
      rxTotal += parseInt(parts[1]!) || 0
      txTotal += parseInt(parts[9]!) || 0
      ifaceCount++
    }
  }
  return ifaceCount > 0 ? { rx: rxTotal, tx: txTotal } : { rx: 0, tx: 0 }
}

/** 解析 ps aux 输出的 Top 5 CPU 进程 */
export function parseTopProcs(
  stdout: string,
): Array<{ pid: number; user: string; cpu: number; mem: number; command: string }> {
  const lines = stdout.trim().split('\n')
  const procs: Array<{ pid: number; user: string; cpu: number; mem: number; command: string }> = []
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 11 && parts[0] !== 'USER') {
      procs.push({
        user: parts[0]!,
        pid: parseInt(parts[1]!) || 0,
        cpu: parseFloat(parts[2]!) || 0,
        mem: parseFloat(parts[3]!) || 0,
        command: parts.slice(10).join(' ').slice(0, 50),
      })
    }
  }
  return procs.slice(0, 5)
}

/** 解析 /proc/diskstats 获取磁盘 IO（累计扇区数，512 字节/扇区） */
export function parseDiskIo(stdout: string): { readBps: number; writeBps: number } {
  const lines = stdout.trim().split('\n')
  let readSectors = 0
  let writeSectors = 0
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 14) {
      const devName = parts[2]!
      // 只统计主磁盘（sdX / vdX / nvmeXnY），跳过分区
      if (/^(sd|vd|nvme\d+n\d+|xvd)[a-z]?$/.test(devName) || /^nvme\d+n\d+$/.test(devName)) {
        readSectors += parseInt(parts[5]!) || 0
        writeSectors += parseInt(parts[9]!) || 0
      }
    }
  }
  return { readBps: readSectors * 512, writeBps: writeSectors * 512 }
}

/** 格式化字节数为人类可读格式 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 格式化网络速率（bytes/s → KB/s） */
export function formatNetSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

/** 获取状态颜色 class */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'healthy':
      return 'text-green-400'
    case 'degraded':
      return 'text-yellow-400'
    case 'unhealthy':
      return 'text-red-400'
    default:
      return 'text-slate-400'
  }
}

/** 获取进度条颜色 class */
export function getProgressColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500'
  if (pct >= 70) return 'bg-yellow-500'
  return 'bg-green-500'
}
