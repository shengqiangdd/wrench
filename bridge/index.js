/**
 * SmartBox SSH Bridge (Express + express-ws)
 *
 * 轻量级 WebSocket → SSH 代理服务
 * 浏览器无法直接连接 SSH 协议，此服务作为桥梁，
 * 将 WebSocket 消息转发到 SSH/SFTP 连接。
 *
 * 消息协议（JSON）：
 * - { type: 'connect', connectionId, host, port, username, password?, privateKey? }
 * - { type: 'disconnect', connectionId }
 * - { type: 'exec', connectionId, data } // 终端数据（shell 模式）
 * - { type: 'resize', connectionId, cols, rows } // 终端大小调整
 * - { type: 'sftp', connectionId, operation, ... } // SFTP 操作
 */

import http from 'node:http'
import express from 'express'
import expressWs from 'express-ws'
import cors from 'cors'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'ssh2'
import {
 apiLimiter,
 authLimiter,
 wsConnectLimiter,
 generateWsToken,
 validateWsToken,
 detectInjection,
 sanitizeString,
 isValidHost,
 isValidPort,
 isValidUsername,
 validateConnectionParams,
 isValidPath,
 isValidFilename,
 sanitizeError,
 securityHeaders,
 requestLogger,
 createCorsOptions,
 auditLog,
 auditLogs,
} from './security.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10)
const isProduction = process.env.NODE_ENV === 'production'

const pluginsDir = path.resolve(__dirname, '..', 'plugins')
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist')

// 连接管理器: connectionId → { ws, ssh, sftp, shellStream?, sessions? }
const connections = new Map()

// ─── Express 应用 ───

const app = express()
const httpServer = http.createServer(app)
expressWs(app, httpServer)

// 安全加固：隐藏服务器信息
app.disable('x-powered-by')

// 中间件
const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []
app.use(cors(createCorsOptions(allowedOrigins)))

// ─── 安全头 ───
app.use(securityHeaders)

// ─── 请求日志 ───
app.use(requestLogger)

// ─── API 限流 ───
app.use('/api/', apiLimiter)

app.use(express.json({ limit: '10mb' }))

// ========== 安全 API 路由 ==========

// 获取 WebSocket 连接 token（一次性）
app.post('/api/ws-token', authLimiter, (req, res) => {
 const ip = req.ip || req.socket?.remoteAddress
 const token = generateWsToken(ip)
 auditLog('ws_token_issued', { ip }, req)
 res.json({ token, expiresIn: 300 }) // 5 分钟有效
})

// 获取审计日志（管理员）
app.get('/api/audit-logs', (req, res) => {
 const limit = Math.min(parseInt(req.query.limit) || 100, 1000)
 const event = req.query.event
 let logs = [...auditLogs()].reverse()
 if (event) logs = logs.filter((l) => l.action === event)
 res.json({ total: logs.length, logs: logs.slice(0, limit) })
})

// 健康检查（增强版：内存/连接数/Node版本/主机统计）
app.get('/api/health', (req, res) => {
 const mem = process.memoryUsage()
 const connCount = connections.size
 res.json({
 status: 'ok',
 uptime: process.uptime(),
 version: process.version,
 memory: {
 rss: mem.rss,
 heapUsed: mem.heapUsed,
 heapTotal: mem.heapTotal,
 systemFree: os.freemem(),
 systemTotal: os.totalmem()
 },
 connections: {
 active: connCount,
 loadavg: os.loadavg()
 }
 })
})

// 告警持久化 API（内存存储，重启清空）
const alertsStore = []
const MAX_ALERTS = 500

app.get('/api/alerts', (req, res) => {
 const { level, host, limit = 50 } = req.query
 const safeLimit = Math.min(Number(limit) || 50, MAX_ALERTS)
 let result = [...alertsStore]
 if (level) result = result.filter(a => a.level === level)
 if (host) result = result.filter(a => a.host === host)
 res.json({ total: result.length, alerts: result.slice(0, safeLimit) })
})

app.post('/api/alerts', (req, res) => {
 const alert = req.body
 if (!alert || !alert.message) return res.status(400).json({ error: 'message required' })
 // 限制字段长度，防止恶意注入撑爆内存
 const clamp = (s, max) => typeof s === 'string' ? s.slice(0, max) : s
 const entry = {
 id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
 timestamp: new Date().toISOString(),
 level: alert.level === 'critical' ? 'critical' : 'warning',
 host: clamp(alert.host, 128) || 'unknown',
 metric: clamp(alert.metric, 32) || 'custom',
 message: clamp(alert.message, 500),
 value: typeof alert.value === 'number' ? alert.value : null,
 threshold: typeof alert.threshold === 'number' ? alert.threshold : null
 }
 alertsStore.unshift(entry)
 if (alertsStore.length > MAX_ALERTS) alertsStore.length = MAX_ALERTS
 res.json(entry)
})

// ── 获取 OpenRouter 免费模型列表 ──
app.get('/api/ai/fetch-free-models', async (_req, res) => {
 try {
 const resp = await fetch('https://openrouter.ai/api/v1/models')
 if (!resp.ok) return res.status(502).json({ error: 'OpenRouter API error: ' + resp.status })
 const { data } = await resp.json()
 if (!Array.isArray(data)) return res.status(502).json({ error: 'Unexpected response format' })
 const freeModels = data
 .filter((m) => {
 const p = m.pricing || {}
 return String(p.prompt) === '0' && String(p.completion) === '0'
 })
 .map((m) => ({
 value: m.id,
 label: m.name.replace(/\(free\)/i, '').trim() + ' (免费)',
 free: true,
 description: m.description
 ? m.description.slice(0, 120) + (m.description.length > 120 ? '…' : '')
 : undefined,
 }))
 .sort((a, b) => a.label.localeCompare(b.label))
 res.json({ total: freeModels.length, models: freeModels })
 } catch (err) {
 res.status(502).json({ error: err.message })
 }
})

// ── 获取 AI 配置（从环境变量读取 API Key） ──
app.get('/api/ai/config', (_req, res) => {
 const apiKey = process.env.OPENROUTER_API_KEY || ''
 res.json({ apiKey })
})

// ── 获取 SSH 测试环境变量（开发模式） ──
app.get('/api/ssh/test-config', (_req, res) => {
 const host = process.env.ssh_test_host || ''
 const user = process.env.ssh_test_user || ''
 const password = process.env.ssh_test_password || ''
 res.json({ host, user, password })
})

// 获取插件列表
app.get('/api/plugins', (req, res) => {
 try {
 const plugins = []
 if (fs.existsSync(pluginsDir)) {
 const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
 for (const entry of entries) {
 if (!entry.isDirectory()) continue
 const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json')
 const jsPath = path.join(pluginsDir, entry.name, 'plugin.js')
 // 必须同时有 manifest.json 和 plugin.js 才算有效插件
 if (!fs.existsSync(jsPath)) continue
 if (fs.existsSync(manifestPath)) {
 try {
 const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
 plugins.push({
 id: manifest.id || entry.name,
 name: manifest.name || entry.name,
 version: manifest.version || '1.0.0',
 description: manifest.description || '',
 author: manifest.author || '',
 icon: manifest.icon || '',
 commands: manifest.commands || [],
 panels: manifest.panels || [],
 entry: `/api/plugins/${entry.name}/plugin.js`,
 })
 } catch (e) {
 console.error(`[Bridge] Failed to read plugin manifest: ${entry.name}`, e.message)
 }
 }
 }
 }
 res.json({ plugins })
 } catch (err) {
 res.status(500).json({ error: err.message })
 }
})

// 获取单个插件的 JS 文件
app.get('/api/plugins/:id/plugin.js', (req, res) => {
 // ⚠️ 路径穿越防护：确保路径在 pluginsDir 内
 const id = req.params.id.replace(/\.\.\//g, '').replace(/\.\./g, '').replace(/[\\/]/g, '')
 if (!id) {
 return res.status(400).json({ error: 'Invalid plugin ID' })
 }
 const pluginDir = path.join(pluginsDir, id)
 const jsPath = path.join(pluginDir, 'plugin.js')
 // 确保最终路径在 pluginsDir 内
 if (!jsPath.startsWith(pluginsDir + path.sep)) {
 return res.status(400).json({ error: 'Invalid plugin ID' })
 }
 if (fs.existsSync(jsPath)) {
 const content = fs.readFileSync(jsPath, 'utf-8')
 res.setHeader('Content-Type', 'application/javascript')
 res.setHeader('Cache-Control', 'no-cache')
 res.send(content)
 } else {
 res.status(404).json({ error: 'Plugin JS not found' })
 }
})

// 执行 SSH 命令（通过 connectionId）
app.post('/api/ssh/exec', (req, res) => {
 // 限制：只允许通过连接 ID 访问自己的连接
 const { connectionId, command } = req.body
 if (!connectionId || !command) {
 return res.status(400).json({ error: 'Missing connectionId or command' })
 }

 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return res.status(400).json({ error: 'SSH not connected' })
 }

 // 支持 sudo 提权：若连接配置了 sudoPassword，自动包装命令
 const effectiveCmd = conn.sudoPassword
 ? `echo '${conn.sudoPassword.replace(/'/g, "'\\''")}' | sudo -S ${command}`
 : command

 conn.ssh.exec(effectiveCmd, { pty: !!conn.sudoPassword }, (err, stream) => {
 if (err) {
 return res.status(500).json({ error: err.message })
 }

 let stdout = ''
 let stderr = ''

 stream.on('data', (chunk) => {
 stdout += chunk.toString('utf-8')
 })

 stream.stderr.on('data', (chunk) => {
 stderr += chunk.toString('utf-8')
 })

 stream.on('close', (code) => {
 res.json({ stdout, stderr, exitCode: code })
 })

 // 超时兜底
 setTimeout(() => {
 stream.close()
 }, 30000)
 })
})

