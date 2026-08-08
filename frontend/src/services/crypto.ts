/**
 * Wrench 加密层
 *
 * 使用 Web Crypto API 实现 AES-GCM 加密/解密。
 * 主密码保护敏感的 SSH 私钥、API Key 等数据。
 *
 * 架构：
 * - 主密码 → PBKDF2 (100k 次迭代) → AES-GCM key
 * - 每个加密值使用独立随机 IV
 * - 加密值存储为 base64 编码（IV + ciphertext + salt 组合）
 */

const ITERATIONS = 100000
const KEY_LENGTH = 256
const SALT_LENGTH = 16
const IV_LENGTH = 12

/**
 * 从主密码派生 AES-GCM 密钥
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
    'deriveKey',
  ])

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * 加密明文
 * 返回格式: base64(salt(16) + iv(12) + ciphertext)
 */
export async function encrypt(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(password, salt)
  const enc = new TextEncoder()

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  )

  // 打包: salt + iv + ciphertext
  const combined = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength)
  combined.set(salt, 0)
  combined.set(iv, SALT_LENGTH)
  combined.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH)

  return arrayToBase64(combined)
}

/**
 * 解密密文
 */
export async function decrypt(encrypted: string, password: string): Promise<string> {
  try {
    const combined = base64ToArray(encrypted)
    const salt = combined.slice(0, SALT_LENGTH)
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH)

    const key = await deriveKey(password, salt)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)

    return new TextDecoder().decode(decrypted)
  } catch {
    throw new Error('解密失败：密码错误或数据已损坏')
  }
}

/**
 * 验证密码是否正确（尝试加解密一个测试值）
 */
export async function verifyPassword(password: string, testEncrypted: string): Promise<boolean> {
  try {
    await decrypt(testEncrypted, password)
    return true
  } catch {
    return false
  }
}

/**
 * 创建主密码（同时返回用于验证的加密标记）
 */
export async function createMasterPassword(
  password: string,
): Promise<{ encrypted: string; verifyToken: string }> {
  const verifyToken = 'WRENCH_MASTER_' + Date.now()
  const encrypted = await encrypt(verifyToken, password)
  return { encrypted, verifyToken }
}

// ─── Base64 辅助函数 ───

function arrayToBase64(array: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]!)
  }
  if (typeof btoa !== 'undefined') {
    return btoa(binary)
  }
  return Buffer.from(binary, 'binary').toString('base64')
}

function base64ToArray(base64: string): Uint8Array {
  let binary: string
  if (typeof atob !== 'undefined') {
    binary = atob(base64)
  } else {
    binary = Buffer.from(base64, 'base64').toString('binary')
  }
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i)
  }
  return array
}

/**
 * 生成加密密钥（用于密钥随机生成）
 */
export function generateKey(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return arrayToBase64(array)
}

/**
 * 检查 Web Crypto API 是否可用
 */
export function isCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && crypto.subtle !== undefined
}

export default {
  encrypt,
  decrypt,
  verifyPassword,
  createMasterPassword,
  generateKey,
  isCryptoAvailable,
}
