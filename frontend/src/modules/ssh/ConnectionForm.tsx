import { useState, useCallback, useEffect, useActionState } from 'react'
import { X, CheckCircle2, AlertCircle, Loader2, PlugZap, Eye, EyeOff } from 'lucide-react'
import { useSshStore, decryptConnection } from '../../stores/ssh-store'
import { getWsClientSync } from '../../services/websocket'
import { encryptField } from '../../services/secure-store'
import type { AuthType, SshConnection } from '../../types/ssh'

interface Props {
  onClose: () => void
  editId?: string | null
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

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
  // 如果是编辑已有连接，existing 中的 password/privateKey 可能是加密的
  // 这里直接展示原始值（加密字符串），让用户重新输入或覆盖
  // 如果加密值以 !e: 开头，显示为占位符提示用户重新输入
  const existingPwd = existing?.password || ''
  const existingKey = existing?.privateKey || ''
  const [password, setPassword] = useState(
    existingPwd.startsWith('!e:') ? '' : existingPwd,
  )
  const [showPassword, setShowPassword] = useState(false)
  const [privateKey, setPrivateKey] = useState(
    existingKey.startsWith('!e:') ? '' : existingKey,
  )
  const [group, setGroup] = useState(existing?.group || '')
  // sudo 密码：默认与 SSH 密码相同，可独立设置
  const [sudoPassword, setSudoPassword] = useState(existing?.sudoPassword || password || '')
  const [showSudoPassword, setShowSudoPassword] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState('')

  // ── useActionState: 表单提交异步状态 ──
  const [saveError, saveAction, isSaving] = useActionState(
    async (_prev: string | null, _formData: FormData): Promise<string | null> => {
      if (!name || !host || !username) {
        return '请填写名称、主机和用户名'
      }
      const raw = getConnectionData()
      // 检查重复连接：相同 host + port + username
      if (!existing) {
        const dup = connections.find(c =>
          c.host === raw.host &&
          c.port === raw.port &&
          c.username === raw.username
        )
        if (dup) {
          return '已存在完全相同的连接：' + (dup.name || dup.host)
        }
      }
      // ⚠️ 加密密码和私钥后再存，加密失败则明文存储（回退）
      const data = { ...raw }
      try {
        if (data.password) {
          data.password = await encryptField(data.password) as string
        }
        if (data.sudoPassword) {
          data.sudoPassword = await encryptField(data.sudoPassword) as string
        }
        if (data.privateKey) {
          data.privateKey = await encryptField(data.privateKey) as string
        }
      } catch (err) {
        console.warn('[ConnectionForm] 加密失败，使用明文存储:', err)
      }
      if (existing) {
        updateConnection(existing.id, data as SshConnection)
      } else {
        addConnection(data as SshConnection)
      }
      onClose()
      return null
    },
    null,
  )

  // 同步：当密码变更时，若 sudo 密码未独立修改过，则同步更新
  useEffect(() => {
    if (!existing?.sudoPassword || existing.sudoPassword === existing.password) {
      setSudoPassword(password)
    }
  }, [password, existing])

  const wsClient = getWsClientSync()

  // 构建连接配置对象
  const getConnectionData = useCallback((): SshConnection => ({
    id: existing?.id || `ssh_${Date.now()}`,
    name,
    host,
    port: parseInt(port) || 22,
    username,
    authType,
    ...(authType === 'password' ? { password } : { privateKey }),
    sudoPassword: sudoPassword || password || undefined,
    group: group || undefined,
    createdAt: existing?.createdAt || Date.now(),
    lastConnectedAt: existing?.lastConnectedAt,
  }), [existing, name, host, port, username, authType, password, privateKey, sudoPassword, group])

  // 测试连接
  const handleTestConnection = useCallback(async () => {
    if (!host || !username) {
      setTestStatus('error')
      setTestMessage('请先填写主机和用户名')
      return
    }

    setTestStatus('testing')
    setTestMessage('正在测试连接...')

    try {
      const msg = await wsClient.request({
        type: 'test',
        connectionId: `test_${Date.now()}`,
        host,
        port: parseInt(port) || 22,
        username,
        password: authType === 'password' ? password : undefined,
        privateKey: authType === 'key' ? privateKey : undefined,
        sudoPassword: sudoPassword || password || undefined,
      }, 12000)

      if ((msg as any).success) {
        setTestStatus('success')
        setTestMessage((msg as any).message || '连接成功')
      } else {
        setTestStatus('error')
        setTestMessage((msg as any).message || '连接失败')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestMessage(err.message || '连接测试超时')
    }
  }, [host, port, username, password, privateKey, sudoPassword, authType, wsClient])

  // 检测输入是否完整、可测试
  const canTest = host && username && (
    authType === 'password' ? true : !!privateKey
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm pt-4 pb-12 md:items-center md:pt-0 md:pb-0">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 shadow-xl my-auto">
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
        <form action={saveAction} className="space-y-3 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">名称 *</label>
              <input
                className="input"
                placeholder="例如：我的服务器"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="sm:col-span-2">
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
                min={1}
                max={65535}
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
                autoComplete="username"
              />
            </div>

            <div className="sm:col-span-2">
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
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-500">密码</label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="输入密码"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="sm:col-span-2">
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

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">
                sudo 密码
                <span className="text-slate-600 ml-1">（默认与 SSH 密码相同，用于 sudo -S 提权）</span>
              </label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showSudoPassword ? 'text' : 'password'}
                  placeholder="sudo 密码（留空则使用 SSH 密码）"
                  autoComplete="off"
                  value={sudoPassword}
                  onChange={(e) => setSudoPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                  onClick={() => setShowSudoPassword(!showSudoPassword)}
                  tabIndex={-1}
                >
                  {showSudoPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-slate-500">分组（可选）</label>
              <input
                className="input"
                placeholder="例如：生产环境 / 开发环境"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
            </div>
          </div>

          {/* 重复连接提示 */}
          {saveError && (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertCircle size={14} />
              <span>{saveError}</span>
            </div>
          )}

          {/* 测试连接 - 结果 */}
          {testStatus !== 'idle' && (
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                testStatus === 'testing'
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
                  : testStatus === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                    : 'border-red-500/30 bg-red-500/5 text-red-400'
              }`}
            >
              {testStatus === 'testing' && <Loader2 size={14} className="animate-spin" />}
              {testStatus === 'success' && <CheckCircle2 size={14} />}
              {testStatus === 'error' && <AlertCircle size={14} />}
              <span>{testMessage}</span>
            </div>
          )}

          {/* 按钮区域 */}
          <div className="flex justify-between gap-2 border-t border-slate-700/50 pt-3">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={!canTest || testStatus === 'testing'}
              className="btn flex items-center gap-1.5 border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200 disabled:opacity-40"
            >
              <PlugZap size={14} />
              测试连接
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost">
                取消
              </button>
              <button type="submit" disabled={isSaving} className="btn btn-primary">
                {isSaving ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    保存中...
                  </>
                ) : (
                  existing ? '保存修改' : '添加连接'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