// ========== Docker API ==========

/** 辅助：通过 SSH connectionId 执行 docker 命令并返回 JSON */
function dockerExec(connectionId, dockerCmd, res) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return res.status(400).json({ error: 'SSH not connected' })
 }

 conn.ssh.exec(dockerCmd, { pty: false }, (err, stream) => {
 if (err) {
 return res.status(500).json({ error: err.message })
 }

 let stdout = ''
 let stderr = ''

 stream.on('data', (chunk) => {
 stdout += chunk.toString('utf-8')
 })

 stream.stderr.on('data', (chunk) => {
 stderr += chunk.toString('utf-8')
 })

 stream.on('close', (code) => {
 if (code !== 0) {
 return res.json({ success: false, error: stderr.trim() || `Exit code: ${code}`, exitCode: code })
 }
 res.json({ success: true, data: stdout, exitCode: code })
 })

 setTimeout(() => {
 stream.close()
 }, 30000)
 })
}

/** dockerExec 的 Promise 版本（用于内部调用） */
function dockerExecAsync(connectionId, dockerCmd) {
 return new Promise((resolve, reject) => {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return reject(new Error('SSH not connected'))
 }

 conn.ssh.exec(dockerCmd, { pty: false }, (err, stream) => {
 if (err) return reject(err)

 let stdout = ''
 let stderr = ''

 stream.on('data', (chunk) => { stdout += chunk.toString('utf-8') })
 stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8') })

 stream.on('close', (code) => {
 if (code !== 0) {
 reject(new Error(stderr.trim() || `Exit code: ${code}`))
 } else {
 resolve(stdout)
 }
 })
 })
 })
}

// 列出容器
app.post('/api/docker/ps', (req, res) => {
 const { connectionId, all } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })
 const flag = all !== false ? '-a' : ''
 dockerExec(connectionId, `docker ps ${flag} --format '{{json .}}' 2>/dev/null`, res)
})

// 列出镜像
app.post('/api/docker/images', (req, res) => {
 const { connectionId } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })
 dockerExec(connectionId, "docker images --format '{{json .}}' 2>/dev/null", res)
})

// 容器统计（CPU/内存）
app.post('/api/docker/stats', (req, res) => {
 const { connectionId } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })
 dockerExec(connectionId, "docker stats --no-stream --format '{{json .}}' 2>/dev/null", res)
})

// 检查容器/镜像详情
app.post('/api/docker/inspect', (req, res) => {
 const { connectionId, id } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 dockerExec(connectionId, `docker inspect ${escapeShellArg(id)} 2>/dev/null`, res)
})

// 获取容器日志
app.post('/api/docker/logs', (req, res) => {
 const { connectionId, id, tail } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 const n = tail || 200
 dockerExec(connectionId, `docker logs --tail ${n} --timestamps ${escapeShellArg(id)} 2>&1`, res)
})

// 启动容器
app.post('/api/docker/start', (req, res) => {
 const { connectionId, id } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 dockerExec(connectionId, `docker start ${escapeShellArg(id)} 2>&1`, res)
})

// 停止容器
app.post('/api/docker/stop', (req, res) => {
 const { connectionId, id } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 dockerExec(connectionId, `docker stop ${escapeShellArg(id)} 2>&1`, res)
})

// 重启容器
app.post('/api/docker/restart', (req, res) => {
 const { connectionId, id } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 dockerExec(connectionId, `docker restart ${escapeShellArg(id)} 2>&1`, res)
})

// 删除容器
app.post('/api/docker/rm', (req, res) => {
 const { connectionId, id, force } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 const f = force ? '-f' : ''
 dockerExec(connectionId, `docker rm ${f} ${escapeShellArg(id)} 2>&1`, res)
})

// 删除镜像
app.post('/api/docker/rmi', (req, res) => {
 const { connectionId, id, force } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 const f = force ? '-f' : ''
 dockerExec(connectionId, `docker rmi ${f} ${escapeShellArg(id)} 2>&1`, res)
})

// 拉取镜像
app.post('/api/docker/pull', (req, res) => {
 const { connectionId, image, allTags } = req.body
 if (!connectionId || !image) return res.status(400).json({ error: 'Missing connectionId or image' })
 const flag = allTags ? '--all-tags ' : ''
 dockerExec(connectionId, `docker pull ${flag}${escapeShellArg(image)} 2>&1`, res)
})

// 推送镜像
app.post('/api/docker/push', (req, res) => {
 const { connectionId, image } = req.body
 if (!connectionId || !image) return res.status(400).json({ error: 'Missing connectionId or image' })
 dockerExec(connectionId, `docker push ${escapeShellArg(image)} 2>&1`, res)
})

// 打标签
app.post('/api/docker/tag', (req, res) => {
 const { connectionId, source, target } = req.body
 if (!connectionId || !source || !target) return res.status(400).json({ error: 'Missing connectionId, source or target' })
 dockerExec(connectionId, `docker tag ${escapeShellArg(source)} ${escapeShellArg(target)} 2>&1`, res)
})

// 清理未使用镜像
app.post('/api/docker/prune', (req, res) => {
 const { connectionId, all } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })
 const flag = all ? '-a ' : ''
 dockerExec(connectionId, `docker image prune ${flag}-f 2>&1`, res)
})

// 查看镜像历史
app.post('/api/docker/history', (req, res) => {
 const { connectionId, id } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })
 dockerExec(connectionId, `docker history ${escapeShellArg(id)} --no-trunc --format '{{json .}}' 2>/dev/null`, res)
})

// 在容器中执行命令（交互式终端）
app.post('/api/docker/exec', (req, res) => {
 const { connectionId, id, command, shell } = req.body
 if (!connectionId || !id) return res.status(400).json({ error: 'Missing connectionId or id' })

 const cmd = shell
 ? `docker exec -it ${escapeShellArg(id)} ${escapeShellArg(shell)} -c ${escapeShellArg(command)} 2>&1`
 : `docker exec ${escapeShellArg(id)} ${escapeShellArg(command || 'id')} 2>&1`

 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return res.status(400).json({ error: 'SSH 未连接' })
 }

 conn.ssh.exec(cmd, (err, stream) => {
 if (err) {
 return res.json({ success: false, error: `docker exec 失败: ${err.message}` })
 }
 let stdout = ''
 let stderr = ''
 stream.on('data', (data) => { stdout += data.toString() })
 stream.stderr.on('data', (data) => { stderr += data.toString() })
 stream.on('close', (code) => {
 res.json({ success: code === 0, data: stdout, error: stderr || undefined, exitCode: code })
 })
 })
})

// 获取 docker-compose 项目列表
app.post('/api/docker/compose', (req, res) => {
 const { connectionId, filePath } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })
 if (filePath) {
 dockerExec(connectionId, `docker compose -f ${escapeShellArg(filePath)} ps --format '{{json .}}' 2>/dev/null`, res)
 } else {
 // 自动发现 compose 文件
 dockerExec(connectionId, 'find /home /opt /srv /app /mnt -maxdepth 5 -name "docker-compose*.yml" -o -name "docker-compose*.yaml" -o -name "compose*.yml" -o -name "compose*.yaml" 2>/dev/null | head -30', res)
 }
})

// Docker Compose 操作
app.post('/api/docker/compose/action', (req, res) => {
 const { connectionId, filePath, action, service, args } = req.body
 if (!connectionId || !filePath || !action) {
 return res.status(400).json({ error: 'Missing connectionId, filePath or action' })
 }

 const allowed = ['up', 'down', 'restart', 'stop', 'start', 'ps', 'logs', 'pull', 'build']
 if (!allowed.includes(action)) {
 return res.status(400).json({ error: `不支持的操作: ${action}` })
 }

 let cmd = `docker compose -f ${escapeShellArg(filePath)} ${action}`

 if (service) {
 cmd += ` ${escapeShellArg(service)}`
 }
 if (args) {
 cmd += ` ${args}`
 }
 if (action === 'up') {
 cmd += ' -d'
 }
 if (action === 'logs') {
 cmd += ' --tail 100 --timestamps'
 }
 cmd += ' 2>&1'

 // 对于持续输出的操作设置较长时间
 const timeout = action === 'up' || action === 'logs' ? 30000 : 15000
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return res.status(400).json({ error: 'SSH 未连接' })
 }

 conn.ssh.exec(cmd, { pty: false }, (err, stream) => {
 if (err) return res.status(500).json({ error: err.message })

 let stdout = ''
 let stderr = ''
 const timer = setTimeout(() => { stream.close() }, timeout)

 stream.on('data', (chunk) => { stdout += chunk.toString('utf-8') })
 stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8') })
 stream.on('close', (code) => {
 clearTimeout(timer)
 if (code !== 0 && !stdout.trim()) {
 return res.json({ success: false, data: stdout, error: stderr.trim() || `Exit code: ${code}`, exitCode: code })
 }
 res.json({ success: true, data: stdout, error: stderr || undefined, exitCode: code })
 })
 })
})

// Docker 终端 WebSocket 处理（已在 handleMessage 中注册）

