/** 日志源定义 */
export interface LogSource {
  /** 文件大小，如 "4.2M"（可选） */
  size?: string
  /** 完整路径 */
  path: string
  /** 友好名称（自动从路径推断） */
  label: string
}

/** 日志配置（持久化到 localStorage） */
export interface LogConfig {
  /** 连接ID -> 该连接的自定义日志路径列表 */
  [connectionId: string]: CustomSource[]
}

export interface CustomSource {
  label: string
  path: string
}

/** SSH 连接简要信息 */
export interface SshConnInfo {
  id: string
  label: string
}

/** 预定义日志源列表 */
export const PRESET_LOG_PATTERNS = [
  { label: '系统日志', path: '/var/log/syslog' },
  { label: '系统消息', path: '/var/log/messages' },
  { label: '认证日志', path: '/var/log/auth.log' },
  { label: '安全日志', path: '/var/log/secure' },
  { label: '内核日志', path: '/var/log/kern.log' },
  { label: '启动日志', path: '/var/log/boot.log' },
  { label: '定时任务', path: '/var/log/cron' },
  { label: 'Nginx 访问', path: '/var/log/nginx/access.log' },
  { label: 'Nginx 错误', path: '/var/log/nginx/error.log' },
  { label: 'Apache 访问', path: '/var/log/apache2/access.log' },
  { label: 'Apache 错误', path: '/var/log/apache2/error.log' },
  { label: 'MySQL 错误', path: '/var/log/mysql/error.log' },
  { label: 'MariaDB 日志', path: '/var/log/mariadb/mariadb.log' },
  { label: 'Redis 日志', path: '/var/log/redis/redis-server.log' },
  { label: 'MySQL 通用日志', path: '/var/log/mysql/mysql.log' },
  { label: 'PostgreSQL 日志', path: '/var/log/postgresql/postgresql.log' },
  { label: 'Docker daemon', path: '/var/log/docker.log' },
  { label: 'DPKG 日志', path: '/var/log/dpkg.log' },
  { label: 'YUM 日志', path: '/var/log/yum.log' },
  { label: 'APT 历史', path: '/var/log/apt/history.log' },
]

/** 本地存储 key */
export const STORAGE_KEY = 'wrench-log-config'
