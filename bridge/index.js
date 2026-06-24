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
app.use(express.json({ limit: '5mb' }))

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
 */
function sudoExec(conn, command, callback) {
  conn.ssh.exec(command, { pty: false }, (err, stream) => {
    if (err) return callback(err)
    let stdout = ''
    let stderr = ''
    stream.on('data', (chunk) => { stdout += chunk.toString('utf-8') })
    stream.stderr.on('data', (chunk) => { stderr += chunk.toString('utf-8') })
    stream.on('close', (exitCode) => {
      if (exitCode !== 0) {
        callback(new Error(stderr.trim() || `sudo 命令退出码: ${exitCode}`))
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
      if (!conn.sftp) return sendError(ws, connectionId, requestId, 'SFTP_NOT_READY', 'SFTP 未就绪（列表需要 SFTP）')
      const { path: dirPath } = payload
      const readPath = dirPath === '/' ? '.' : dirPath.replace(/\/+$/, '')
      const prefix = dirPath === '/' ? '/' : (dirPath || '').replace(/\/+$/, '') + '/'
      conn.sftp.readdir(readPath, (err, list) => {
        if (err) return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
        sendJson(ws, {
          type: 'sftp-result',
          connectionId,
          requestId,
          operation: 'list',
          files: (list || []).map(item => ({
            name: item.filename,
            path: prefix + item.filename,
            type: (item.attrs.mode && (item.attrs.mode & 0o40000)) ? 'directory' : 'file',
            _longnameType: (item.longname && item.longname.startsWith('d')) ? 'directory' : undefined,
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000,
            permissions: item.attrs.mode ? (item.attrs.mode & 0o777).toString(8) : '755',
            owner: '',
            group: '',
          })),
        })
      })
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
      if (!conn.sftp) return sendError(ws, connectionId, requestId, 'SFTP_NOT_READY', 'SFTP 未就绪（读取需要 SFTP）')
      const { path: filePath } = payload
      conn.sftp.readFile(filePath, (err, data) => {
        if (err) return sendError(ws, connectionId, requestId, 'SFTP_ERROR', err.message)
        sendJson(ws, {
          type: 'sftp-result',
          connectionId,
          requestId,
          operation: 'readfile',
          data: data.toString('base64'),
        })
      })
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
  // 先创建父目录（如果不存在）
  const parentDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.'
  const createParentCmd = `sudo mkdir -p ${escapeShellArg(parentDir)}`

  sudoExec(conn, createParentCmd, (err) => {
    if (err) {
      // 父目录创建失败不是致命错误，继续尝试写文件
      console.log(`[sudo-writefile] mkdir -p warning: ${err.message}`)
    }

    // 用 base64 + base64 -d | sudo tee 写文件（避免特殊字符问题）
    const b64Content = buf.toString('base64')
    const cmd = `echo ${escapeShellArg(b64Content)} | base64 -d | sudo tee ${escapeShellArg(filePath)} > /dev/null`
    sudoExec(conn, cmd, (err2) => {
      if (err2) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `写入失败: ${err2.message}`)
      sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'writefile', success: true })
    })
  })
}

function mkdirWithSudo(ws, conn, connectionId, requestId, absPath) {
  const cmd = `sudo mkdir -p ${escapeShellArg(absPath)}`
  sudoExec(conn, cmd, (err) => {
    if (err) return sendError(ws, connectionId, requestId, 'SUDO_ERROR', `创建目录失败: ${err.message}`)
    // 设置目录权限为 0755
  const chmodCmd = `sudo chmod 755 ${escapeShellArg(absPath)}`
  sudoExec(conn, chmodCmd, () => {
    sendJson(ws, { type: 'sftp-result', connectionId, requestId, operation: 'mkdir', success: true })
  })
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

// ========== 启动服务器 ==========

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SmartBox Bridge] Server listening on 0.0.0.0:${PORT}`)
  console.log(`   API:  http://0.0.0.0:${PORT}/api/health`)
  console.log(`   WS:   ws://0.0.0.0:${PORT}/ws`)
})