// ========== 日志聚合 API ==========

/** 辅助：通过 SSH 执行日志相关命令 */
/**
 * 执行 SSH 日志命令，若遇到权限错误自动用 sudo 重试
 * @param {boolean} _sudoRetry - 内部标记，是否已是 sudo 重试
 */
function logExec(connectionId, cmd, res, { _sudoRetry = false } = {}) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return res.status(400).json({ error: 'SSH not connected' })
 }

 conn.ssh.exec(cmd, { pty: false }, (err, stream) => {
 if (err) {
 return res.status(500).json({ error: err.message })
 }

 let stdout = ''
 let stderr = ''

 // 设置超时：日志命令可能量大，给 15 秒
 const timeout = setTimeout(() => {
 stream.close()
 }, 15000)

 stream.on('data', (chunk) => {
 stdout += chunk.toString('utf-8')
 })

 stream.stderr.on('data', (chunk) => {
 stderr += chunk.toString('utf-8')
 })

 stream.on('close', (code) => {
 clearTimeout(timeout)
 // 权限不足且未重试过 → 自动用 sudo -S 重试
 // 同时检查 stdout 和 stderr（因为有些命令用了 2>&1）
 const permDenied = /permission denied/i.test(stderr) || /permission denied/i.test(stdout)
 if (code !== 0 && !_sudoRetry && permDenied) {
 const sudoPwd = conn.sudoPassword
 let sudoCmd
 if (sudoPwd) {
 // 有 sudo 密码：用 echo + sudo -S
 const escapedPwd = sudoPwd.replace(/'/g, "'\\''")
 sudoCmd = `echo '${escapedPwd}' | sudo -S ${cmd}`
 } else {
 // 无密码 sudo（NOPASSWD 配置）
 sudoCmd = `sudo ${cmd}`
 }
 return logExec(connectionId, sudoCmd, res, { _sudoRetry: true })
 }
 if (code !== 0 && !stdout.trim()) {
 return res.json({ success: false, error: stderr.trim() || `Exit code: ${code}`, exitCode: code })
 }
 res.json({ success: true, data: stdout, exitCode: code })
 })
 })
}

// 列出日志源 — 尝试常见系统日志路径
app.post('/api/logs/list-sources', (req, res) => {
 const { connectionId } = req.body
 if (!connectionId) return res.status(400).json({ error: 'Missing connectionId' })

 logExec(connectionId,
 `echo "---common---" && ` +
 `for f in /var/log/syslog /var/log/messages /var/log/auth.log /var/log/secure /var/log/kern.log ` +
 `/var/log/dmesg /var/log/faillog /var/log/boot.log /var/log/maillog /var/log/cron ` +
 `/var/log/nginx/access.log /var/log/nginx/error.log /var/log/apache2/access.log ` +
 `/var/log/apache2/error.log /var/log/httpd/access_log /var/log/httpd/error_log ` +
 `/var/log/mysql/error.log /var/log/mariadb/mariadb.log ` +
 `/var/log/redis/redis-server.log ` +
 `/var/log/dpkg.log /var/log/yum.log /var/log/apt/history.log; do ` +
 `if [ -f "$f" ]; then ls -lh "$f" 2>/dev/null | awk '{print $5, $NF}'; fi; done`,
 res
 )
})

// tail 日志
app.post('/api/logs/tail', (req, res) => {
 const { connectionId, path, lines } = req.body
 if (!connectionId || !path) return res.status(400).json({ error: 'Missing connectionId or path' })
 const n = Math.min(Math.max(parseInt(lines) || 200, 10), 5000)
 logExec(connectionId, `tail -n ${n} ${escapeShellArg(path)} 2>&1`, res)
})

// grep 日志
app.post('/api/logs/grep', (req, res) => {
 const { connectionId, path, pattern, context, ignoreCase } = req.body
 if (!connectionId || !path || !pattern) return res.status(400).json({ error: 'Missing connectionId, path, or pattern' })
 const ic = ignoreCase !== false ? '-i' : ''
 const ctx = Math.min(Math.max(parseInt(context) || 0, 0), 10)
 let cmd
 if (ctx > 0) {
 cmd = `grep ${ic} -C ${ctx} ${escapeShellArg(pattern)} ${escapeShellArg(path)} 2>&1 | tail -c 1048576`
 } else {
 cmd = `grep ${ic} ${escapeShellArg(pattern)} ${escapeShellArg(path)} 2>&1 | tail -c 1048576`
 }
 logExec(connectionId, cmd, res)
})

// ─── 插件市场 API ───

// 默认插件市场源
const MARKET_INDEX_URL = process.env.MARKET_INDEX_URL || 'https://raw.githubusercontent.com/shengqiangdd/smartbox-plugins/main/index.json'

// 本地市场 fallback：从本地已安装插件生成市场数据
function getLocalMarketIndex() {
 const localPlugins = []
 if (fs.existsSync(pluginsDir)) {
 const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
 for (const entry of entries) {
 if (!entry.isDirectory()) continue
 const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json')
 if (!fs.existsSync(manifestPath)) continue
 try {
 const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
 localPlugins.push({
 id: m.id || entry.name,
 name: m.name || entry.name,
 version: m.version || '1.0.0',
 description: m.description || '',
 author: m.author || 'SmartBox',
 icon: m.icon || 'puzzle',
 tags: m.tags || [],
 manifestUrl: `local://${entry.name}/manifest.json`,
 pluginUrl: `local://${entry.name}/plugin.js`,
 updatedAt: '2026-06-26',
 downloads: 0,
 })
 } catch { /* skip broken manifests */ }
 }
 }
 return { plugins: localPlugins, updatedAt: new Date().toISOString().slice(0, 10), message: 'SmartBox 插件市场 - 内置插件集' }
}

// 获取市场插件列表（远程优先，失败 fallback 到本地）
app.get('/api/market/index', async (req, res) => {
 try {
 const response = await fetch(MARKET_INDEX_URL, {
 signal: AbortSignal.timeout(8000),
 })
 if (!response.ok) {
 console.log('[market] Remote fetch failed, using local fallback')
 return res.json(getLocalMarketIndex())
 }
 const data = await response.json()
 res.json(data)
 } catch (err) {
 console.log(`[market] Remote fetch error: ${err.message}, using local fallback`)
 res.json(getLocalMarketIndex())
 }
})

