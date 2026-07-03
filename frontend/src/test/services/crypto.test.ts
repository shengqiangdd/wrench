import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Web Crypto API
const mockKey = { type: 'secret' } as CryptoKey
const mockEncrypted = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])

vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = i
    return arr
  },
  subtle: {
    importKey: vi.fn().mockResolvedValue(mockKey),
    deriveKey: vi.fn().mockResolvedValue(mockKey),
    encrypt: vi.fn().mockResolvedValue(mockEncrypted.buffer),
    decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('test-data').buffer),
  },
})

import { encrypt, decrypt, verifyPassword } from '../../services/crypto'

describe('crypto service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('encrypts and returns base64 string', async () => {
    const result = await encrypt('my-secret', 'password123')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Verify base64 encoding
    expect(() => atob(result)).not.toThrow()
  })

  it('decrypts previously encrypted data', async () => {
    const encrypted = await encrypt('hello', 'pass')
    const decrypted = await decrypt(encrypted, 'pass')
    expect(decrypted).toBe('test-data')
  })

  it('fails decryption with wrong password', async () => {
    // Make decrypt throw for wrong password
    vi.mocked(crypto.subtle.decrypt).mockRejectedValueOnce(new Error('decrypt failed'))

    await expect(
      decrypt('AAAAAAAAAAAAAAAAAAAAAAECAwQFBgcICQoLDA0ODw==', 'wrong-pass'),
    ).rejects.toThrow('解密失败')
  })

  it('verifies password correctly', async () => {
    // Use valid base64 that produces at least 28 bytes (16 salt + 12 iv)
    const validBase64 = 'AAAAAAAAAAAAAAAAAAAAAAECAwQFBgcICQoLDA0ODw=='
    const result = await verifyPassword('pass', validBase64)
    expect(result).toBe(true)
  })

  it('rejects incorrect password on verification', async () => {
    vi.mocked(crypto.subtle.decrypt).mockRejectedValueOnce(new Error('fail'))
    const result = await verifyPassword('wrong', 'some-encrypted-data')
    expect(result).toBe(false)
  })
})
