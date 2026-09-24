import { describe, expect, it, vi } from 'vitest'
import { confirmAndPinHostKey } from '../../iwa/hostkey-pinning'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
}

describe('IWA browser-local SSH host-key TOFU pins', () => {
  it('stores only after explicit first-use approval and accepts matching pins', async () => {
    const store = storage()
    const prompt = vi.fn().mockResolvedValue(true)
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:key', store, prompt)).toBe(true)
    expect(prompt).toHaveBeenCalledWith('SHA256:key')
    expect(store.setItem).toHaveBeenCalledWith(
      'wrench-iwa-ssh-hostkey-v1:192.168.1.5:22',
      'SHA256:key',
    )
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:key', store, prompt)).toBe(true)
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('uses one pin for alternate spellings of the same IPv6 literal', async () => {
    const store = storage()
    expect(
      await confirmAndPinHostKey('fd00:0:0:0:0:0:0:1', 22, 'SHA256:key', store, () => true),
    ).toBe(true)
    expect(await confirmAndPinHostKey('fd00::1', 22, 'SHA256:key', store, () => false)).toBe(true)
    expect(store.setItem).toHaveBeenCalledOnce()
  })

  it('does not store an unapproved key and refuses changed keys', async () => {
    const store = storage()
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:first', store, () => false)).toBe(
      false,
    )
    expect(store.setItem).not.toHaveBeenCalled()
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:first', store, () => true)).toBe(
      true,
    )
    const mismatch = vi.fn()
    expect(
      await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:changed', store, () => true, mismatch),
    ).toBe(false)
    expect(mismatch).toHaveBeenCalledWith('SHA256:first', 'SHA256:changed')
    expect(store.setItem).toHaveBeenCalledOnce()
  })
})