// 辅助：从 URL 读取内容（支持 local:// 协议读本地文件）
async function fetchContent(url, timeout = 15000) {
 if (url.startsWith('local://')) {
 const relPath = url.replace('local://', '')
 const localPath = path.join(pluginsDir, relPath)
 if (!fs.existsSync(localPath)) throw new Error(`Local file not found: ${relPath}`)
 return fs.readFileSync(localPath, 'utf-8')
 }
 const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) })
 if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`)
 return resp.text()
}

// 安装插件（从市场下载 manifest + plugin.js 到 plugins/ 目录，支持 local:// 协议）
app.post('/api/plugins/install', async (req, res) => {
 const { pluginId, manifestUrl, pluginUrl } = req.body
 if (!pluginId || !manifestUrl || !pluginUrl) {
 return res.status(400).json({ error: 'Missing pluginId, manifestUrl, or pluginUrl' })
 }

 const targetDir = path.join(pluginsDir, pluginId)

 // 安全校验：不允许路径穿越
 if (!targetDir.startsWith(pluginsDir)) {
 return res.status(400).json({ error: 'Invalid plugin ID' })
 }

 // 检查是否已安装
 if (fs.existsSync(targetDir)) {
 return res.status(409).json({ error: `Plugin "${pluginId}" is already installed` })
 }

 try {
 // 创建目录
 fs.mkdirSync(targetDir, { recursive: true })

 // 获取 manifest.json
 const manifestText = await fetchContent(manifestUrl)

 // 验证 manifest 格式
 try {
 const manifest = JSON.parse(manifestText)
 if (!manifest.id || !manifest.name) {
 throw new Error('Invalid manifest: missing id or name')
 }
 } catch (parseErr) {
 fs.rmSync(targetDir, { recursive: true, force: true })
 return res.status(400).json({ error: `Invalid manifest format: ${parseErr.message}` })
 }

 fs.writeFileSync(path.join(targetDir, 'manifest.json'), manifestText, 'utf-8')

 // 获取 plugin.js
 const jsText = await fetchContent(pluginUrl, 30000)

 // 安全检查：简单验证 JS 代码不为空
 if (!jsText.trim()) {
 fs.rmSync(targetDir, { recursive: true, force: true })
 return res.status(400).json({ error: 'Plugin JS is empty' })
 }

 fs.writeFileSync(path.join(targetDir, 'plugin.js'), jsText, 'utf-8')

 res.json({
 success: true,
 pluginId,
 message: `Plugin "${pluginId}" installed successfully`,
 })
 } catch (err) {
 // 清理残留目录
 try { fs.rmSync(targetDir, { recursive: true, force: true }) } catch {}
 res.status(500).json({ error: `Install failed: ${err.message}` })
 }
})

// 卸载插件
app.post('/api/plugins/uninstall', (req, res) => {
 const { pluginId } = req.body
 if (!pluginId) {
 return res.status(400).json({ error: 'Missing pluginId' })
 }

 const targetDir = path.join(pluginsDir, pluginId)
 if (!targetDir.startsWith(pluginsDir)) {
 return res.status(400).json({ error: 'Invalid plugin ID' })
 }

 if (!fs.existsSync(targetDir)) {
 return res.status(404).json({ error: `Plugin "${pluginId}" not found` })
 }

 try {
 fs.rmSync(targetDir, { recursive: true, force: true })
 res.json({
 success: true,
 pluginId,
 message: `Plugin "${pluginId}" uninstalled`,
 })
 } catch (err) {
 res.status(500).json({ error: `Uninstall failed: ${err.message}` })
 }
})

// 获取单个插件的 Manifest
app.get('/api/plugins/:id/manifest.json', (req, res) => {
 const id = req.params.id.replace(/\.\.\//g, '').replace(/\.\./g, '').replace(/[\\/]/g, '')
 if (!id) {
 return res.status(400).json({ error: 'Invalid plugin ID' })
 }
 const manifestPath = path.join(pluginsDir, id, 'manifest.json')
 if (fs.existsSync(manifestPath)) {
 const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
 res.json(manifest)
 } else {
 res.status(404).json({ error: 'Manifest not found' })
 }
})

// ========== AI 配置 API ==========

// 获取 AI 配置（返回后端环境变量中的 API Key）
app.get('/api/ai/config', (req, res) => {
 const apiKey = process.env.OPENROUTER_API_KEY || null
 res.json({ apiKey })
})

// 获取指定服务商的最新免费模型列表
app.get('/api/ai/fetch-free-models', async (req, res) => {
 const apiKey = process.env.OPENROUTER_API_KEY
 if (!apiKey) {
 return res.status(503).json({ error: 'OpenRouter API Key 未配置' })
 }
 try {
 const resp = await fetch('https://openrouter.ai/api/v1/models', {
 headers: { Authorization: `Bearer ${apiKey}` },
 })
 if (!resp.ok) {
 const errBody = await resp.text()
 return res.status(resp.status).json({ error: `OpenRouter API 错误: ${resp.status} ${errBody}` })
 }
 const data = await resp.json()
 const models = data.data || []
 const freeModels = models
 .filter((m) => m.pricing && m.pricing.request && m.pricing.request <= 0)
 .map((m) => ({
 value: m.id,
 label: m.name || m.id,
 free: true,
 description: m.description || '',
 }))
 .sort((a, b) => a.label.localeCompare(b.label))
 res.json({ models: freeModels })
 } catch (err) {
 res.json({ models: [], error: err.message })
 }
})

// 获取指定服务商的所有可用模型列表
app.get('/api/ai/fetch-all-models', async (req, res) => {
 const { provider } = req.query
 const apiKey = process.env.OPENROUTER_API_KEY

 if (provider === 'openrouter' || !provider) {
 if (!apiKey) {
 return res.status(503).json({ error: 'OpenRouter API Key 未配置' })
 }
 try {
 const resp = await fetch('https://openrouter.ai/api/v1/models', {
 headers: { Authorization: `Bearer ${apiKey}` },
 })
 if (!resp.ok) {
 const errBody = await resp.text()
 return res.status(resp.status).json({ error: `OpenRouter API 错误: ${resp.status} ${errBody}` })
 }
 const data = await resp.json()
 const models = data.data || []
 const allModels = models
 .map((m) => ({
 value: m.id,
 label: m.name || m.id,
 free: m.pricing && m.pricing.request && m.pricing.request <= 0,
 description: m.description || '',
 }))
 .sort((a, b) => {
 if (a.free !== b.free) return b.free - a.free
 return a.label.localeCompare(b.label)
 })
 return res.json({ models: allModels })
 } catch (err) {
 return res.json({ models: [], error: err.message })
 }
 }

 // 默认 fallback：返回空列表
 res.json({ models: [] })
})

// ========== WebSocket 路由 ==========

app.ws('/ws', (ws, req) => {
 // ─── Token 认证 ───
 const url = new URL(req.url, `http://${req.headers.host}`)
 const token = url.searchParams.get('token')
 const clientIp = req.ip || req.socket?.remoteAddress

 if (!validateWsToken(token, clientIp)) {
 auditLog('ws_auth_failed', { ip: clientIp, reason: 'invalid_token' }, req)
 ws.close(4001, '认证失败：无效或过期的 token')
 return
 }

 const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
 auditLog('ws_connected', { clientId, ip: clientIp }, req)
 console.log(`[Bridge] Client connected: ${clientId} (${clientIp})`)

 // 消息大小限制：1MB
 const MAX_MSG_SIZE = 1024 * 1024
 let messageSizeWarning = false

 // 心跳检测
 let heartbeatTimer = null
 const startHeartbeat = () => {
 heartbeatTimer = setInterval(() => {
 try { ws.ping() } catch (_) { /* ignore */ }
 }, 30000)
 }
 const stopHeartbeat = () => {
 if (heartbeatTimer) {
 clearInterval(heartbeatTimer)
 heartbeatTimer = null
 }
 }
 startHeartbeat()

 // 消息处理
 ws.on('message', (raw) => {
 try {
 // 消息大小检查
 if (raw.length > MAX_MSG_SIZE) {
 auditLog('ws_msg_too_large', { clientId, size: raw.length }, req)
 sendError(ws, null, 'MESSAGE_TOO_LARGE', '消息大小超过限制')
 return
 }

 const msg = JSON.parse(raw.toString())

 // 基础消息验证
 if (!msg.type || typeof msg.type !== 'string') {
 sendError(ws, null, 'INVALID_MESSAGE', '消息缺少 type 字段')
 return
 }

 handleMessage(ws, clientId, msg)
 } catch (err) {
 sendError(ws, null, 'INVALID_MESSAGE', '无法解析消息')
 }
 })

 ws.on('close', () => {
 auditLog('ws_disconnected', { clientId }, req)
 console.log(`[Bridge] Client disconnected: ${clientId}`)
 stopHeartbeat()
 // 清理该客户端的所有 SSH 连接
 for (const [connId, conn] of connections) {
 if (conn.ws === ws) {
 cleanupConnection(connId)
 }
 }
 })

 ws.on('error', (err) => {
 auditLog('ws_error', { clientId, error: err.message }, req)
 console.error(`[Bridge] WebSocket error (${clientId}):`, err.message)
 })
})

// ========== 消息路由 ==========

function handleMessage(ws, clientId, msg) {
 const { type, connectionId, requestId, ...payload } = msg

 switch (type) {
 case 'ping':
 sendJson(ws, { type: 'pong', requestId })
 break

 case 'test':
 handleTestConnection(ws, connectionId, requestId, payload)
 break

 case 'connect':
 handleConnect(ws, connectionId, requestId, payload)
 break

 case 'disconnect':
 cleanupConnection(connectionId)
 break

 case 'exec':
 handleExec(ws, connectionId, requestId, payload)
 break

 case 'resize':
 handleResize(ws, connectionId, payload)
 break

 case 'sftp':
 handleSftp(ws, connectionId, requestId, payload)
 break

 case 'logtail_start':
 handleLogtailStart(ws, connectionId, requestId, payload)
 break

 case 'logtail_stop':
 handleLogtailStop(ws, connectionId, requestId, payload)
 break

 case 'docker_shell':
 handleDockerShell(ws, connectionId, requestId, payload)
 break

 case 'docker_shell_data':
 handleDockerShellData(ws, connectionId, requestId, payload)
 break

 case 'docker_shell_resize':
 handleDockerShellResize(ws, connectionId, requestId, payload)
 break

 default:
 sendError(ws, connectionId, requestId, 'UNKNOWN_TYPE', `未知消息类型: ${type}`)
 }
}

// ========== SSH 连接处理 ==========

async function handleConnect(ws, connectionId, requestId, config) {
 const { host, port, username, password, privateKey, sudoPassword } = config

 // ─── 输入验证 ───
 const validation = validateConnectionParams({ host, port, username, password, privateKey })
 if (!validation.valid) {
 auditLog('ssh_connect_invalid', { host, errors: validation.errors })
 return sendError(ws, connectionId, requestId, 'INVALID_CONFIG', validation.errors.join('; '))
 }

 // 注入检测
 const allInputs = [host, username, password, privateKey].filter(Boolean).join(' ')
 if (detectInjection(allInputs)) {
 auditLog('injection_detected', { host, username }, null)
 return sendError(ws, connectionId, requestId, 'INVALID_CONFIG', '检测到非法字符')
 }

 try {
 const ssh = new Client()
 const connState = {
 ws,
 ssh,
 sftp: null,
 connectionId,
 host, port, username, // 调试和审计用
 shellStream: null,
 shells: new Map(),
 password: password || null, // 用于 sudo -S
 sudoPassword: sudoPassword || password || null, // sudo 密码（可独立配置）
 }
 let connected = false
 let timedOut = false

 // 超时兜底：15秒无响应则断开
 const connectTimeout = setTimeout(() => {
 if (!connected) {
 timedOut = true
 console.warn(`[SSH] Connection timeout: ${username}@${host}:${port} (${connectionId})`)
 ssh.end()
 sendError(ws, connectionId, requestId, 'TIMEOUT', `连接超时（15秒），请检查：
• 主机地址是否正确
• 端口 ${port || 22} 是否开放
• 内网防火墙是否允许 SSH 连接
• 目标主机是否在线`)
 }
 }, 15000)

 ssh.on('ready', () => {
 if (timedOut) return
 connected = true
 clearTimeout(connectTimeout)
 console.log(`[SSH] Connected: ${username}@${host}:${port} (${connectionId})`)
 connections.set(connectionId, connState)

 sendJson(ws, { type: 'connected', connectionId, requestId })

 // 自动打开 shell 和 SFTP session
 openShell(connState, connectionId)
 openSftp(connState, connectionId)
 })

 ssh.on('close', () => {
 clearTimeout(connectTimeout)
 console.log(`[SSH] Connection closed: ${connectionId}`)
 connections.delete(connectionId)
 if (ws.readyState === ws.OPEN && !timedOut) {
 sendJson(ws, { type: 'disconnected', connectionId, requestId })
 }
 })

 ssh.on('error', (err) => {
 clearTimeout(connectTimeout)
 if (timedOut) return
 console.error(`[SSH] Error (${connectionId}):`, err.message)
 console.error(`[SSH] Config (${connectionId}): ${username}@${host}:${port || 22}, auth=${privateKey ? 'key' : 'password'}, passwordLen=${password ? password.length : 0}`)
 sendError(ws, connectionId, requestId, 'SSH_ERROR', `连接失败: ${err.message}`)
 })

 const connectConfig = {
 host,
 port: port || 22,
 username,
 readyTimeout: 10000,
 keepaliveInterval: 10000,
 keepaliveCountMax: 3,
 }

 if (privateKey) {
 connectConfig.privateKey = privateKey
 } else {
 connectConfig.password = password || undefined
 }

 ssh.connect(connectConfig)

 } catch (err) {
 console.error(`[SSH] Connection failed (${connectionId}):`, err.message)
 sendError(ws, connectionId, requestId, 'CONNECT_FAILED', err.message)
 }
}

