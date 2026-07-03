import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore, type NavId } from '../stores/app-store'
import { usePluginStore } from '../stores/plugin-store'

export interface CommandItem {
  id: string
  label: string
  description?: string
  keywords: string[]
  icon?: string
  category: '导航' | '主题' | '插件' | '工具'
  action: () => void
}

// 注册命令的系统
const _registry: CommandItem[] = []

export function registerCommand(cmd: CommandItem) {
  _registry.push(cmd)
}

export function getCommands(): CommandItem[] {
  return [..._registry]
}

// 简单的模糊匹配（支持拼音首字母和英文）
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const lower = text.toLowerCase()
  const q = query.toLowerCase().trim()

  // 直接子串匹配
  if (lower.includes(q)) return true

  // 拼音首字母匹配（取每个词的首字母）
  const initials = lower
    .split(/[\s_-]/)
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
  if (initials.includes(q)) return true

  // 单词首字母匹配（驼峰）
  const camelInitials = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
  if (camelInitials.includes(q)) return true

  return false
}

export default function CommandPalette() {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setActiveNav = useAppStore((s) => s.setActiveNav)
  const setTheme = useAppStore((s) => s.setTheme)
  const theme = useAppStore((s) => s.theme)

  const pluginCommands = usePluginStore((s) => s.commands)

  // 构建命令列表
  const allCommands: CommandItem[] = [
    // 导航命令
    {
      id: 'nav-ssh',
      label: '打开 SSH 连接',
      description: '切换到 SSH 终端页面',
      keywords: ['ssh', 'terminal', '终端', '连接', 'shell'],
      icon: 'Terminal',
      category: '导航',
      action: () => {
        setActiveNav('ssh')
        setOpen(false)
      },
    },
    {
      id: 'nav-files',
      label: '打开文件管理',
      description: '切换到文件管理器页面',
      keywords: ['files', 'file', '文件', '管理器', 'explorer'],
      icon: 'FileCode2',
      category: '导航',
      action: () => {
        setActiveNav('files')
        setOpen(false)
      },
    },
    {
      id: 'nav-plugins',
      label: '打开插件中心',
      description: '管理已安装的插件',
      keywords: ['plugins', 'plugin', '插件', '扩展', 'extension'],
      icon: 'Puzzle',
      category: '导航',
      action: () => {
        setActiveNav('plugins')
        setOpen(false)
      },
    },
    {
      id: 'nav-settings',
      label: '打开设置',
      description: '配置应用偏好和 AI 设置',
      keywords: ['settings', 'setting', '设置', '配置', 'config', 'preferences'],
      icon: 'Settings',
      category: '导航',
      action: () => {
        setActiveNav('settings')
        setOpen(false)
      },
    },
    // 主题命令
    {
      id: 'theme-dark',
      label: '切换到深色主题',
      description: '使用深色（暗色）界面主题',
      keywords: ['dark', '深色', '暗色', '夜间', 'theme', '主题'],
      icon: 'Moon',
      category: '主题',
      action: () => {
        setTheme('dark')
        setOpen(false)
      },
    },
    {
      id: 'theme-light',
      label: '切换到亮色主题',
      description: '使用浅色（明亮）界面主题',
      keywords: ['light', '亮色', '浅色', '白天', '明亮', 'theme', '主题'],
      icon: 'Sun',
      category: '主题',
      action: () => {
        setTheme('light')
        setOpen(false)
      },
    },
    {
      id: 'theme-system',
      label: '跟随系统主题',
      description: '自动匹配系统主题设置',
      keywords: ['system', '系统', '自动', 'auto', 'theme', '主题'],
      icon: 'Monitor',
      category: '主题',
      action: () => {
        setTheme('system')
        setOpen(false)
      },
    },
    // 工具
    {
      id: 'toggle-sidebar',
      label: '切换侧边栏',
      description: '展开或收起左侧导航栏',
      keywords: ['sidebar', '侧边栏', 'toggle', '切换', '折叠', 'collapse'],
      icon: 'PanelLeft',
      category: '工具',
      action: () => {
        useAppStore.getState().toggleSidebar()
        setOpen(false)
      },
    },
    // 插件命令
    ...pluginCommands.map(
      (cmd): CommandItem => ({
        id: `plugin-${cmd.id}`,
        label: cmd.label || cmd.id,
        description: cmd.description,
        keywords: [cmd.id, cmd.label || '', ...(cmd.keywords || [])],
        icon: cmd.icon,
        category: '插件',
        action: () => {
          usePluginStore.getState().executeCommand(cmd.id)
          setOpen(false)
        },
      }),
    ),
    // 注册的外部命令
    ...getCommands(),
    // 退出
    {
      id: 'close-palette',
      label: '关闭命令面板',
      description: '按 Esc 也可关闭',
      keywords: ['close', '关闭', 'exit', 'quit', '退出', 'esc'],
      icon: 'X',
      category: '工具',
      action: () => setOpen(false),
    },
  ]

  // 过滤
  const filtered = query
    ? allCommands.filter(
        (cmd) =>
          fuzzyMatch(cmd.label, query) ||
          fuzzyMatch(cmd.description || '', query) ||
          cmd.keywords.some((k) => fuzzyMatch(k, query)),
      )
    : allCommands

  // 按分类分组
  const grouped = filtered.reduce<Record<string, CommandItem[]>>((acc, cmd) => {
    const group = acc[cmd.category]
    if (group) {
      group.push(cmd)
    } else {
      acc[cmd.category] = [cmd]
    }
    return acc
  }, {})

  // 选中索引修正
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = filtered.length
      if (total === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => (i + 1) % total)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => (i - 1 + total) % total)
          break
        case 'Enter':
          e.preventDefault()
          filtered[selectedIndex]?.action()
          break
        case 'Escape':
          e.preventDefault()
          setOpen(false)
          break
      }
    },
    [filtered, selectedIndex, setOpen],
  )

  // 自动选中焦点
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
    }
  }, [open])

  // 滚动到选中项
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // 全局快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Mac: Cmd+K, Cmd+P  /  Win: Ctrl+K, Ctrl+P
      const isMeta = e.metaKey || e.ctrlKey
      if (isMeta && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(!open)
        return
      }
      // Esc 关闭
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, setOpen])

  // 阻止事件穿透（避免在使用面板时干扰终端快捷键）
  const handlePaletteKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Ctrl+C/V 等不阻止
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'a')) {
        return
      }
      e.stopPropagation()
      handleKeyDown(e)
    },
    [handleKeyDown],
  )

  if (!open) return null

  // 扁平化索引（用于显示选中状态）
  const flatList = Object.entries(grouped).flatMap(([category, items]) => [
    { type: 'category' as const, name: category },
    ...items.map((item) => ({ type: 'item' as const, item })),
  ])

  // 找到当前选中的项在 flatList 中的真实索引
  let flatSelectedIndex = 0
  let count = -1
  for (const entry of flatList) {
    if (entry.type === 'category') continue
    count++
    if (count === selectedIndex) {
      flatSelectedIndex = flatList.indexOf(entry)
      break
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* 毛玻璃背景 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* 面板 */}
      <div
        className="relative z-10 w-full max-w-lg rounded-xl border border-slate-700/50 bg-slate-900/95 shadow-2xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索输入框 */}
        <div className="flex items-center gap-3 border-b border-slate-700/50 px-4 py-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-slate-500"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handlePaletteKeyDown}
            placeholder="搜索命令..."
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="hidden rounded border border-slate-600/50 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline-block">
            Esc
          </kbd>
        </div>

        {/* 命令列表 */}
        <div className="max-h-80 overflow-y-auto p-2" ref={listRef}>
          {flatList.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-slate-500">
              {query ? `未找到包含「${query}」的命令` : '暂无可用命令'}
            </div>
          )}

          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {category}
              </div>
              {items.map((cmd, idx) => {
                const globalIdx = allCommands.indexOf(cmd)
                const isSelected = globalIdx === selectedIndex
                return (
                  <button
                    key={cmd.id}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                      isSelected
                        ? 'bg-smartbox-500/20 text-smartbox-300'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                    }`}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                  >
                    {/* 图标 */}
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-md ${
                        isSelected ? 'bg-smartbox-500/20' : 'bg-slate-800'
                      }`}
                    >
                      <CommandIcon name={cmd.icon || 'Command'} />
                    </span>

                    {/* 标签和描述 */}
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm font-medium">{cmd.label}</span>
                      {cmd.description && (
                        <span className="text-[11px] text-slate-500">{cmd.description}</span>
                      )}
                    </span>

                    {/* 分类标签 */}
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        cmd.category === '导航'
                          ? 'bg-blue-500/10 text-blue-400'
                          : cmd.category === '主题'
                            ? 'bg-purple-500/10 text-purple-400'
                            : cmd.category === '插件'
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-slate-700/50 text-slate-500'
                      }`}
                    >
                      {cmd.category}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-4 border-t border-slate-700/50 px-4 py-2 text-[10px] text-slate-600">
          <span>
            <kbd className="rounded border border-slate-700 px-1">↑↓</kbd> 选择
          </span>
          <span>
            <kbd className="rounded border border-slate-700 px-1">↵</kbd> 执行
          </span>
          <span>
            <kbd className="rounded border border-slate-700 px-1">Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  )
}

function CommandIcon({ name }: { name: string }) {
  // 简单 SVG 图标映射，避免引入 lucide 组件的额外开销
  const icons: Record<string, React.ReactNode> = {
    Terminal: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" />
      </svg>
    ),
    FileCode2: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m5 12-3 3 3 3" /><path d="m9 18 3-3-3-3" />
      </svg>
    ),
    Puzzle: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
      </svg>
    ),
    Settings: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      </svg>
    ),
    Moon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    ),
    Sun: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
      </svg>
    ),
    Monitor: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
    PanelLeft: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" x2="9" y1="3" y2="21" />
      </svg>
    ),
    X: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
      </svg>
    ),
    Command: (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
      </svg>
    ),
  }

  return <>{icons[name] || null}</>
}
