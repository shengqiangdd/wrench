/** 常用命令分组 */
export interface CommandGroup {
  id: string
  name: string
  icon?: string
}

/** 一条常用命令 */
export interface QuickCommand {
  id: string
  groupId: string
  name: string
  command: string
  description?: string
  isBuiltin: boolean
  /** 模板变量列表，存在则表示命令中含变量占位符 */
  variables?: CommandVariable[]
}

/** 模板变量定义 */
export interface CommandVariable {
  name: string
  label: string
  defaultValue?: string
  placeholder?: string
}

/** 持久化存储结构 */
/** 内置分组 ID 列表，不可删除不可重命名 */
export const BUILTIN_GROUP_IDS = [
  'system',
  'docker',
  'network',
  'disk',
  'log',
  'service',
  'security',
]

/** 检查分组是否为内置 */
export function isBuiltinGroup(id: string): boolean {
  return BUILTIN_GROUP_IDS.includes(id)
}

/** 内置分组完整定义（仅用于引用，不出现在编辑列表中） */
export const BUILTIN_GROUPS: CommandGroup[] = [
  { id: 'system', name: '🖥️ 系统管理', icon: '🖥️' },
  { id: 'docker', name: '🐳 Docker', icon: '🐳' },
  { id: 'network', name: '🌐 网络', icon: '🌐' },
  { id: 'disk', name: '💾 磁盘', icon: '💾' },
  { id: 'log', name: '📋 日志', icon: '📋' },
  { id: 'service', name: '⚙️ 服务管理', icon: '⚙️' },
  { id: 'security', name: '🔒 安全', icon: '🔒' },
]

export const COMMAND_GROUPS: CommandGroup[] = [
  { id: 'system', name: '系统管理', icon: '🖥️' },
  { id: 'docker', name: 'Docker', icon: '🐳' },
  { id: 'network', name: '网络', icon: '🌐' },
  { id: 'disk', name: '磁盘', icon: '💾' },
  { id: 'log', name: '日志', icon: '📋' },
  { id: 'service', name: '服务管理', icon: '⚙️' },
  { id: 'security', name: '安全', icon: '🔒' },
  { id: 'custom', name: '自定义', icon: '⭐' },
]