// ========== 测试 SSH 连接 ==========

function handleTestConnection(ws, connectionId, requestId, config) {
 const { host, port, username, password, privateKey } = config

 // ─── 输入验证 ───
 const validation = validateConnectionParams({ host, port, username, password, privateKey })
 if (!validation.valid) {
 return sendJson(ws, {
 type: 'test-result',
 connectionId,
 requestId,
 success: false,
 message: validation.errors.join('; '),
 })
 }

 // 注入检测
 const allInputs = [host, username, password, privateKey].filter(Boolean).join(' ')
 if (detectInjection(allInputs)) {
 return sendJson(ws, {
 type: 'test-result',
 connectionId,
 requestId,
 success: false,
 message: '检测到非法字符',
 })
 }

 const ssh = new Client()
 const timeout = setTimeout(() => {
 ssh.end()
 sendJson(ws, {
 type: 'test-result',
 connectionId,
 requestId,
 success: false,
 message: '连接超时（10秒）',
 })
 }, 10000)

 ssh.on('ready', () => {
 clearTimeout(timeout)
 ssh.end()
 sendJson(ws, {
 type: 'test-result',
 connectionId,
 requestId,
 success: true,
 message: `成功连接到 ${username}@${host}:${port || 22}`,
 })
 })

 ssh.on('error', (err) => {
 clearTimeout(timeout)
 sendJson(ws, {
 type: 'test-result',
 connectionId,
 requestId,
 success: false,
 message: `连接失败: ${err.message}`,
 })
 })

 const connectConfig = {
 host,
 port: port || 22,
 username,
 readyTimeout: 10000,
 keepaliveInterval: 5000,
 keepaliveCountMax: 1,
 }
 if (privateKey) {
 connectConfig.privateKey = privateKey
 } else {
 connectConfig.password = password || undefined
 }

 ssh.connect(connectConfig)
}

// ========== 打开交互式 Shell ==========

function openShell(connState, shellId) {
 const { ssh, ws } = connState

 ssh.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
 if (err) {
 return sendError(ws, connState.connectionId, 'SHELL_ERROR', err.message)
 }

 connState.shellStream = stream
 connState.shells.set(shellId, stream)

 stream.on('data', (chunk) => {
 if (ws.readyState === ws.OPEN) {
 sendJson(ws, {
 type: 'data',
 connectionId: shellId,
 data: chunk.toString('base64'),
 })
 }
 })

 stream.stderr.on('data', (chunk) => {
 if (ws.readyState === ws.OPEN) {
 sendJson(ws, {
 type: 'data',
 connectionId: shellId,
 data: chunk.toString('base64'),
 })
 }
 })

 stream.on('close', (code) => {
 console.log(`[SSH] Shell closed (${shellId}), code: ${code}`)
 connState.shells.delete(shellId)
 if (connState.shellStream === stream) {
 connState.shellStream = null
 }
 if (ws.readyState === ws.OPEN) {
 sendJson(ws, { type: 'shell-closed', connectionId: shellId, code })
 }
 })
 })
}

// ========== 打开 SFTP ==========

function openSftp(connState, connectionId) {
 const { ssh, ws } = connState

 // ⚠️ 有些 SSH 服务器的 SFTP 子系统永不响应导致 ssh.sftp() 回调挂起，
 //    因此设 5 秒超时保护，超时后 handleSftp 会自动降级到 sudo ls -la。
 let sftpDone = false
 const sftpTimer = setTimeout(() => {
   if (!sftpDone) {
     sftpDone = true
     console.warn(`[SSH] SFTP init timeout (${connectionId}), will use sudo fallback`)
     if (ws.readyState === ws.OPEN) {
       sendJson(ws, { type: 'sftp-ready', connectionId, timedOut: true })
     }
   }
 }, 5000)

 ssh.sftp((err, sftp) => {
 if (sftpDone) return
 clearTimeout(sftpTimer)
 sftpDone = true
 if (err) {
 console.error(`[SSH] SFTP init failed (${connectionId}):`, err.message)
 return
 }
 connState.sftp = sftp
 if (ws.readyState === ws.OPEN) {
 sendJson(ws, { type: 'sftp-ready', connectionId })
 }
 })
}

// ========== 终端数据写入 ==========

function handleExec(ws, connectionId, requestId, payload) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return sendError(ws, connectionId, requestId, 'NOT_CONNECTED', 'SSH 未连接')
 }

 const { data } = payload

 // 解码 base64 数据（前端 btoa 编码的数据）
 let decoded
 try {
 decoded = decodeURIComponent(escape(atob(data)))
 } catch {
 decoded = data
 }

 // 优先使用 shell stream 写入
 const shellStream = conn.shells.get(connectionId) || conn.shellStream
 if (shellStream) {
 shellStream.write(decoded)
 } else {
 sendError(ws, connectionId, requestId, 'NO_SHELL', 'Shell 尚未就绪')
 }
}

// ========== 终端大小调整 ==========

function handleResize(ws, connectionId, payload) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return sendError(ws, connectionId, 'NOT_CONNECTED', 'SSH 未连接')
 }

 const { cols, rows } = payload
 const shellStream = conn.shells.get(connectionId) || conn.shellStream
 if (shellStream && shellStream.setWindow) {
 shellStream.setWindow(rows || 24, cols || 80, 0, 0)
 }
}

// ========== SFTP 操作（带 sudo 降级） ==========

/**
 * 判断错误是否为权限错误（Permission denied / EACCES / EPERM）
 */
function isPermissionError(err) {
 if (!err) return false
 const msg = (err.message || err.code || '').toLowerCase()
 return msg.includes('permission denied') || msg.includes('eacces') || msg.includes('eperm')
}

/**
 * 通过 SSH exec 执行 sudo 命令，返回退出码和标准输出
 * 关键：用 pty 模式执行 sudo，避免某些系统 requiretty 导致失败
 */
function sudoExec(conn, command, callback) {
 // 某些系统 sudo 需要 tty 才能运行，所以用 pty 模式
 conn.ssh.exec(command, { pty: true }, (err, stream) => {
 if (err) return callback(err)
 let stdout = ''
 let stderr = ''
 stream.on('data', (chunk) => { stdout += chunk.toString('utf-8') })
 stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8') })
 stream.on('close', (exitCode) => {
 if (exitCode !== 0) {
 callback(new Error(stderr.trim() || `命令退出码: ${exitCode}`))
 } else {
 callback(null, stdout)
 }
 })
 // 写入 sudo 密码到 stdin（sudo -S 模式从 stdin 读取密码）
 if (conn.sudoPassword) {
 stream.write(conn.sudoPassword + '\n')
 }
 // 结束 stdin 避免 sudo 挂起等待输入
 stream.end()
 })
}

/**
 * 通过 exec 执行命令（无 sudo），用于 stat 等辅助查询
 */
function plainExec(conn, command, callback) {
 conn.ssh.exec(command, { pty: false }, (err, stream) => {
 if (err) return callback(err)
 let stdout = ''
 let stderr = ''
 stream.on('data', (chunk) => { stdout += chunk.toString('utf-8') })
 stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8') })
 stream.on('close', (exitCode) => {
 if (exitCode !== 0) {
 callback(new Error(stderr.trim() || `命令退出码: ${exitCode}`))
 } else {
 callback(null, stdout)
 }
 })
 })
}

