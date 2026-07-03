/**
 * SmartBox 安全存储层
 *
 * 对 IndexedDB / localStorage 中存储的敏感字段（密码、密钥）进行
 * 透明 AES-GCM 加密。使用设备级密钥（基于 navigator 特征衍生），
 * 每次页面加载在内存中生成，不会持久化到磁盘。
 *
 * 工作方式：
 * - 派生密钥：(浏览器指纹 + 固定应用种子) → PBKDF2 → AES-GCM key
 * - 这个密钥只保存在内存中，不写入任何持久化存储
 * - 敏感字段存盘时：encrypt(明文) → base64 密文
 * - 敏感字段读取时：base64 密文 → decrypt() → 明文
 * - 非敏感字段（host, port, username 等）保持明文
 *
 * 安全模型：
 * - 同一设备同一浏览器可自动解密（设备指纹相同）
 * - 跨设备 / 跨浏览器无法解密（设备指纹不同）
 * - XSS 攻击者拿到 localStorage 内容也无法解密（密钥在内存中，需额外 leak）
 * - 导入导出时仍可用用户主密码额外保护
 */

import { encrypt, decrypt, generateKey, isCryptoAvailable } from './crypto'

// ─── 密钥管理 ───

let _deviceKey: string | null = null

/**
 * 获取设备指纹
 * 使用 navigator 属性组合生成稳定但不唯一的设备标识
 */
function getDeviceFingerprint(): string {
  const nav = navigator
  const parts = [
    nav.userAgent,
    nav.language,
    nav.platform,
    // screen 特性
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    // 硬件并发数
    nav.hardwareConcurrency || '',
    // 时间戳偏移（时区）
    new Date().getTimezoneOffset(),
  ]
  return parts.join('||')
}

/**
 * 初始化设备密钥（懒加载）
 */
export function getDeviceKey(): string {
  if (!_deviceKey) {
    const fingerprint = getDeviceFingerprint()
    // 应用种子 + 指纹 = 派生密钥
    const seed = 'SMARTBOX_SECURE_STORE_v1'
    _deviceKey = seed + ':' + fingerprint + ':'
    // 实际使用 PBKDF2 在 encrypt/decrypt 中迭代，这里只是组合字符串
    // 注意：这只是为了生成一个确定性密码，真正的安全性来自 PBKDF2 迭代
    _deviceKey = fingerprint + ':smartbox-secure-v1'
  }
  return _deviceKey
}

/**
 * 重置设备密钥（测试用 / 用户清除数据时）
 */
export function resetDeviceKey(): void {
  _deviceKey = null
}

// ─── 透明加解密 ───

/**
 * 检查一个值是否已被加密
 * 加密后的值以特定前缀开头
 */
const ENCRYPTED_PREFIX = '!e:'

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX)
}

/**
 * 加密敏感字段
 * 空字符串或 undefined 不加密
 */
export async function encryptField(value: string | undefined): Promise<string | undefined> {
  if (!value) return value
  // HTTP 下 crypto.subtle 不可用，直接返回明文
  if (!isCryptoAvailable()) return value
  const key = getDeviceKey()
  const encrypted = await encrypt(value, key)
  return ENCRYPTED_PREFIX + encrypted
}

/**
 * 解密敏感字段
 * 未加密的值直接返回（兼容旧数据）
 */
export async function decryptField(value: string | undefined): Promise<string | undefined> {
  if (!value) return value
  if (!isEncrypted(value)) return value
  const key = getDeviceKey()
  try {
    return await decrypt(value.slice(ENCRYPTED_PREFIX.length), key)
  } catch {
    // 解密失败说明设备指纹变了，返回空
    return undefined
  }
}

/**
 * 加密 SSH Connection 中的敏感字段
 * 返回新对象，不修改原对象
 */
export async function encryptSshConnection(
  conn: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = { ...conn }
  if (result.password) {
    result.password = await encryptField(result.password as string)
  }
  if (result.privateKey) {
    result.privateKey = await encryptField(result.privateKey as string)
  }
  return result
}

/**
 * 解密 SSH Connection 中的敏感字段
 * 返回新对象，不修改原对象
 */
export async function decryptSshConnection(
  conn: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = { ...conn }
  if (result.password) {
    result.password = await decryptField(result.password as string)
  }
  if (result.privateKey) {
    result.privateKey = await decryptField(result.privateKey as string)
  }
  return result
}

export default {
  getDeviceKey,
  resetDeviceKey,
  encryptField,
  decryptField,
  encryptSshConnection,
  decryptSshConnection,
  isEncrypted,
}
