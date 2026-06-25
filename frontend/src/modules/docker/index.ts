/** Docker 容器信息（docker ps --format json） */
export interface DockerContainer {
  ID: string
  Image: string
  Command: string
  CreatedAt: string
  RunningFor: string
  Ports: string
  State: string
  Status: string
  Names: string
  Labels: string
  Mounts: string
  Networks: string
  Size: string
}

/** Docker 镜像信息（docker images --format json） */
export interface DockerImage {
  ID: string
  Repository: string
  Tag: string
  Digest: string
  CreatedAt: string
  CreatedSince: string
  Size: string
}

/** Docker 统计信息（docker stats --format json） */
export interface DockerStats {
  BlockIO: string
  CPUPerc: string
  Container: string
  ID: string
  MemPerc: string
  MemUsage: string
  Name: string
  NetIO: string
  PIDs: string
}

/** Docker inspect 输出片段 */
export interface DockerInspectInfo {
  /** 容器名称（不含前导 /） */
  Name: string
  State: {
    Status: string
    Running: boolean
    Paused: boolean
    Restarting: boolean
    OOMKilled: boolean
    Dead: boolean
    Pid: number
    ExitCode: number
    Error: string
    StartedAt: string
    FinishedAt: string
  }
  Config: {
    Hostname: string
    Env: string[]
    Cmd: string[]
    Image: string
    WorkingDir: string
    Entrypoint: string[]
  }
  NetworkSettings: {
    IPAddress: string
    Ports: Record<string, { HostIp: string; HostPort: string }[]>
  }
  HostConfig: {
    Binds: string[]
    NetworkMode: string
    PortBindings: Record<string, { HostIp: string; HostPort: string }[]>
    RestartPolicy: { Name: string; MaximumRetryCount: number }
  }
  Mounts: {
    Type: string
    Source: string
    Destination: string
    Mode: string
    RW: boolean
  }[]
}

/** /api/docker/* 通用响应 */
export interface DockerResponse<T = unknown> {
  success: boolean
  data?: string
  error?: string
  exitCode?: number
}

export type ContainerStatus = 'running' | 'exited' | 'paused' | 'restarting' | 'dead'

export const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400',
  exited: 'text-slate-500',
  paused: 'text-amber-400',
  restarting: 'text-blue-400',
  dead: 'text-red-400',
  created: 'text-slate-400',
}

export const STATUS_DOTS: Record<string, string> = {
  running: 'bg-emerald-500',
  exited: 'bg-slate-500',
  paused: 'bg-amber-500',
  restarting: 'bg-blue-500',
  dead: 'bg-red-500',
  created: 'bg-slate-400',
}