function handleSftp(ws, connectionId, requestId, payload) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return sendError(ws, connectionId, requestId, 'NOT_CONNECTED', 'SSH 未连接')
 }

 const { operation } = payload

 // ─── 路径验证 ───
 const pathFields = ['path', 'from', 'to', 'remotePath', 'dirPath']
 for (const field of pathFields) {
 if (payload[field] && !isValidPath(payload[field])) {
 auditLog('sftp_path_invalid', { connectionId, field, value: payload[field] })
 return sendError(ws, connectionId, requestId, 'INVALID_PATH', `非法路径: ${field}`)
 }
 }

 // ─── 文件名验证 ───
 if (payload.name && !isValidFilename(payload.name)) {
 auditLog('sftp_filename_invalid', { connectionId, name: payload.name })
 return sendError(ws, connectionId, requestId, 'INVALID_FILENAME', '无效的文件名')
 }

 switch (operation) {
 case 'list': {
 const { path: dirPath } = payload
 const absPath = dirPath === '/' ? '/' : dirPath.replace(/\/+$/, '')

 // 优先用 SFTP，如果不可用或者读取失败则走 sudo ls
 const doSftpList = () => {
 if (!conn.sftp) return doSudoList()
 const readPath = absPath === '/' ? '/' : absPath
 const prefix = absPath === '/' ? '/' : absPath + '/'
 conn.sftp.readdir(readPath, (err, list) => {
 if (err) {
 if (isPermissionError(err)) {
 console.log(`[SFTP] list permission denied, falling back to sudo: ${absPath}`)
 return doSudoList()
 }
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 sendJson(ws, {
 type: 'sftp-result',
 connectionId,
 requestId,
 operation: 'list',
 files: (list || []).map(item => {
 // 通过 longname 首字符识别类型：d=目录, l=符号链接(可能指向目录)
 const longnameType = item.longname ? item.longname[0] : ''
 const isDir = longnameType === 'd' || longnameType === 'l'
 return {
 name: item.filename,
 path: prefix + item.filename,
 type: isDir ? 'directory' : 'file',
 size: item.attrs.size,
 modifyTime: item.attrs.mtime * 1000,
 permissions: item.attrs.mode ? (item.attrs.mode & 0o777).toString(8) : '755',
 owner: '',
 group: '',
 }
 }),
 })
 })
 }

 // sudo ls 降级：用 sudo ls -la 解析类型
 const doSudoList = () => {
 // ls -la 第一列首字符: d=目录, l=符号链接(指向目录), -=普通文件
 const listCmd = `sudo ls -la ${escapeShellArg(absPath)} 2>/dev/null | tail -n +2`
 sudoExec(conn, listCmd, (err, stdout) => {
 if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `列表失败: ${err.message}`)
 const prefix = absPath === '/' ? '/' : absPath + '/'
 const entries = [] // { name: string, isDir: boolean }
 for (const line of stdout.split('\n')) {
 if (!line || line.length < 2) continue
 const typeChar = line[0]
 if (typeChar === 't' || line.startsWith('total ')) continue
 // 用简单方法提取文件名：最后的空格后内容，去掉可能的箭头(->)和跟随的路径
 // ls -la 结尾可能包含: name -> /target
 const match = line.match(/^.\S+\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+\S+\s+(.+)$/)
 if (match) {
 let rawName = match[1]
 // 去掉符号链接的 -> /target
 const arrowIdx = rawName.indexOf(' -> ')
 if (arrowIdx > 0) rawName = rawName.substring(0, arrowIdx)
 if (rawName !== '.' && rawName !== '..') {
 entries.push({ name: rawName, isDir: typeChar === 'd' || typeChar === 'l' })
 }
 }
 }
 const files = entries.map(function(e) {
 return {
 name: e.name,
 path: prefix + e.name,
 type: e.isDir ? 'directory' : 'file',
 size: 0,
 modifyTime: 0,
 permissions: '755',
 owner: '',
 group: '',
 }
 })
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'list', files })
 })
 }

 doSftpList()
 break
 }

 case 'stat': {
 if (!conn.sftp) return sendError(ws, connectionId, requestId, 'SFTP_NOT_READY', 'SFTP 未就绪（stat 需要 SFTP）')
 const { path: targetPath } = payload
 conn.sftp.stat(targetPath, (err, attrs) => {
 if (err) return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 sendJson(ws, {
 type: 'sftp-result',
 connectionId,
 requestId,
 operation: 'stat',
 data: { size: attrs.size, mode: attrs.mode, mtime: attrs.mtime },
 })
 })
 break
 }

 case 'readfile': {
 const { path: filePath } = payload
 if (conn.sftp) {
 conn.sftp.readFile(filePath, (err, data) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'readfile', data: data.toString('base64') })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 console.log(`[SFTP] readfile permission denied, falling back to sudo: ${filePath}`)
 readFileWithSudo(ws, conn, connectionId, requestId, filePath)
 })
 } else {
 readFileWithSudo(ws, conn, connectionId, requestId, filePath)
 }
 break
 }

 case 'writefile': {
 const { path: filePath, content } = payload
 const buf = Buffer.from(content, 'base64')

 // 先试 SFTP
 if (conn.sftp) {
 conn.sftp.writeFile(filePath, buf, (err) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'writefile', success: true })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 // 权限错误 → 降级 sudo
 console.log(`[SFTP] writefile permission denied, falling back to sudo: ${filePath}`)
 writeFileWithSudo(ws, conn, connectionId, requestId, filePath, buf)
 })
 } else {
 writeFileWithSudo(ws, conn, connectionId, requestId, filePath, buf)
 }
 break
 }

 // ─── 分块上传 ───
 case 'chunk_start': {
 const { path: targetPath } = payload
 if (!conn.sftp) {
 return sendError(ws, connectionId, requestId, 'SFTP_NOT_READY', '分块上传需要 SFTP')
 }

 // 创建唯一的临时文件路径
 const tmpId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 const tmpPath = `/tmp/.smartbox_chunk_${tmpId}`

 conn.sftp.open(tmpPath, 'w', 0o644, (openErr, handle) => {
 if (openErr) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', `创建临时文件失败: ${openErr.message}`)
 }
 // 记录分块状态
 const chunkKey = `${connectionId}:${tmpPath}`
 global.__chunkUploads = global.__chunkUploads || new Map()
 global.__chunkUploads.set(chunkKey, { handle, tmpPath, targetPath, writeOffset: 0 })

 sendJson(ws, {
 type: 'sftp-result',
 connectionId,
 requestId,
 operation: 'chunk_start',
 success: true,
 chunkId: tmpId,
 tmpPath,
 })
 })
 break
 }

 case 'chunk_append': {
 const { chunkId, content } = payload
 const tmpPath = `/tmp/.smartbox_chunk_${chunkId}`
 const chunkKey = `${connectionId}:${tmpPath}`

 global.__chunkUploads = global.__chunkUploads || new Map()
 const state = global.__chunkUploads.get(chunkKey)
 if (!state) {
 return sendError(ws, connectionId, requestId, 'CHUNK_NOT_FOUND', '分块上传会话不存在，请重新开始')
 }

 const buf = Buffer.from(content, 'base64')
 const { handle } = state
 const writeOffset = state.writeOffset

 conn.sftp.write(handle, buf, 0, buf.length, writeOffset, (writeErr) => {
 if (writeErr) {
 conn.sftp.close(state.handle, () => {})
 global.__chunkUploads.delete(chunkKey)
 const rmCmd = `rm -f ${escapeShellArg(state.tmpPath)}`
 sudoExec(conn, rmCmd, () => {})
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', `写入分块失败: ${writeErr.message}`)
 }
 state.writeOffset += buf.length
 sendJson(ws, {
 type: 'sftp-result',
 connectionId,
 requestId,
 operation: 'chunk_append',
 success: true,
 bytesWritten: buf.length,
 totalWritten: state.writeOffset,
 })
 })
 break
 }

 case 'chunk_finish': {
 const { chunkId, targetPath } = payload
 const tmpPath = `/tmp/.smartbox_chunk_${chunkId}`
 const chunkKey = `${connectionId}:${tmpPath}`

 global.__chunkUploads = global.__chunkUploads || new Map()
 const state = global.__chunkUploads.get(chunkKey)
 if (!state) {
 return sendError(ws, connectionId, requestId, 'CHUNK_NOT_FOUND', '分块上传会话不存在')
 }

 const { handle } = state

 // 关闭 handle
 conn.sftp.close(handle, (closeErr) => {
 global.__chunkUploads.delete(chunkKey)
 if (closeErr) {
 const rmCmd = `rm -f ${escapeShellArg(tmpPath)}`
 sudoExec(conn, rmCmd, () => {})
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', `关闭临时文件失败: ${closeErr.message}`)
 }

 const finalPath = targetPath || state.targetPath
 // 确保父目录存在
 const parentDir = finalPath.includes('/') ? finalPath.substring(0, finalPath.lastIndexOf('/')) : '.'
 const mkdirCmd = `sudo mkdir -p ${escapeShellArg(parentDir)}`
 sudoExec(conn, mkdirCmd, () => {
 // sudo mv 到目标位置
 const mvCmd = `sudo mv ${escapeShellArg(tmpPath)} ${escapeShellArg(finalPath)} && sudo chmod 644 ${escapeShellArg(finalPath)}`
 sudoExec(conn, mvCmd, (mvErr) => {
 if (mvErr) {
 return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `移动文件失败: ${mvErr.message}`)
 }
 sendJson(ws, {
 type: 'sftp-result',
 connectionId,
 requestId,
 operation: 'chunk_finish',
 success: true,
 path: finalPath,
 })
 })
 })
 })
 break
 }

 case 'mkdir': {
 const { path: dirPath } = payload
 const absPath = dirPath.startsWith('/') ? dirPath : '/' + dirPath

 if (conn.sftp) {
 conn.sftp.mkdir(absPath, { mode: 0o755 }, (err) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'mkdir', success: true })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 console.log(`[SFTP] mkdir permission denied, falling back to sudo: ${absPath}`)
 mkdirWithSudo(ws, conn, connectionId, requestId, absPath)
 })
 } else {
 mkdirWithSudo(ws, conn, connectionId, requestId, absPath)
 }
 break
 }

 case 'rmdir': {
 const { path: dirPath } = payload
 if (conn.sftp) {
 conn.sftp.rmdir(dirPath, (err) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'rmdir', success: true })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 console.log(`[SFTP] rmdir permission denied, falling back to sudo: ${dirPath}`)
 rmdirWithSudo(ws, conn, connectionId, requestId, dirPath)
 })
 } else {
 rmdirWithSudo(ws, conn, connectionId, requestId, dirPath)
 }
 break
 }

 case 'unlink': {
 const { path: filePath } = payload
 if (conn.sftp) {
 conn.sftp.unlink(filePath, (err) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'unlink', success: true })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 console.log(`[SFTP] unlink permission denied, falling back to sudo: ${filePath}`)
 unlinkWithSudo(ws, conn, connectionId, requestId, filePath)
 })
 } else {
 unlinkWithSudo(ws, conn, connectionId, requestId, filePath)
 }
 break
 }

 case 'rename': {
 const { fromPath, toPath } = payload
 if (conn.sftp) {
 conn.sftp.rename(fromPath, toPath, (err) => {
 if (!err) {
 return sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'rename', success: true })
 }
 if (!isPermissionError(err)) {
 return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
 }
 console.log(`[SFTP] rename permission denied, falling back to sudo: ${fromPath} -> ${toPath}`)
 renameWithSudo(ws, conn, connectionId, requestId, fromPath, toPath)
 })
 } else {
 renameWithSudo(ws, conn, connectionId, requestId, fromPath, toPath)
 }
 break
 }

 default:
 sendError(ws, connectionId, requestId, 'UNKNOWN_OPERATION', `未知 SFTP 操作: ${operation}`)
 }
}

