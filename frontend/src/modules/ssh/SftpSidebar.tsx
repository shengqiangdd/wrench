import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  Image,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  Home,
  RefreshCw,
  Upload,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Download,
  FilePlus,
  FolderPlus,
} from 'lucide-react'
import { useSshStore } from '../../stores/ssh-store'
import { getWsClient } from '../../services/websocket'
import type { SftpEntry } from '../../types/ssh'

interface Props {
  sessionId: string
}

// 根据文件名获取图标
function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase()
  if (!ext) return <File size={14} />

  switch (ext) {
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx':
    case 'py':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'rb':
      return <FileCode size={14} className="text-sky-400" />
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileJson size={14} className="text-amber-400" />
    case 'md':
    case 'txt':
    case 'log':
      return <FileText size={14} className="text-slate-400" />
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
      return <Image size={14} className="text-purple-400" />
    default:
      return <File size={14} className="text-slate-500" />
  }
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

// 格式化权限
function formatPermissions(mode: number): string {
  const permStr = mode.toString(8).slice(-3)
  const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return permStr
    .split('')
    .map((c) => perms[parseInt(c, 10)] || '---')
    .join('')
}

// 格式化时间
function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SftpSidebar({ sessionId }: Props) {
  const currentSftpPath = useSshStore((s) => s.currentSftpPath)
  const currentSftpEntries = useSshStore((s) => s.currentSftpEntries)
  const setCurrentSftpPath = useSshStore((s) => s.setCurrentSftpPath)
  const setCurrentSftpEntries = useSshStore((s) => s.setCurrentSftpEntries)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/']))
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    entry: SftpEntry
  } | null>(null)

  const wsClient = getWsClient()

  // 列出目录
  const listDir = useCallback(
    async (dirPath: string) => {
      setLoading(true)
      setError(null)

      try {
        const resp = await wsClient.request({
          type: 'sftp',
          connectionId: sessionId,
          operation: 'list',
          path: dirPath,
        })

        if (resp.type === 'sftp-result' && resp.operation === 'list') {
          setCurrentSftpPath(dirPath)
          setCurrentSftpEntries(resp.files as SftpEntry[])
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [sessionId, wsClient, setCurrentSftpPath, setCurrentSftpEntries],
  )

  // 初始化读取 /
  useEffect(() => {
    if (sessionId) {
      listDir(currentSftpPath || '/')
    }
  }, [sessionId])

  // 导航到目录
  const navigateTo = (dirPath: string) => {
    listDir(dirPath)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      next.add(dirPath)
      return next
    })
  }

  // 返回上级
  const goUp = () => {
    const parent = currentSftpPath === '/' ? '/' : currentSftpPath.split('/').slice(0, -1).join('/') || '/'
    listDir(parent)
  }

  // 回到根
  const goHome = () => listDir('/')

  // 刷新
  const refresh = () => listDir(currentSftpPath)

  // 目录展开/折叠（读取子目录）
  const toggleDir = async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        next.delete(dirPath)
        return next
      })
    } else {
      // 先展开，然后读取子目录
      setExpandedDirs((prev) => {
        const next = new Set(prev)
        next.add(dirPath)
        return next
      })
      // 如果当前不在这个目录，切换到它
      if (currentSftpPath !== dirPath) {
        await listDir(dirPath)
      }
    }
  }

  // 右键菜单
  const handleContextMenu = (e: React.MouseEvent, entry: SftpEntry) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const closeContextMenu = () => setContextMenu(null)

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    const handler = () => closeContextMenu()
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [])

  // 获取树形结构（只对当前路径和展开的目录有效）
  const entries = currentSftpEntries || []
  const files = entries.filter((e) => e.type === 'file')
  const dirs = entries.filter((e) => e.type === 'directory')

  // 路径面包屑
  const pathParts = currentSftpPath.split('/').filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 border-b border-slate-700/50 px-2 py-1.5">
        <button onClick={goHome} className="btn-icon text-slate-500 hover:text-slate-300" title="根目录">
          <Home size={14} />
        </button>
        <button onClick={goUp} className="btn-icon text-slate-500 hover:text-slate-300" title="上级目录">
          <ArrowUp size={14} />
        </button>
        <button onClick={refresh} className="btn-icon text-slate-500 hover:text-slate-300" title="刷新">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <div className="mx-1 h-4 w-px bg-slate-700/50" />
        <button className="btn-icon text-slate-500 hover:text-slate-300" title="新建文件">
          <FilePlus size={14} />
        </button>
        <button className="btn-icon text-slate-500 hover:text-slate-300" title="新建文件夹">
          <FolderPlus size={14} />
        </button>
        <button className="btn-icon text-slate-500 hover:text-slate-300" title="上传">
          <Upload size={14} />
        </button>
      </div>

      {/* 面包屑导航 */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-slate-700/30 px-2 py-1 text-xs">
        <button onClick={goHome} className="shrink-0 rounded px-1 py-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300">
          /
        </button>
        {pathParts.map((part, i) => {
          const fullPath = '/' + pathParts.slice(0, i + 1).join('/')
          return (
            <span key={fullPath} className="flex items-center gap-0.5">
              <span className="text-slate-600">/</span>
              <button
                onClick={() => navigateTo(fullPath)}
                className="rounded px-1 py-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                {part}
              </button>
            </span>
          )
        })}
        {loading && (
          <span className="ml-2 text-[10px] text-slate-600">加载中...</span>
        )}
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="mx-2 mt-2 rounded bg-red-500/10 px-2 py-1 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* 目录列表 */}
        {dirs.map((dir) => (
          <div key={dir.path}>
            <div
              className="group flex cursor-pointer items-center gap-1 px-2 py-1 text-xs hover:bg-slate-800/50"
              onClick={() => toggleDir(dir.path)}
              onContextMenu={(e) => handleContextMenu(e, dir)}
            >
              <span className="shrink-0 text-slate-600">
                {expandedDirs.has(dir.path) ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
              </span>
              <Folder size={14} className="shrink-0 text-amber-400" />
              <span className="truncate text-slate-300">{dir.name}</span>
              <span className="ml-auto text-[10px] text-slate-600 opacity-0 group-hover:opacity-100">
                {formatPermissions(dir.permissions)}
              </span>
            </div>
          </div>
        ))}

        {/* 文件列表 */}
        {files.map((file) => (
          <div
            key={file.path}
            className="group flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-slate-800/50"
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            {getFileIcon(file.name)}
            <span className="truncate text-slate-300">{file.name}</span>
            <span className="ml-auto text-[10px] text-slate-600">
              {formatSize(file.size)}
            </span>
          </div>
        ))}

        {/* 空状态 */}
        {!loading && entries.length === 0 && (
          <div className="flex flex-col items-center py-8 text-slate-600">
            <Folder size={24} />
            <p className="mt-1 text-xs">空目录</p>
          </div>
        )}
      </div>

      {/* 状态栏 */}
      <div className="border-t border-slate-700/30 px-2 py-1 text-[10px] text-slate-600">
        {entries.length} 项
        {currentSftpPath !== '/' && (
          <span className="ml-2">
            | {currentSftpPath}
          </span>
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-lg border border-slate-700 bg-slate-800 py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.entry.type === 'file' && (
            <>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                <Download size={12} /> 下载
              </button>
              <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
                <Edit3 size={12} /> 编辑
              </button>
            </>
          )}
          {contextMenu.entry.type === 'directory' && (
            <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
              <Upload size={12} /> 上传到此
            </button>
          )}
          <div className="mx-2 my-1 border-t border-slate-700/50" />
          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700">
            <Copy size={12} /> 复制路径
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-slate-700">
            <Trash2 size={12} /> 删除
          </button>
        </div>
      )}
    </div>
  )
}
