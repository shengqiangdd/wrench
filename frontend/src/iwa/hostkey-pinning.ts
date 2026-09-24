export type HostKeyPinStore = Pick<Storage, 'getItem' | 'setItem'>

export async function confirmAndPinHostKey(
  host: string,
  port: number,
  fingerprint: string,
  store: HostKeyPinStore,
  confirmFirstUse: (fingerprint: string) => boolean | Promise<boolean>,
  confirmRenewal: (
    storedFingerprint: string,
    presentedFingerprint: string,
  ) => boolean | Promise<boolean> = () => false,
): Promise<boolean> {
  const address = host.includes(':') ? `http://[${host}]/` : `http://${host}/`
  const canonicalHost = new URL(address).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const storageKey = `wrench-iwa-ssh-hostkey-v1:${canonicalHost}:${port}`
  const pinned = store.getItem(storageKey)
  if (pinned !== null) {
    if (pinned === fingerprint) return true
    if (!(await confirmRenewal(pinned, fingerprint))) return false
    store.setItem(storageKey, fingerprint)
    return true
  }
  if (!(await confirmFirstUse(fingerprint))) return false
  store.setItem(storageKey, fingerprint)
  return true
}
