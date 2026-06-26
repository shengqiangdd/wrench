/**
 * Security module for SmartBox Bridge
 * 
 * Provides: input validation, injection detection, rate limiting,
 * security headers, request logging, CORS, audit logging, and WS token auth.
 */

import crypto from 'node:crypto'
import rateLimit from 'express-rate-limit'

// ─── 常量 ───

const HOST_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*$|^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-fA-F:]+\]?$/
const PATH_SAFE_RE = /^[a-zA-Z0-9_\-./~]+$/
const FILENAME_SAFE_RE = /^[a-zA-Z0-9_\-. ]+$/
const INJECTION_RE = /[;&|`$(){}!<>\\'"#\n\r]|\.\.\//
const MAX_INPUT_LENGTH = 256

// ─── 输入清理 ───

export function sanitizeString(input) {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, MAX_INPUT_LENGTH)
}

// ─── 校验函数 ───

export function isValidHost(host) {
  if (typeof host !== 'string' || host.length === 0 || host.length > 255) return false
  return HOST_RE.test(host)
}

export function isValidPort(port) {
  const p = Number(port)
  return Number.isInteger(p) && p >= 1 && p <= 65535
}

export function isValidUsername(username) {
  if (typeof username !== 'string' || username.length === 0 || username.length > 64) return false
  return /^[a-zA-Z0-9_\-.]+$/.test(username)
}

export function isValidPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 1024) return false
  return PATH_SAFE_RE.test(p)
}

export function isValidFilename(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false
  return FILENAME_SAFE_RE.test(name)
}

export function validateConnectionParams({ host, port, username, password, privateKey }) {
  const errors = []
  if (!host) errors.push('host is required')
  else if (!isValidHost(host)) errors.push('invalid host format')
  if (!port) errors.push('port is required')
  else if (!isValidPort(port)) errors.push('port must be 1-65535')
  if (!username) errors.push('username is required')
  else if (!isValidUsername(username)) errors.push('invalid username format')
  if (!password && !privateKey) errors.push('password or privateKey required')
  return { valid: errors.length === 0, errors }
}

// ─── 注入检测 ───

export function detectInjection(inputs) {
  const arr = Array.isArray(inputs) ? inputs : [inputs]
  return arr.some(s => typeof s === 'string' && INJECTION_RE.test(s))
}

// ─── 错误脱敏 ───

export function sanitizeError(err) {
  const msg = err?.message || 'Internal error'
  return msg.replace(/\/[^\s]+/g, '[path]').slice(0, 200)
}

// ─── 安全头中间件 ───

export function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  next()
}

// ─── 请求日志中间件 ───

export function requestLogger(req, res, next) {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    if (duration > 3000) {
      console.warn(`[slow] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`)
    }
  })
  next()
}

// ─── CORS 配置 ───

export function createCorsOptions(allowedOrigins) {
  if (!allowedOrigins || allowedOrigins.length === 0) {
    return { origin: true, credentials: true }
  }
  return {
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true
  }
}

// ─── 限流器 ───

/** 通用 API 限流：每分钟 120 次 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
})

/** 认证接口限流：每分钟 10 次（防暴力破解） */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later' }
})

/** WebSocket 连接限流：每分钟 20 次 */
export const wsConnectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many WebSocket connection attempts' }
})

// ─── WebSocket Token 认证 ───

const wsTokens = new Map() // token → { ip, expiresAt }
const WS_TOKEN_TTL = 5 * 60 * 1000 // 5 分钟

/**
 * 生成一次性 WebSocket 连接 token
 * @param {string} ip - 客户端 IP
 * @returns {string} token
 */
export function generateWsToken(ip) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + WS_TOKEN_TTL
  wsTokens.set(token, { ip, expiresAt })

  // 清理过期 token（惰性清理）
  if (wsTokens.size > 100) {
    const now = Date.now()
    for (const [key, val] of wsTokens) {
      if (val.expiresAt < now) wsTokens.delete(key)
    }
  }

  return token
}

/**
 * 验证 WebSocket token（一次性，验证后立即销毁）
 * @param {string} token
 * @param {string} ip - 客户端 IP
 * @returns {boolean}
 */
export function validateWsToken(token, ip) {
  if (!token || typeof token !== 'string') return false
  const entry = wsTokens.get(token)
  if (!entry) return false
  wsTokens.delete(token) // 一次性使用
  if (entry.expiresAt < Date.now()) return false
  if (entry.ip !== ip) return false
  return true
}

// ─── 审计日志 ───

const MAX_AUDIT_LOGS = 500
const auditLogStore = []

export function auditLog(action, detail, req) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    detail,
    ip: req?.ip || req?.connection?.remoteAddress || 'unknown'
  }
  auditLogStore.push(entry)
  if (auditLogStore.length > MAX_AUDIT_LOGS) auditLogStore.splice(0, auditLogStore.length - MAX_AUDIT_LOGS)
  return entry
}

export function auditLogs() {
  return auditLogStore
}
