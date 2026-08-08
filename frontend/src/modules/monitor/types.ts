/**
 * Monitor module type definitions
 */

export interface HealthData {
  status: string
  uptime: number
  connections: { active: number }
}

export interface HostStats {
  host: string
  name: string
  cpu: number
  memory: { total: number; used: number; pct: number }
  disk: { total: number; used: number; pct: number }
  uptime: string
  loadAvg: string
  netRx: number
  netTx: number
  /** Top 5 CPU 消耗进程 */
  topProcs: Array<{ pid: number; user: string; cpu: number; mem: number; command: string }>
  /** 磁盘 IO 统计 */
  io: { readBps: number; writeBps: number }
  timestamp: number
}

export interface HistoryPoint {
  time: number
  cpu: number
  mem: number
  disk: number
}
