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

  it('renews a pin only after explicit approval and otherwise rejects a changed key', async () => {
    const store = storage()
    await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:first', store, () => true)
    const denyRenewal = vi.fn().mockReturnValue(false)
    expect(
      await confirmAndPinHostKey(
        '192.168.1.5',
        22,
        'SHA256:changed',
        store,
        () => true,
        denyRenewal,
      ),
    ).toBe(false)
    expect(denyRenewal).toHaveBeenCalledWith('SHA256:first', 'SHA256:changed')
    const approveRenewal = vi.fn().mockReturnValue(true)
    expect(
      await confirmAndPinHostKey(
        '192.168.1.5',
        22,
        'SHA256:changed',
        store,
        () => true,
        approveRenewal,
      ),
    ).toBe(true)
    expect(store.setItem).toHaveBeenLastCalledWith(
      'wrench-iwa-ssh-hostkey-v1:192.168.1.5:22',
      'SHA256:changed',
    )
    expect(
      await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:changed', store, () => false),
    ).toBe(true)
  })

  it('does not store an unapproved first-use key', async () => {
    const store = storage()
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:first', store, () => false)).toBe(
      false,
    )
    expect(store.setItem).not.toHaveBeenCalled()
    expect(await confirmAndPinHostKey('192.168.1.5', 22, 'SHA256:first', store, () => true)).toBe(
      true,
    )
    expect(store.setItem).toHaveBeenCalledOnce()
  })
})
