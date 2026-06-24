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
 * - { type: 'exec', connectionId, data }           // 终端数据（shell 模式）
 * - { type: 'resize', connectionId, cols, rows }   // 终端大小调整
 * - { type: 'sftp', connectionId, operation, ... } // SFTP 操作
 */

import express from 'express'
import expressWs from 'express-ws'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'ssh2'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10)

const pluginsDir = path.resolve(__dirname, '..', 'plugins')
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist')

// 连接管理器: connectionId → { ws, ssh, sftp, shellStream?, sessions? }
const connections = new Map()

// ─── Express 应用 ───

const app = express()
expressWs(app)

// 中间件
app.use(cors())
app.use(express.json({ limit: '100mb' }))

// ========== HTTP API 路由 ==========

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
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
  const pluginDir = path.join(pluginsDir, req.params.id)
  const jsPath = path.join(pluginDir, 'plugin.js')
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

  conn.ssh.exec(command, (err, stream) => {
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

// ─── 插件市场 API ───

// 默认插件市场源
const MARKET_INDEX_URL = process.env.MARKET_INDEX_URL || 'https://raw.githubusercontent.com/shengqiangdd/smartbox-plugins/main/index.json'

// 获取市场插件列表
app.get('/api/market/index', async (req, res) => {
  try {
    const response = await fetch(MARKET_INDEX_URL, {
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      return res.status(502).json({ error: `Market fetch failed: HTTP ${response.status}` })
    }
    const data = await response.json()
    res.json(data)
  } catch (err: any) {
    res.status(502).json({ error: `Failed to fetch market index: ${err.message}` })
  }
})

// 安装插件（从市场下载 manifest + plugin.js 到 plugins/ 目录）
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

    // 下载 manifest.json
    const manResp = await fetch(manifestUrl, { signal: AbortSignal.timeout(15000) })
    if (!manResp.ok) throw new Error(`Failed to download manifest: HTTP ${manResp.status}`)
    const manifestText = await manResp.text()

    // 验证 manifest 格式
    try {
      const manifest = JSON.parse(manifestText)
      if (!manifest.id || !manifest.name) {
        throw new Error('Invalid manifest: missing id or name')
      }
    } catch (parseErr: any) {
      fs.rmSync(targetDir, { recursive: true, force: true })
      return res.status(400).json({ error: `Invalid manifest format: ${parseErr.message}` })
    }

    fs.writeFileSync(path.join(targetDir, 'manifest.json'), manifestText, 'utf-8')

    // 下载 plugin.js
    const jsResp = await fetch(pluginUrl, { signal: AbortSignal.timeout(30000) })
    if (!jsResp.ok) throw new Error(`Failed to download plugin JS: HTTP ${jsResp.status}`)
    const jsText = await jsResp.text()

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
  } catch (err: any) {
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
  } catch (err: any) {
    res.status(500).json({ error: `Uninstall failed: ${err.message}` })
  }
})

// 获取单个插件的 Manifest
app.get('/api/plugins/:id/manifest.json', (req, res) => {
  const manifestPath = path.join(pluginsDir, req.params.id, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    res.json(manifest)
  } else {
    res.status(404).json({ error: 'Manifest not found' })
  }
})

// ========== WebSocket 路由 ==========

app.ws('/ws', (ws, req) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  console.log(`[Bridge] Client connected: ${clientId} (${req.socket.remoteAddress})`)

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
      const msg = JSON.parse(raw.toString())
      handleMessage(ws, clientId, msg)
    } catch (err) {
      sendError(ws, null, 'INVALID_MESSAGE', '无法解析消息: ' + err.message)
    }
  })

  ws.on('close', () => {
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

    default:
      sendError(ws, connectionId, requestId, 'UNKNOWN_TYPE', `未知消息类型: ${type}`)
  }
}

// ========== SSH 连接处理 ==========

async function handleConnect(ws, connectionId, requestId, config) {
  const { host, port, username, password, privateKey } = config

  if (!host || !username) {
    return sendError(ws, connectionId, requestId, 'INVALID_CONFIG', '缺少必需参数: host, username')
  }

  try {
    const ssh = new Client()
    const connState = {
      ws,
      ssh,
      sftp: null,
      connectionId,
      shellStream: null,
      shells: new Map(),
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

  if (!host || !username) {
    return sendJson(ws, {
      type: 'test-result',
      connectionId,
      requestId,
      success: false,
      message: '缺少必需参数: host, username',
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

  ssh.sftp((err, sftp) => {
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
          const entries = []  // { name: string, isDir: boolean }
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
  app.use(express.static(frontendDist))

  // SPA 支持：所有非 API 路由返回 index.html
  app.use((req, res) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return res.status(404).json({ error: 'Not Found' })
    }
    const filePath = path.join(frontendDist, 'index.html')
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath)
    } else {
      res.status(404).json({ error: 'Not Found' })
    }
  })
}

// ─── 开发模式插件热加载：监听 plugins 目录变化 ───

const isDev = process.env.NODE_ENV !== 'production'

if (isDev && fs.existsSync(pluginsDir)) {
  let watchTimer: ReturnType<typeof setTimeout> | null = null

  fs.watch(pluginsDir, { recursive: true }, (eventType, filename) => {
    // 防抖：500ms 内多次变更只通知一次
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = setTimeout(() => {
      // 通知所有已连接的 WebSocket 客户端
      try {
        const wss = app.getWss()
        if (wss) {
          const msg = JSON.stringify({ type: 'plugins-changed' })
          for (const client of wss.clients) {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send(msg)
            }
          }
        }
      } catch (_) { /* ignore */ }
      console.log(`[Bridge] Plugins changed, notified ${wss?.clients?.size || 0} clients`)
    }, 500)
  })

  console.log(`[Bridge] Plugin hot-reload watching: ${pluginsDir}`)
}

// ========== 启动服务器 ==========

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SmartBox Bridge] Server listening on 0.0.0.0:${PORT}`)
  console.log(`   API:  http://0.0.0.0:${PORT}/api/health`)
  console.log(`   WS:   ws://0.0.0.0:${PORT}/ws`)
})
