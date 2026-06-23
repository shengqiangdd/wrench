/**
 * SmartBox SSH Bridge
 * 
 * 轻量级 WebSocket → SSH 代理服务
 * 浏览器无法直接连接 SSH 协议，此服务作为桥梁，
 * 将 WebSocket 消息转发到 SSH/SFTP 连接。
 * 
 * 消息协议（JSON）：
 * - { type: 'connect', connectionId, host, port, username, password?, privateKey? }
 * - { type: 'disconnect', connectionId }
 * - { type: 'exec', connectionId, data }           // 终端数据
 * - { type: 'resize', connectionId, cols, rows }   // 终端大小调整
 * - { type: 'sftp', connectionId, operation, ... } // SFTP 操作
 */

import { WebSocketServer } from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10)
const connections = new Map() // connectionId → { ws, ssh?, sftp? }

// ─── HTTP API 服务器 ───

const pluginsDir = path.resolve(__dirname, '..', 'plugins')
const frontendDist = path.resolve(__dirname, '..', 'frontend', 'dist')

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname

  // API: /api/plugins — 扫描 plugins 目录返回清单
  if (pathname === '/api/plugins' && req.method === 'GET') {
    return handleGetPlugins(req, res)
  }

  // API: /api/plugins/:id/plugin.js — 返回指定插件的 JS 文件
  const pluginJsMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/plugin\.js$/)
  if (pluginJsMatch && req.method === 'GET') {
    return handleGetPluginJs(req, res, pluginJsMatch[1])
  }

  // API: /api/plugins/:id/manifest.json — 返回指定插件的清单
  const manifestMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/manifest\.json$/)
  if (manifestMatch && req.method === 'GET') {
    return handleGetPluginManifest(req, res, manifestMatch[1])
  }

  // 健康检查
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
    return
  }

  // 静态文件服务（前端构建产物）
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname)
  }

  res.writeHead(404)
  res.end('Not Found')
})

// 插件 API 处理
function handleGetPlugins(req, res) {
  try {
    const plugins = []
    if (fs.existsSync(pluginsDir)) {
      const entries = fs.readdirSync(pluginsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json')
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
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ plugins }))
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: err.message }))
  }
}

function handleGetPluginJs(req, res, pluginId) {
  const pluginDir = path.join(pluginsDir, pluginId)
  const jsPath = path.join(pluginDir, 'plugin.js')
  if (fs.existsSync(jsPath)) {
    let content = fs.readFileSync(jsPath, 'utf-8')
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache',
    })
    res.end(content)
  } else {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Plugin JS not found' }))
  }
}

function handleGetPluginManifest(req, res, pluginId) {
  const manifestPath = path.join(pluginsDir, pluginId, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(manifest))
  } else {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Manifest not found' }))
  }
}

