import { useEffect } from 'react'
import { X } from 'lucide-react'

interface ShortcutGroup {
  title: string
  items: { keys: string; label: string }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { keys: 'Ctrl+K', label: '打开命令面板' },
      { keys: 'Ctrl+B', label: '切换侧边栏' },
      { keys: 'Ctrl+Shift+F', label: '搜索当前视图内容' },
      { keys: 'Shift+?', label: '打开快捷键列表' },
    ],
  },
  {
    title: '终端',
    items: [
      { keys: 'Ctrl+Shift+C', label: '复制选中文本' },
      { keys: 'Ctrl+Shift+V', label: '粘贴文本' },
      { keys: 'Ctrl+C', label: '选中时复制 / 未选中时发送 SIGINT' },
      { keys: 'Ctrl+V / Shift+Insert', label: '粘贴到终端' },
      { keys: 'Ctrl+Shift+F', label: '搜索终端输出' },
      { keys: 'Enter', label: '搜索下一个匹配' },
      { keys: 'Shift+Enter', label: '搜索上一个匹配' },
      { keys: 'Esc', label: '关闭终端搜索' },
    ],
  },
  {
    title: '编辑器',
    items: [
      { keys: 'Ctrl+S', label: '保存当前文件' },
      { keys: '双击', label: '打开文件（双击文件名）' },
      { keys: 'Ctrl+单击', label: '在右侧面板打开文件' },
    ],
  },
  {
    title: '文件管理器',
    items: [
      { keys: '右击', label: '打开上下文菜单（新建/上传/重命名/删除）' },
      { keys: 'Ctrl+F', label: '搜索文件（当前目录过滤）' },
      { keys: 'Ctrl+Enter', label: '递归搜索所有子目录' },
      { keys: '双击目录', label: '进入目录' },
    ],
  },
  {
    title: 'AI 侧边栏',
    items: [
      { keys: '双击 / Ctrl+S', label: '保存当前对话' },
      { keys: 'Ctrl+Shift+Enter', label: '发送消息' },
    ],
  },
  {
    title: '分屏终端',
    items: [
      { keys: '分屏工具栏 [+]', label: '分屏（垂直/水平）' },
      { keys: '分屏工具栏 [x]', label: '关闭当前分屏' },
      { keys: '分屏工具栏 [🔗]', label: '启用命令同步' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export default function ShortcutHelpModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-900 p-5 shadow-2xl">
        {/* 头部 */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">快捷键列表</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>

        {/* 快捷键分组 */}
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-slate-800/50"
                  >
                    <span className="text-slate-400">{item.label}</span>
                    <kbd className="ml-3 shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <p className="mt-4 text-[10px] text-slate-600">
          按 <kbd className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 font-mono">Esc</kbd> 或点击外部关闭
        </p>
      </div>
    </div>
  )
}
