import { useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { authedFetch } from '../../services/auth'

type EgressProfile = { id: string; label: string; sourceIp: string }
type EgressResponse = { profiles: EgressProfile[]; selectedProfileId: string | null }

export default function EgressProfileSettings() {
  const [data, setData] = useState<EgressResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    authedFetch('/api/egress-profiles', { signal: controller.signal })
      .then((response) => response.json())
      .then((body: { data?: EgressResponse; error?: string }) => {
        if (!body.data) throw new Error(body.error || '加载出口 profile 失败')
        setData(body.data)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : '加载出口 profile 失败')
      })
    return () => controller.abort()
  }, [])

  async function selectProfile(profileId: string) {
    if (!data) return
    setSaving(true)
    setError('')
    try {
      const response = await authedFetch('/api/egress-profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId: profileId || null }),
      })
      const body = (await response.json()) as { data?: EgressResponse; error?: string }
      if (!response.ok || !body.data) throw new Error(body.error || '保存出口 profile 失败')
      setData(body.data)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存出口 profile 失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h3 className="mb-4 flex items-center gap-2 text-xs font-medium tracking-wider text-slate-400 uppercase">
        <Network size={14} /> SSH 出口网络
      </h3>
      <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
        <label className="flex flex-col gap-2 text-xs text-slate-400">
          出口 profile
          <select
            value={data?.selectedProfileId ?? ''}
            disabled={!data || saving || data.profiles.length === 0}
            onChange={(event) => void selectProfile(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 disabled:opacity-60"
          >
            <option value="">默认网络</option>
            {data?.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label} ({profile.sourceIp})
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">
          profile 由实例管理员配置，仅影响新建的 SSH/SFTP 连接；可访问目标仍受服务端出口白名单控制。
        </p>
        {saving && <p className="text-xs text-slate-500">保存中…</p>}
        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