function serveStatic(req, res, pathname) {
  // 安全：防止路径穿越
  const safePath = pathname.replace(/\.\.\//g, '').replace(/\.\./g, '')
  let filePath = path.join(frontendDist, safePath === '/' ? 'index.html' : safePath)

  if (!fs.existsSync(filePath)) {
    filePath = path.join(frontendDist, 'index.html')
  }

  const extMap = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  const ext = path.extname(filePath)
  const contentType = extMap[ext] || 'application/octet-stream'

  try {
    const content = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch {
    res.writeHead(404)
    res.end('Not Found')
  }
}

// ─── WebSocket 服务器（noServer 模式，手动绑定到 HTTP） ───

const wss = new WebSocketServer({ noServer: true })

// 手动处理 WebSocket 升级请求
server.on('upgrade', (request, socket, head) => {
  // 只处理 /ws 路径的 WebSocket 请求
  const url = new URL(request.url, `http://${request.headers.host}`)
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

console.log(`[SmartBox Bridge] Server listening on port ${PORT}`)

wss.on('connection', (ws, req) => {
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  console.log(`[Bridge] Client connected: ${clientId} (${req.socket.remoteAddress})`)

  // 心跳检测
  let heartbeatTimer = null

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping()
      }
    }, 30000)
  }

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  startHeartbeat()

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

/**
 * 消息路由
 */
function handleMessage(ws, clientId, msg) {
  const { type, connectionId, ...payload } = msg

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break

    case 'connect':
      handleConnect(ws, connectionId, payload)
      break

    case 'disconnect':
      handleDisconnect(connectionId)
      break

    case 'exec':
      handleExec(connectionId, payload.data)
      break

    case 'resize':
      handleResize(connectionId, payload.cols, payload.rows)
      break

    case 'sftp':
      handleSftp(connectionId, payload)
      break

    default:
      sendError(ws, connectionId, 'UNKNOWN_TYPE', `未知消息类型: ${type}`)
  }
}

/**
 * SSH 连接处理
 */
async function handleConnect(ws, connectionId, config) {
  const { host, port, username, password, privateKey } = config

  if (!host || !username) {
    return sendError(ws, connectionId, 'INVALID_CONFIG', '缺少必需参数: host, username')
  }

  try {
    // 动态导入 ssh2
    const { Client } = await import('ssh2')

    const ssh = new Client()
    const connState = { ws, ssh, sftp: null, connectionId }

    ssh.on('ready', () => {
      console.log(`[SSH] Connected: ${username}@${host}:${port} (${connectionId})`)
      connections.set(connectionId, connState)

      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
      }))

      // 启动 SFTP
      ssh.sftp((err, sftp) => {
        if (!err) {
          connState.sftp = sftp
          ws.send(JSON.stringify({
            type: 'sftp-ready',
            connectionId,
          }))
        }
      })
    })

    ssh.on('data', (data) => {
      // 终端输出数据转发到前端
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'data',
          connectionId,
          data: data.toString('base64'),
        }))
      }
    })

    ssh.on('close', () => {
      console.log(`[SSH] Connection closed: ${connectionId}`)
      connections.delete(connectionId)
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'disconnected',
          connectionId,
        }))
      }
    })

    ssh.on('error', (err) => {
      console.error(`[SSH] Connection error (${connectionId}):`, err.message)
      connections.delete(connectionId)
      sendError(ws, connectionId, 'SSH_ERROR', err.message)
    })

    const sshConfig = {
      host,
      port: port || 22,
      username,
      readyTimeout: 10000,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
    }

    if (password) {
      sshConfig.password = password
    } else if (privateKey) {
      sshConfig.privateKey = privateKey
    }

    ssh.connect(sshConfig)
  } catch (err) {
    sendError(ws, connectionId, 'SSH_INIT_ERROR', 'SSH 初始化失败: ' + err.message)
  }
}

function handleDisconnect(connectionId) {
  cleanupConnection(connectionId)
}

function handleExec(connectionId, data) {
  const conn = connections.get(connectionId)
  if (!conn || !conn.ssh) return

  // 将 base64 解码后的数据写入 SSH 终端
  const buf = Buffer.from(data, 'base64')
  conn.ssh.write(buf.toString('utf-8'))
}

function handleResize(connectionId, cols, rows) {
  const conn = connections.get(connectionId)
  if (!conn || !conn.ssh) return

  // pty 大小调整（通过 window-change 信号）
  try {
    conn.ssh.setWindow(rows || 24, cols || 80, 0, 0)
  } catch (err) {
    console.error(`[SSH] Resize error (${connectionId}):`, err.message)
  }
}

/**
 * SFTP 操作处理
 */