/** 内置预设命令 */
export const BUILTIN_COMMANDS: QuickCommand[] = [
  // ═══ 系统管理 ═══
  {
    id: 'builtin-sys-uptime',
    groupId: 'system',
    name: '查看运行时间',
    command: 'uptime',
    description: '系统运行时间、负载',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-df',
    groupId: 'system',
    name: '磁盘使用情况',
    command: 'df -h',
    description: '所有挂载点磁盘容量',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-free',
    groupId: 'system',
    name: '内存使用情况',
    command: 'free -h',
    description: '物理内存和交换分区',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-top',
    groupId: 'system',
    name: '进程实时监控',
    command: 'top -b -n 1 | head -30',
    description: 'CPU/内存占用 Top 进程',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-ps',
    groupId: 'system',
    name: '进程列表',
    command: 'ps aux --sort=-%mem | head -20',
    description: '按内存排序的进程列表',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-kernel',
    groupId: 'system',
    name: '内核版本',
    command: 'uname -a',
    description: '系统内核与架构信息',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-dmesg',
    groupId: 'system',
    name: '内核日志（最近）',
    command: 'dmesg | tail -30',
    description: '最近 30 条内核消息',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-sysctl',
    groupId: 'system',
    name: '系统参数',
    command: 'sysctl -a 2>/dev/null | grep -E "vm.swappiness|net.core.somaxconn|fs.file-max"',
    description: '关键内核参数',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-crontab',
    groupId: 'system',
    name: '定时任务列表',
    command: 'crontab -l 2>/dev/null || echo "无定时任务"',
    description: '当前用户的 cron 任务',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-env',
    groupId: 'system',
    name: '环境变量',
    command: 'env | sort',
    description: '所有环境变量（排序后）',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-lscpu',
    groupId: 'system',
    name: 'CPU 信息',
    command: 'lscpu',
    description: 'CPU 架构、核心数、频率',
    isBuiltin: true,
  },
  {
    id: 'builtin-sys-lspci',
    groupId: 'system',
    name: 'PCI 设备',
    command: 'lspci 2>/dev/null | head -20 || echo "lspci 不可用"',
    description: '硬件设备列表',
    isBuiltin: true,
  },

  // ═══ Docker ═══
  {
    id: 'builtin-dk-ps',
    groupId: 'docker',
    name: '运行中的容器',
    command: 'docker ps',
    description: '当前运行的 Docker 容器',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-psa',
    groupId: 'docker',
    name: '全部容器',
    command: 'docker ps -a',
    description: '所有容器（含已停止）',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-images',
    groupId: 'docker',
    name: '镜像列表',
    command: 'docker images',
    description: '本地所有 Docker 镜像',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-stats',
    groupId: 'docker',
    name: '容器资源统计',
    command: 'docker stats --no-stream',
    description: '各容器 CPU/内存/网络',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-compose-ps',
    groupId: 'docker',
    name: 'Compose 状态',
    command: 'docker compose ps',
    description: 'Compose 项目运行状态',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-prune',
    groupId: 'docker',
    name: '清理未使用资源',
    command: 'docker system prune -f',
    description: '清理停止容器、悬空镜像等',
    isBuiltin: true,
  },
  {
    id: 'builtin-dk-logs',
    groupId: 'docker',
    name: '容器日志',
    command: 'docker logs --tail 50 {{container}}',
    description: '查看指定容器最新日志',
    isBuiltin: true,
    variables: [{ name: 'container', label: '容器名称/ID', placeholder: '例如: nginx' }],
  },
  {
    id: 'builtin-dk-exec',
    groupId: 'docker',
    name: '容器内执行命令',
    command: 'docker exec -it {{container}} {{command}}',
    description: '在容器内执行一条命令',
    isBuiltin: true,
    variables: [
      { name: 'container', label: '容器名称', placeholder: 'myapp' },
      { name: 'command', label: '命令', defaultValue: 'sh', placeholder: 'bash' },
    ],
  },
  {
    id: 'builtin-dk-inspect',
    groupId: 'docker',
    name: '容器详情',
    command: 'docker inspect {{container}} | head -60',
    description: '查看容器完整配置',
    isBuiltin: true,
    variables: [{ name: 'container', label: '容器名称/ID', placeholder: 'nginx' }],
  },

  // ═══ 网络 ═══
  {
    id: 'builtin-net-ss',
    groupId: 'network',
    name: '网络连接',
    command: 'ss -tlnp',
    description: 'TCP 监听端口及进程',
    isBuiltin: true,
  },
  {
    id: 'builtin-net-ifconfig',
    groupId: 'network',
    name: '网络接口',
    command: 'ip addr',
    description: '所有网络接口信息',
    isBuiltin: true,
  },
  {
    id: 'builtin-net-curl',
    groupId: 'network',
    name: 'HTTP 状态检查',
    command: 'curl -sI -o /dev/null -w "%{http_code} %{time_total}s" http://localhost/ 2>&1; echo',
    description: '本机 Web 服务健康检查',
    isBuiltin: true,
  },
  {
    id: 'builtin-net-dns',
    groupId: 'network',
    name: 'DNS 解析',
    command: 'nslookup {{domain}} 2>&1',
    description: 'DNS 解析验证',
    isBuiltin: true,
    variables: [
      { name: 'domain', label: '域名', defaultValue: 'google.com', placeholder: 'example.com' },
    ],
  },
  {
    id: 'builtin-net-ping',
    groupId: 'network',
    name: 'Ping 测试',
    command: 'ping -c 5 {{host}}',
    description: '网络延迟和丢包检测',
    isBuiltin: true,
    variables: [
      { name: 'host', label: '目标主机', defaultValue: '8.8.8.8', placeholder: 'IP 或域名' },
    ],
  },
  {
    id: 'builtin-net-traceroute',
    groupId: 'network',
    name: '路由追踪',
    command: 'traceroute {{host}} 2>&1 || echo "需安装 traceroute"',
    description: '网络路径追踪',
    isBuiltin: true,
    variables: [{ name: 'host', label: '目标', defaultValue: '8.8.8.8' }],
  },
  {
    id: 'builtin-net-iptables',
    groupId: 'network',
    name: '防火墙规则',
    command: 'iptables -L -n -v --line-numbers 2>/dev/null || echo "需 root 权限"',
    description: '当前 iptables 规则',
    isBuiltin: true,
  },
  {
    id: 'builtin-net-port-check',
    groupId: 'network',
    name: '端口连通性',
    command:
      'nc -zv {{host}} {{port}} 2>&1 || echo "nc 不可用，尝试 curl"; curl -s -m 3 telnet://{{host}}:{{port}} 2>&1 || echo "端口 {{port}} 不可达"',
    description: '检测远程端口是否开放',
    isBuiltin: true,
    variables: [
      { name: 'host', label: '目标主机', placeholder: '192.168.1.1' },
      { name: 'port', label: '端口号', defaultValue: '80', placeholder: '443' },
    ],
  },

  // ═══ 磁盘 ═══
  {
    id: 'builtin-disk-iostat',
    groupId: 'disk',
    name: '磁盘 I/O',
    command: 'iostat -x 1 2 2>/dev/null || echo "需安装 sysstat"',
    description: '磁盘 I/O 性能统计',
    isBuiltin: true,
  },
  {
    id: 'builtin-disk-lsblk',
    groupId: 'disk',
    name: '块设备列表',
    command: 'lsblk',
    description: '所有磁盘和分区信息',
    isBuiltin: true,
  },
  {
    id: 'builtin-disk-du',
    groupId: 'disk',
    name: '目录大小排行',
    command: 'du -sh /* 2>/dev/null | sort -rh | head -10',
    description: '根目录下各目录占用',
    isBuiltin: true,
  },
  {
    id: 'builtin-disk-find-big',
    groupId: 'disk',
    name: '查找大文件',
    command:
      'find {{path}} -type f -size +{{size}} -exec ls -lh {} \\; 2>/dev/null | sort -k5 -rh | head -20',
    description: '在指定目录查找超过指定大小的文件',
    isBuiltin: true,
    variables: [
      { name: 'path', label: '搜索目录', defaultValue: '/', placeholder: '/var/log' },
      { name: 'size', label: '最小大小', defaultValue: '100M', placeholder: '50M' },
    ],
  },
  {
    id: 'builtin-disk-inode',
    groupId: 'disk',
    name: 'inode 使用率',
    command: 'df -i',
    description: '各分区 inode 使用情况',
    isBuiltin: true,
  },

  // ═══ 日志 ═══
  {
    id: 'builtin-log-journal',
    groupId: 'log',
    name: '系统日志（最近）',
    command: 'journalctl -n 50 --no-pager 2>&1',
    description: '最近 50 条系统日志',
    isBuiltin: true,
  },
  {
    id: 'builtin-log-auth',
    groupId: 'log',
    name: '认证日志（最近）',
    command:
      'tail -30 /var/log/auth.log 2>/dev/null || tail -30 /var/log/secure 2>/dev/null || echo "未找到认证日志"',
    description: '最近的 SSH 登录/认证记录',
    isBuiltin: true,
  },
  {
    id: 'builtin-log-nginx',
    groupId: 'log',
    name: 'Nginx 访问（最近）',
    command: 'tail -20 /var/log/nginx/access.log 2>/dev/null || echo "未找到 Nginx 访问日志"',
    description: '最近 Nginx 访问请求',
    isBuiltin: true,
  },
  {
    id: 'builtin-log-fail',
    groupId: 'log',
    name: '登录失败记录',
    command: 'lastb 2>/dev/null | head -15 || echo "无失败登录记录"',
    description: '失败 SSH 登录尝试',
    isBuiltin: true,
  },
  {
    id: 'builtin-log-tailf',
    groupId: 'log',
    name: '实时跟踪日志',
    command: 'tail -f {{logfile}}',
    description: '跟踪指定日志文件的新增内容',
    isBuiltin: true,
    variables: [
      {
        name: 'logfile',
        label: '日志路径',
        defaultValue: '/var/log/syslog',
        placeholder: '/var/log/nginx/access.log',
      },
    ],
  },
  {
    id: 'builtin-log-grep',
    groupId: 'log',
    name: '搜索日志内容',
    command: 'grep -i "{{pattern}}" {{logfile}} 2>/dev/null | tail -30',
    description: '在日志文件中搜索关键词',
    isBuiltin: true,
    variables: [
      { name: 'pattern', label: '搜索关键词', placeholder: 'error' },
      {
        name: 'logfile',
        label: '日志文件',
        defaultValue: '/var/log/syslog',
        placeholder: '/var/log/nginx/error.log',
      },
    ],
  },

  // ═══ 服务管理 ═══
  {
    id: 'builtin-svc-list',
    groupId: 'service',
    name: '服务列表',
    command:
      'systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -30 || service --status-all 2>/dev/null || echo "systemctl 不可用"',
    description: '正在运行的系统服务',
    isBuiltin: true,
  },
  {
    id: 'builtin-svc-status',
    groupId: 'service',
    name: '服务状态',
    command: 'systemctl status {{service}} --no-pager -l 2>&1 | head -30',
    description: '查看服务状态和最近日志',
    isBuiltin: true,
    variables: [{ name: 'service', label: '服务名称', placeholder: 'nginx' }],
  },
  {
    id: 'builtin-svc-restart',
    groupId: 'service',
    name: '重启服务',
    command: 'sudo systemctl restart {{service}} && echo "已重启 {{service}}" || echo "重启失败"',
    description: '重启指定系统服务',
    isBuiltin: true,
    variables: [{ name: 'service', label: '服务名称', placeholder: 'nginx' }],
  },
  {
    id: 'builtin-svc-journal',
    groupId: 'service',
    name: '服务日志',
    command: 'journalctl -u {{service}} -n 50 --no-pager 2>&1',
    description: '查看指定服务的 systemd 日志',
    isBuiltin: true,
    variables: [{ name: 'service', label: '服务名称', placeholder: 'nginx' }],
  },

  // ═══ 安全 ═══
  {
    id: 'builtin-sec-last-logins',
    groupId: 'security',
    name: '最近登录',
    command: 'last -20 2>/dev/null || echo "last 命令不可用"',
    description: '最近登录用户的记录',
    isBuiltin: true,
  },
  {
    id: 'builtin-sec-failed-logins',
    groupId: 'security',
    name: '失败登录统计',
    command:
      'lastb 2>/dev/null | wc -l; echo "次失败尝试（总记录）"; echo "---最近---"; lastb 2>/dev/null | head -10',
    description: 'SSH 暴力破解检查',
    isBuiltin: true,
  },
  {
    id: 'builtin-sec-open-ports',
    groupId: 'security',
    name: '开放端口和服务',
    command: "ss -tlnp 2>/dev/null | tail -n +2 | awk '{print $4, $6}' | sort",
    description: '检查监听端口及其关联进程',
    isBuiltin: true,
  },
  {
    id: 'builtin-sec-suspicious',
    groupId: 'security',
    name: '可疑进程检查',
    command:
      'ps aux | grep -iE "(mine|crypt|miner|xmr|stratum)" | grep -v grep || echo "未发现可疑进程"',
    description: '扫描常见挖矿/恶意进程',
    isBuiltin: true,
  },
  {
    id: 'builtin-sec-file-perm',
    groupId: 'security',
    name: '检查敏感文件权限',
    command: 'ls -la /etc/shadow /etc/passwd /root/.ssh 2>/dev/null',
    description: '检查关键系统文件权限',
    isBuiltin: true,
  },
]

export const STORAGE_KEY = 'smartbox-quick-commands'

/** 默认的自定义命令展示 */
export const DEFAULT_CUSTOM: QuickCommand[] = []

/**
 * 替换命令中的变量占位符
 * 例如: "docker logs --tail 50 {{container}}" + { container: "nginx" }
 *     → "docker logs --tail 50 nginx"
 */
export function resolveCommandTemplate(command: string, variables: Record<string, string>): string {
  let result = command
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }
  return result
}

/**
 * 从命令中提取变量名列表
 */
export function extractVariables(command: string): string[] {
  const matches = command.match(/\{\{(\w+)\}\}/g)
  if (!matches) return []
  return [...new Set(matches.map((m) => m.slice(2, -2)))]
}
