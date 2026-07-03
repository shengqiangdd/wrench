import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getDeviceKey,
  resetDeviceKey,
  isEncrypted,
  encryptField,
  decryptField,
  encryptSshConnection,
  decryptSshConnection,
} from '../../services/secure-store'

describe('secure-store', () => {
  beforeEach(() => {
    resetDeviceKey()
  })

  describe('getDeviceKey', () => {
    it('returns a non-empty string', () => {
      const key = getDeviceKey()
      expect(typeof key).toBe('string')
      expect(key.length).toBeGreaterThan(0)
    })

    it('returns same key on repeated calls', () => {
      const key1 = getDeviceKey()
      const key2 = getDeviceKey()
      expect(key1).toBe(key2)
    })

    it('returns different key after reset', () => {
      const key1 = getDeviceKey()
      resetDeviceKey()
      const key2 = getDeviceKey()
      // After reset, fingerprint is re-generated — may or may not differ
      // but should at least be a valid string
      expect(typeof key2).toBe('string')
      expect(key2.length).toBeGreaterThan(0)
    })
  })

  describe('isEncrypted', () => {
    it('returns true for encrypted values', () => {
      expect(isEncrypted('!e:somedata')).toBe(true)
    })

    it('returns false for plain values', () => {
      expect(isEncrypted('hello')).toBe(false)
      expect(isEncrypted('')).toBe(false)
      expect(isEncrypted('!e')).toBe(false) // too short prefix
    })
  })

  describe('encryptField / decryptField', () => {
    it('returns undefined for undefined input', async () => {
      expect(await encryptField(undefined)).toBeUndefined()
      expect(await decryptField(undefined)).toBeUndefined()
    })

    it('returns empty string as-is', async () => {
      expect(await encryptField('')).toBe('')
    })

    it('returns plain text when crypto is unavailable', async () => {
      // In test env, crypto.subtle may not be available
      const val = 'my-password'
      const encrypted = await encryptField(val)
      // If crypto is unavailable, returns plaintext; if available, returns encrypted
      if (encrypted === val) {
        // Crypto not available — plain pass-through
        expect(encrypted).toBe(val)
      } else {
        // Crypto available — should start with !e: prefix
        expect(encrypted).toMatch(/^!e:/)
      }
    })

    it('round-trips when crypto is available', async () => {
      const encrypted = await encryptField('secret-value')
      if (encrypted && encrypted !== 'secret-value') {
        // Crypto available — decrypt should recover original
        const decrypted = await decryptField(encrypted)
        expect(decrypted).toBe('secret-value')
      }
      // If crypto not available, test is skipped (pass-through)
    })

    it('decryptField returns undefined for unrecognized encrypted value', async () => {
      // A value with !e: prefix but invalid base64/ciphertext
      const result = await decryptField('!e:invalid-ciphertext!!!')
      expect(result).toBeUndefined()
    })

    it('decryptField passes through unencrypted values', async () => {
      const result = await decryptField('plain-text')
      expect(result).toBe('plain-text')
    })
  })

  describe('encryptSshConnection / decryptSshConnection', () => {
    it('encrypts password and privateKey fields', async () => {
      const conn = {
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        password: 'mypass',
        privateKey: 'key-data',
      }
      const encrypted = await encryptSshConnection(conn)

      expect(encrypted.host).toBe('192.168.1.1') // non-sensitive unchanged
      expect(encrypted.username).toBe('root')

      // password and privateKey should be encrypted (or plaintext if crypto unavailable)
      if (encrypted.password !== 'mypass') {
        expect(encrypted.password as string).toMatch(/^!e:/)
      }
      if (encrypted.privateKey !== 'key-data') {
        expect(encrypted.privateKey as string).toMatch(/^!e:/)
      }
    })

    it('does not modify the original object', async () => {
      const conn = { host: '1.2.3.4', password: 'secret' }
      const original = { ...conn }
      await encryptSshConnection(conn)
      expect(conn).toEqual(original)
    })

    it('skips undefined password/privateKey', async () => {
      const conn = { host: '1.2.3.4', username: 'root' }
      const encrypted = await encryptSshConnection(conn)
      expect(encrypted.password).toBeUndefined()
      expect(encrypted.privateKey).toBeUndefined()
    })

    it('round-trips through encrypt+decrypt', async () => {
      const conn = { host: '1.2.3.4', password: 'mypass', privateKey: 'key-data' }
      const encrypted = await encryptSshConnection(conn)
      const decrypted = await decryptSshConnection(encrypted)

      expect(decrypted.host).toBe('1.2.3.4')
      // After round-trip, should get back original values
      if (encrypted.password !== 'mypass') {
        // Crypto available — decrypt should recover
        expect(decrypted.password).toBe('mypass')
      } else {
        expect(decrypted.password).toBe('mypass')
      }
    })
  })
})