// ========== sudo 降级实现 ==========

function writeFileWithSudo(ws, conn, connectionId, requestId, filePath, buf) {
 // 先创建父目录
 const parentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.'
 const mkdirCmd = `sudo mkdir -p ${escapeShellArg(parentDir)}`

 sudoExec(conn, mkdirCmd, () => {
 // 用 printf + 十六进制转义写入，避免管道/引号/特殊字符问题
 // 方法：将 base64 写到一个临时文件，然后 sudo mv 到目标位置
 // 但更简单：直接 sudo sh -c "printf '%s' > file" 也不行
 // 最稳健：sftp 先传到 /tmp，然后 sudo mv
 if (conn.sftp) {
 // 用 SFTP 写到临时文件，再 sudo mv
 const tmpPath = `/tmp/.smartbox_write_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
 conn.sftp.writeFile(tmpPath, buf, (sftpErr) => {
 if (sftpErr) {
 // SFTP 连 /tmp 都写不了？最后手段：sudo sh -c ... 但用 base64
 const b64 = buf.toString('base64')
 const fallbackCmd = `echo '${b64}' | base64 -d | sudo tee ${escapeShellArg(filePath)} > /dev/null 2>&1`
 return sudoExec(conn, fallbackCmd, (e) => {
 if (e) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `写入失败: ${e.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'writefile', success: true })
 })
 }
 // sudo mv 到目标位置
 const mvCmd = `sudo mv ${escapeShellArg(tmpPath)} ${escapeShellArg(filePath)} && sudo chmod 644 ${escapeShellArg(filePath)}`
 sudoExec(conn, mvCmd, (mvErr) => {
 if (mvErr) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `移动失败: ${mvErr.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'writefile', success: true })
 })
 })
 } else {
 // 没有 SFTP，用 base64 管道法
 const b64 = buf.toString('base64')
 const cmd = `echo '${b64}' | base64 -d | sudo tee ${escapeShellArg(filePath)} > /dev/null`
 sudoExec(conn, cmd, (e) => {
 if (e) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `写入失败: ${e.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'writefile', success: true })
 })
 }
 })
}

function readFileWithSudo(ws, conn, connectionId, requestId, filePath) {
 // 用 sudo cat 读取，然后 base64 编码转成一行返回
 // 先判断文件大小，太大了就报错
 const statCmd = `sudo stat -c%s ${escapeShellArg(filePath)} 2>/dev/null || sudo wc -c < ${escapeShellArg(filePath)} 2>/dev/null`
 sudoExec(conn, statCmd, (statErr, statOut) => {
 if (statErr) {
 return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `读取失败: ${statErr.message}`)
 }
 const size = parseInt((statOut || '0').trim(), 10)
 if (size > 10485760) { // 10MB
 return sendError(ws, connectionId, requestId, 'FILE_TOO_LARGE', `文件过大 (${(size / 1024 / 1024).toFixed(1)}MB)，不支持在线查看`)
 }
 // 用 base64 编码输出（兼容所有系统，busybox 也有 base64）
 const readCmd = `sudo base64 ${escapeShellArg(filePath)} 2>/dev/null || (sudo cat ${escapeShellArg(filePath)} | base64) 2>/dev/null`
 sudoExec(conn, readCmd, (readErr, readOut) => {
 if (readErr) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `读取失败: ${readErr.message}`)
 const b64 = readOut.replace(/\s+/g, '') // 去掉换行/空格
 if (b64) {
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'readfile', data: b64 })
 } else {
 // base64 不可用，用 cat 直接输出（仅文本）
 const fallbackCmd = `sudo cat ${escapeShellArg(filePath)} 2>/dev/null`
 sudoExec(conn, fallbackCmd, (catErr, catOut) => {
 if (catErr) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `读取失败: ${catErr.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'readfile', data: Buffer.from(catOut || '', 'utf-8').toString('base64') })
 })
 }
 })
 })
}

function mkdirWithSudo(ws, conn, connectionId, requestId, absPath) {
 const cmd = `sudo mkdir -p ${escapeShellArg(absPath)} && sudo chmod 755 ${escapeShellArg(absPath)}`
 sudoExec(conn, cmd, (err) => {
 if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `创建目录失败: ${err.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'mkdir', success: true })
 })
}

function rmdirWithSudo(ws, conn, connectionId, requestId, dirPath) {
 const cmd = `sudo rm -rf ${escapeShellArg(dirPath)}`
 sudoExec(conn, cmd, (err) => {
 if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `删除目录失败: ${err.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'rmdir', success: true })
 })
}

function unlinkWithSudo(ws, conn, connectionId, requestId, filePath) {
 const cmd = `sudo rm -f ${escapeShellArg(filePath)}`
 sudoExec(conn, cmd, (err) => {
 if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `删除文件失败: ${err.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'unlink', success: true })
 })
}

function renameWithSudo(ws, conn, connectionId, requestId, fromPath, toPath) {
 const cmd = `sudo mv ${escapeShellArg(fromPath)} ${escapeShellArg(toPath)}`
 sudoExec(conn, cmd, (err) => {
 if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `重命名失败: ${err.message}`)
 sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'rename', success: true })
 })
}

/**
 * 安全的 shell 转义（只允许字母数字/./-_ 通过，其余加引号）
 */
function escapeShellArg(arg) {
 if (!arg) return "''"
 // 只包含安全字符则直接返回
 if (/^[a-zA-Z0-9./_\-@:,=+~]+$/.test(arg)) return arg
 // 否则用单引号包裹（并处理单引号本身）
 return "'" + arg.replace(/'/g, "'\\''") + "'"
}

// ========== 连接清理 ==========

function cleanupConnection(connectionId) {
 const conn = connections.get(connectionId)
 if (!conn) return

 console.log(`[Bridge] Cleaning up connection: ${connectionId}`)

 // 关闭所有 shell streams
 if (conn.shells) {
 for (const [sid, stream] of conn.shells) {
 try { stream.close() } catch (_) { /* ignore */ }
 }
 conn.shells.clear()
 }

 if (conn.sftp) {
 // 清理此连接的分块上传
 global.__chunkUploads = global.__chunkUploads || new Map()
 for (const [key, state] of global.__chunkUploads) {
 if (key.startsWith(`${connectionId}:`)) {
 try { conn.sftp.close(state.handle) } catch (_) { /* ignore */ }
 // 删除远程临时文件（如果存在）
 const rmCmd = `rm -f ${escapeShellArg(state.tmpPath)}`
 sudoExec(conn, rmCmd, () => {})
 global.__chunkUploads.delete(key)
 }
 }
 try { conn.sftp.end() } catch (_) { /* ignore */ }
 }
 if (conn.ssh) {
 try { conn.ssh.end() } catch (_) { /* ignore */ }
 }

 connections.delete(connectionId)
}

// ========== 实时日志跟踪 (tail -f) ==========

/** 存储活跃的 tail stream：connectionId:logPath → { shellStream, logPath } */
const activeLogtails = new Map()

async function handleLogtailStart(ws, connectionId, requestId, payload) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return sendError(ws, connectionId, requestId, 'NOT_CONNECTED', 'SSH 未连接')
 }

 const { logPath, lines } = payload
 if (!logPath) {
 return sendError(ws, connectionId, requestId, 'INVALID_PATH', '缺少日志路径')
 }

 const tailKey = `${connectionId}:${logPath}`

 // 如果已有同名 tail，先停止
 if (activeLogtails.has(tailKey)) {
 try { activeLogtails.get(tailKey).close() } catch (_) {}
 activeLogtails.delete(tailKey)
 }

 const n = typeof lines === 'number' ? Math.min(Math.max(lines, 10), 5000) : 200

 const startTail = (cmd, retried = false) => {
 conn.ssh.exec(cmd, (err, stream) => {
 if (err) {
 return sendError(ws, connectionId, requestId, 'TAIL_FAILED', `无法跟踪日志: ${err.message}`)
 }

 activeLogtails.set(tailKey, stream)

 // 确认启动
 sendJson(ws, {
 type: 'logtail_started',
 connectionId,
 requestId,
 logPath,
 })

 let buffer = ''
 let permDenied = false

 stream.on('data', (data) => {
 buffer += data.toString()
 // 按行分割发送，避免单条消息过大
 const lines = buffer.split('\n')
 buffer = lines.pop() || '' // 保留不完整的最后一行

 if (lines.length > 0 && ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'logtail_data',
 connectionId,
 logPath,
 lines,
 }))
 }
 })

 stream.stderr.on('data', (data) => {
 const msg = data.toString()
 // 权限不足 → 自动用 sudo 重试
 if (!retried && /permission denied/i.test(msg)) {
 permDenied = true
 try { stream.close() } catch (_) {}
 return startTail(`sudo tail -n ${n} -f ${escapeShellArg(logPath)} 2>&1`, true)
 }
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'logtail_data',
 connectionId,
 logPath,
 lines: [msg],
 isStderr: true,
 }))
 }
 })

 stream.on('close', () => {
 activeLogtails.delete(tailKey)
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'logtail_stopped',
 connectionId,
 logPath,
 }))
 }
 })

 stream.on('error', (err) => {
 activeLogtails.delete(tailKey)
 sendError(ws, connectionId, null, 'TAIL_ERROR', `日志跟踪出错: ${err.message}`)
 })
 })
 startTail(`tail -n ${n} -f ${escapeShellArg(logPath)} 2>&1`)
}

}