async function handleSftp(connectionId, payload) {
  const conn = connections.get(connectionId)
  if (!conn || !conn.sftp) {
    return sendError(null, connectionId, 'SFTP_NOT_READY', 'SFTP 未就绪')
  }

  const { operation, path, ...params } = payload
  const sftp = conn.sftp
  const ws = conn.ws

  try {
    switch (operation) {
      case 'list': {
        const files = await readDir(sftp, path)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, files }))
        break
      }
      case 'read': {
        const content = await readFile(sftp, path)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, content: content.toString('base64') }))
        break
      }
      case 'write': {
        const { content } = params
        await writeFile(sftp, path, Buffer.from(content, 'base64'))
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, success: true }))
        break
      }
      case 'rename': {
        const { newPath } = params
        await renameFile(sftp, path, newPath)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, success: true }))
        break
      }
      case 'delete': {
        await deleteFile(sftp, path)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, success: true }))
        break
      }
      case 'mkdir': {
        await makeDir(sftp, path)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, success: true }))
        break
      }
      case 'chmod': {
        const { mode } = params
        await chmodFile(sftp, path, mode)
        ws.send(JSON.stringify({ type: 'sftp-result', connectionId, operation, path, success: true }))
        break
      }
      default:
        sendError(ws, connectionId, 'UNKNOWN_SFTP_OP', `未知 SFTP 操作: ${operation}`)
    }
  } catch (err) {
    sendError(ws, connectionId, 'SFTP_ERROR', `${operation} 失败: ${err.message}`)
  }
}

// SFTP 辅助函数（Promise 封装）
function readDir(sftp, dir) {
  return new Promise((resolve, reject) => {
    sftp.readdir(dir, (err, list) => {
      if (err) return reject(err)
      resolve(list.map((f) => ({
        name: f.filename,
        path: (dir === '/' ? '' : dir) + '/' + f.filename,
        type: f.attrs.isDirectory() ? 'directory' : 'file',
        size: f.attrs.size,
        modifyTime: f.attrs.mtime * 1000,
        permissions: f.attrs.mode.toString(8).slice(-3),
        owner: f.attrs.uid?.toString() || '',
        group: f.attrs.gid?.toString() || '',
      })))
    })
  })
}

function readFile(sftp, filePath) {
  return new Promise((resolve, reject) => {
    sftp.readFile(filePath, (err, data) => {
      if (err) return reject(err)
      resolve(data)
    })
  })
}

function writeFile(sftp, filePath, data) {
  return new Promise((resolve, reject) => {
    sftp.writeFile(filePath, data, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function renameFile(sftp, oldPath, newPath) {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function deleteFile(sftp, filePath) {
  return new Promise((resolve, reject) => {
    sftp.unlink(filePath, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function makeDir(sftp, dirPath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dirPath, { mode: 0o755 }, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

function chmodFile(sftp, filePath, mode) {
  return new Promise((resolve, reject) => {
    sftp.chmod(filePath, parseInt(mode, 8), (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/**
 * 清理连接
 */
function cleanupConnection(connectionId) {
  const conn = connections.get(connectionId)
  if (!conn) return

  console.log(`[Bridge] Cleaning up connection: ${connectionId}`)

  if (conn.sftp) {
    try { conn.sftp.end() } catch (_) { /* ignore */ }
  }
  if (conn.ssh) {
    try { conn.ssh.end() } catch (_) { /* ignore */ }
  }

  connections.delete(connectionId)
}

/**
 * 错误响应辅助
 */
function sendError(ws, connectionId, code, message) {
  const target = ws || wss.clients.values().next().value
  if (target && target.readyState === target.OPEN) {
    target.send(JSON.stringify({
      type: 'error',
      connectionId,
      code,
      message,
    }))
  }
}

// 优雅关闭
process.on('SIGTERM', () => {
  console.log('[Bridge] Shutting down...')
  for (const [connId] of connections) {
    cleanupConnection(connId)
  }
  wss.close()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Bridge] Shutting down (SIGINT)...')
  for (const [connId] of connections) {
    cleanupConnection(connId)
  }
  wss.close()
  process.exit(0)
})

console.log(`[SmartBox Bridge] Ready for connections on ws://0.0.0.0:${PORT}`)
