import { useState } from 'react'
import { X } from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import type { AuthType, SshConnection } from '../../types/ssh'

interface Props {
  onClose: () => void
  editId?: string | null
}

export default function ConnectionForm({ onClose, editId }: Props) {
  const connections = useSshStore((s) => s.connections)
  const addConnection = useSshStore((s) => s.addConnection)
  const updateConnection = useSshStore((s) => s.updateConnection)

  const existing = editId ? connections.find((c) => c.id === editId) : null

  const [name, setName] = useState(existing?.name || '')
  const [host, setHost] = useState(existing?.host || '')
  const [port, setPort] = useState(String(existing?.port || 22))
  const [username, setUsername] = useState(existing?.username || 'root')
  const [authType, setAuthType] = useState<AuthType>(existing?.authType || 'password')
  const [password, setPassword] = useState(existing?.password || '')
  const [privateKey, setPrivateKey] = useState(existing?.privateKey || '')
  const [group, setGroup] = useState(existing?.group || '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name || !host || !username) return

    const data: SshConnection = {
      id: existing?.id || `ssh_${Date.now()}`,
      name,
      host,
      port: parseInt(port) || 22,
      username,
      authType,
      ...(authType === 'password' ? { password } : { privateKey }),
      group: group || undefined,
      createdAt: existing?.createdAt || Date.now(),
    }

    if (existing) {
      updateConnection(existing.id, data)
    } else {
      addConnection(data)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-200">
            {existing ? '编辑连接' : '新建连接'}
          </h3>
          <button onClick={onClose} className="btn-icon text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">名称 *</label>
              <input
                className="input"
                placeholder="例如：我的服务器"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">主机 *</label>
              <input
                className="input"
                placeholder="192.168.1.100 或 example.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">端口</label>
              <input
                className="input"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">用户名 *</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">认证方式</label>
              <div className="flex gap-2">
                {(['password', 'key'] as AuthType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setAuthType(type)}
                    className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      authType === type
                        ? 'border-smartbox-500 bg-smartbox-500/10 text-smartbox-400'
                        : 'border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {type === 'password' ? '密码认证' : '密钥认证'}
                  </button>
                ))}
              </div>
            </div>

            {authType === 'password' ? (
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500">密码</label>
                <input
                  className="input"
                  type="password"
                  placeholder="输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-slate-500">私钥内容</label>
                <textarea
                  className="input min-h-[100px] font-mono text-xs"
                  placeholder="-----BEGIN RSA PRIVATE KEY-----
..."
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                />
              </div>
            )}

            <div className="col-span-2">
              <label className="mb-1 block text-xs text-slate-500">分组（可选）</label>
              <input
                className="input"
                placeholder="例如：生产环境 / 开发环境"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-700/50 pt-3">
            <button type="button" onClick={onClose} className="btn-ghost">
              取消
            </button>
            <button type="submit" className="btn-primary">
              {existing ? '保存修改' : '添加连接'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