function handleLogtailStop(ws, connectionId, requestId, payload) {
 const { logPath } = payload
 if (!logPath) return

 const tailKey = `${connectionId}:${logPath}`
 const stream = activeLogtails.get(tailKey)
 if (stream) {
 try { stream.close() } catch (_) {}
 activeLogtails.delete(tailKey)
 }

 sendJson(ws, {
 type: 'logtail_stopped',
 connectionId,
 requestId,
 logPath,
 })
}

// ========== Docker 容器终端 (docker exec -it) ==========

/** 活跃的 docker shell session: dockerShell:containerId → { stream, shellId } */
const activeDockerShells = new Map()

function handleDockerShell(ws, connectionId, requestId, payload) {
 const conn = connections.get(connectionId)
 if (!conn || !conn.ssh) {
 return sendError(ws, connectionId, requestId, 'NOT_CONNECTED', 'SSH 未连接')
 }

 const { containerId, shell: shellName } = payload
 if (!containerId || typeof containerId !== 'string') {
 return sendError(ws, connectionId, requestId, 'INVALID_CONTAINER', '缺少容器 ID')
 }

 // 容器 ID 注入防护：只允许字母数字和连字符
 if (!/^[a-zA-Z0-9_-]{1,64}$/.test(containerId)) {
 auditLog('docker_injection_blocked', { containerId })
 return sendError(ws, connectionId, requestId, 'INVALID_CONTAINER', '非法容器 ID')
 }

 // Shell 名称验证
 const shell = shellName || '/bin/bash'
 if (!/^\/[a-zA-Z0-9/._-]+$/.test(shell)) {
 return sendError(ws, connectionId, requestId, 'INVALID_SHELL', '非法 Shell 路径')
 }

 // 先关闭已有 session
 const existingKey = `docker:${containerId}`
 if (activeDockerShells.has(existingKey)) {
 try { activeDockerShells.get(existingKey).close() } catch (_) {}
 activeDockerShells.delete(existingKey)
 }

 conn.ssh.exec(`docker exec -it ${escapeShellArg(containerId)} ${escapeShellArg(shell)}`, {
 pty: { rows: 40, cols: 120, term: 'xterm-256color' },
 }, (err, stream) => {
 if (err) {
 return sendError(ws, connectionId, requestId, 'DOCKER_EXEC_FAIL', `无法进入容器: ${err.message}`)
 }

 activeDockerShells.set(existingKey, stream)

 sendJson(ws, {
 type: 'docker_shell_ready',
 connectionId,
 requestId,
 containerId,
 shell,
 })

 // 输出流 → WebSocket
 stream.on('data', (data) => {
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'docker_shell_output',
 connectionId,
 containerId,
 data: Buffer.from(data).toString('base64'),
 }))
 }
 })

 stream.stderr.on('data', (data) => {
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'docker_shell_output',
 connectionId,
 containerId,
 data: Buffer.from(data).toString('base64'),
 isStderr: true,
 }))
 }
 })

 stream.on('close', (code) => {
 activeDockerShells.delete(existingKey)
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify({
 type: 'docker_shell_closed',
 connectionId,
 containerId,
 exitCode: code,
 }))
 }
 })

 stream.on('error', (err) => {
 activeDockerShells.delete(existingKey)
 sendError(ws, connectionId, null, 'DOCKER_SHELL_ERR', `容器终端错误: ${err.message}`)
 })
 })
}

function handleDockerShellData(ws, connectionId, requestId, payload) {
 const { containerId, data } = payload
 if (!containerId || !data) return

 const existingKey = `docker:${containerId}`
 const stream = activeDockerShells.get(existingKey)
 if (!stream) {
 return sendError(ws, connectionId, requestId, 'NO_ACTIVE_SHELL', '容器终端未激活')
 }

 try {
 const decoded = Buffer.from(data, 'base64').toString()
 stream.write(decoded)
 } catch (err) {
 sendError(ws, connectionId, requestId, 'WRITE_ERROR', `写入失败: ${err.message}`)
 }
}

function handleDockerShellResize(ws, connectionId, requestId, payload) {
 const { containerId, cols, rows } = payload
 if (!containerId || !cols || !rows) return

 const existingKey = `docker:${containerId}`
 const stream = activeDockerShells.get(existingKey)
 if (stream && stream.setWindow) {
 stream.setWindow(rows, cols, 0, 0)
 }
}

// ========== 错误响应辅助 ==========

function sendError(ws, connectionId, requestId, code, message) {
 if (ws.readyState === ws.OPEN) {
 const payload = {
 type: 'error',
 connectionId,
 code,
 message,
 }
 if (requestId) payload.requestId = requestId
 ws.send(JSON.stringify(payload))
 }
}

/**
 * 发送带 requestId 的 JSON 响应（用于 request-ack 模式）
 */
function sendJson(ws, data) {
 if (ws.readyState === ws.OPEN) {
 ws.send(JSON.stringify(data))
 }
}

// ========== 静态文件服务 ==========

if (fs.existsSync(frontendDist)) {
 // 强制禁止所有静态资源缓存，确保每次拉取新镜像后浏览器加载最新代码
 app.use((req, res, next) => {
   res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
   res.setHeader('Pragma', 'no-cache')
   res.setHeader('Expires', '0')
   res.setHeader('Surrogate-Control', 'no-store')
   next()
 })
 app.use(express.static(frontendDist))

 // SPA 支持：所有非 API 路由返回 index.html
 app.use((req, res) => {
 if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
 return res.status(404).json({ error: 'Not Found' })
 }
 const filePath = path.join(frontendDist, 'index.html')
 if (fs.existsSync(filePath)) {
 // 注入 Service Worker 注销脚本，避免旧 SW 缓存污染
 let html = fs.readFileSync(filePath, 'utf-8')
 const swScript = '<script>if("serviceWorker"in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(s){s.unregister()})})}</script>'
 html = html.replace('</head>', swScript + '</head>')
 // 强制 index.html 不缓存，确保浏览器始终加载最新页面
 res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
 res.setHeader('Pragma', 'no-cache')
 res.setHeader('Expires', '0')
 res.type('html').send(html)
 } else {
 res.status(404).json({ error: 'Not Found' })
 }
 })
}

// ─── 开发模式插件热加载：监听 plugins 目录变化 ───

const isDev = process.env.NODE_ENV !== 'production'

if (isDev && fs.existsSync(pluginsDir)) {
 let watchTimer = null

 fs.watch(pluginsDir, { recursive: true }, (eventType, filename) => {
 // 防抖：500ms 内多次变更只通知一次
 if (watchTimer) clearTimeout(watchTimer)
 watchTimer = setTimeout(() => {
 // 通知所有已连接的 WebSocket 客户端
 let clientCount = 0
 try {
 const wss = app.getWss()
 if (wss) {
 const msg = JSON.stringify({ type: 'plugins-changed' })
 for (const client of wss.clients) {
 if (client.readyState === 1) { // WebSocket.OPEN
 client.send(msg)
 clientCount++
 }
 }
 }
 } catch (_) { /* ignore */ }
 console.log(`[Bridge] Plugins changed, notified ${clientCount} clients`)
 }, 500)
 })

 console.log(`[Bridge] Plugin hot-reload watching: ${pluginsDir}`)
}

// ========== 启动服务器 ==========

httpServer.listen(PORT, '0.0.0.0', () => {
 console.log(`[SmartBox Bridge] Server listening on 0.0.0.0:${PORT}`)
 console.log(` API: http://0.0.0.0:${PORT}/api/health`)
 console.log(` WS: ws://0.0.0.0:${PORT}/ws`)
})
