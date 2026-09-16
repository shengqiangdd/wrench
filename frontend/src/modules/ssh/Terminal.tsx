import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import {
  Search,
  ChevronUp,
  ChevronDown,
  Copy,
  ArrowDownToLine,
  ClipboardPaste,
  Eraser,
  TextSelect,
  Unplug,
} from 'lucide-react'
import { createSessionWsClient, type WsClient } from '../../services/websocket'
import { AnsiStreamBuffer } from '../../utils/ansi-preprocessor'
import { isAtShellPrompt } from '../../utils/shell-prompt'
import {
  QUIET_PROGRESS_LEGACY_STORAGE_KEY,
  QUIET_PROGRESS_STORAGE_KEY,
  buildQuietProgressExportLine,
  buildQuietProgressUnsetLine,
  resolveQuietProgress,
} from '../../utils/quiet-env'
import {
  CANVAS_GROW_MEMORY_MS,
  CANVAS_ROWS_FLOOR,
  clampWindowOffset,
  followWindowOffset,
  isCanvasCappedOut,
  isLiveBottom,
  maxWindowOffset,
  nextCanvasRowsForBlock,
  panWindow,
  resolveCanvasRows,
} from '../../utils/terminal-canvas'
import { createCursorUpRunState, scanCursorUpRuns } from '../../utils/cursor-up-runs'
import { on } from '../../services/event-bus'
import {
  TerminalContextMenu,
  type TerminalMenuItem,
} from '../../components/terminal/TerminalContextMenu'
import { TerminalSearchBar } from '../../components/terminal/TerminalSearchBar'
import { TerminalDisplayMenu } from '../../components/terminal/TerminalDisplayMenu'
import { TerminalPasteDialog } from '../../components/terminal/TerminalPasteDialog'
import { useTerminalSearch } from '../../hooks/useTerminalSearch'
import { useTerminalPaste } from '../../hooks/useTerminalPaste'
import { useTerminalReconnect } from '../../hooks/useTerminalReconnect'
import { normalizeDisconnectReason } from '../../utils/terminal-reconnect'
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEP,
  patchTerminalPrefs,
  readTerminalPrefs,
  stepFontSize,
  subscribeTerminalPrefs,
  type TerminalPrefs,
} from '../../utils/terminal-prefs'
import { formatFontSizeHint } from '../../utils/terminal-search'
import { isCoarsePointer } from '../../utils/terminal-links'
import { registerTerminalLinks } from '../../utils/terminal-link-provider'
import { safeWriteClipboard } from '../../utils/clipboard'
import {
  isDuplicateDelete,
  markDeleteSent,
  type PendingDelete,
} from '../../utils/terminal-delete-dedup'

/** 分屏面板配置 */
export interface SplitPanel {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  size: number // 百分比 0-100
  children?: SplitPanel[]
}

/** SSH 连接凭据（传递给 Terminal 以建立独立 WS 连接） */
export interface SshCredentials {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  sudoPassword?: string
}

interface Props {
  connectionId: string
  sessionId: string
  className?: string
  onConnected?: () => void
  onDisconnected?: () => void
  /** 命令同步：收到用户输入时回调（用于广播到同组其他分屏） */
  onTerminalData?: (data: string) => void
  /** SSH 连接凭据（用于建立独立 WebSocket 连接） */
  credentials?: SshCredentials
}

// 主题配色（与终端一致）
const TERMINAL_THEME = {
  background: '#0f172a',
  foreground: '#e2e8f0',
  cursor: '#38bdf8',
  selectionBackground: '#334155',
  black: '#1e293b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#cbd5e1',
  brightBlack: '#475569',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#f1f5f9',
}

/**
 * 编码"往 PTY 写一行命令"的字节。
 * 前导空格：配合 shell 的 HISTCONTROL=ignorespace 不污染 history。
 */
function encodePtyLine(line: string): string {
  return btoa(unescape(encodeURIComponent(` ${line}\r`)))
}

/** 画布开关的持久化键（读不到 localStorage 时按默认开） */
const CANVAS_STORAGE_KEY = 'wrench_ssh_canvas'

/**
 * 画布开关的初值。
 * 抽成函数是因为「进度纯文本」的默认值要跟随画布（见 quiet-env 的
 * `resolveQuietProgress`），两处 useState 初值得读到同一份状态。
 */
function readCanvasPref(): boolean {
  try {
    return localStorage.getItem(CANVAS_STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

/** 已保存的「进度纯文本」选择（新键优先，兼容老键）；`null` = 用户从没选过 */
function readQuietProgressPref(): string | null {
  try {
    return (
      localStorage.getItem(QUIET_PROGRESS_STORAGE_KEY) ??
      localStorage.getItem(QUIET_PROGRESS_LEGACY_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

export default function TerminalView({
  connectionId,
  sessionId,
  className = '',
  onConnected,
  onDisconnected,
  onTerminalData,
  credentials,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const connectedRef = useRef(false)
  const connectingRef = useRef(false)
  const disposedRef = useRef(false)
  // ─── 搜索：状态机抽到 hooks/useTerminalSearch（容器终端共用同一份）───
  // `showSearchRef` 仍然保留给画布用：搜索面板占了几行屏幕，画布要让出去。
  const showSearchRef = useRef(false)
  const search = useTerminalSearch(
    () => searchAddonRef.current,
    (open) => {
      showSearchRef.current = open
    },
  )
  // ─── 终端显示偏好（字号/字体/光标/滚动缓冲；设置面板与本组件共用同一来源）───
  const [prefs, setPrefs] = useState(readTerminalPrefs)
  const prefsRef = useRef(prefs)
  // ─── 断线状态：断线不再只是终端里的一行红字，而是带"重连"出路的状态条 ───
  // 断线状态条上的一切（倒计时/次数/能不能自动重连）交给 useTerminalReconnect 统一管：
  // 以前只有一个 connectionLost 字符串，只能给一个『重连』按钮。
  // ─── 桌面端：选中文本后浮现复制按钮 ───
  const [hasSelection, setHasSelection] = useState(false)
  // ─── 上下文菜单（桌面右键 / 移动端长按共用）───
  // 条目在**事件处理器里**构建好再存进 state：渲染期读取终端 ref 是 React Compiler
  // 明令禁止的，而且这样能把"右键那一刻"的可用状态（有没有选中、能不能回到底部）固定住。
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    items: TerminalMenuItem[]
  } | null>(null)
  // ─── 移动端快捷键工具栏 ref（用于 ColorOS 长按阻止） ───
  const toolbarRef = useRef<HTMLDivElement>(null)
  // ─── 移动端：选择文本模态框（textarea 让用户自由选择复制） ───
  const [selectModalText, setSelectModalText] = useState<string | null>(null)
  const selectModalRef = useRef<HTMLTextAreaElement>(null)
  // 快捷键防抖 ref（方向键专用，更短的间隔支持连续按）
  const lastArrowKeyTime = useRef(0)
  // 其他快捷键防抖 ref
  const lastShortcutTime = useRef(0)
  // 🔧 防止 Backspace/Delete 被 onData 重复发送的标记：绑定「字节 + 时间窗」而
  // 不是裸布尔。裸布尔会吞掉用户后续输入的第一个真实字符（详见
  // utils/terminal-delete-dedup.ts 顶部的成因说明）。
  const pendingDeleteRef = useRef<PendingDelete | null>(null)
  // 🔧 粘贴（batch 2b ①）：Ctrl+V 放行给浏览器原生粘贴后，xterm 仍会按默认动作
  // 先发一个 0x16(^V)。浏览器里 Ctrl+V 只可能是"粘贴"，不可能是用户想打 ^V，
  // 所以打标记由 onData 精确丢掉紧跟其后的那一个 ^V 字符。
  const pendingPasteKeystrokeRef = useRef(false)
  // ─── 自动滚动管理 ───
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const userScrolledUpRef = useRef(false)
  // ─── 进度纯文本开关（本会话注入了哪些变量见 utils/quiet-env.ts）───
  // 默认值**跟随画布**：整块重画的进度 UI（compose 的 [+]/[=> 块、BuildKit 的 TUI）
  // 靠 ESC[nA"上移回块首"逐帧重绘，块高超过屏高时每帧会往 scrollback 永久丢
  // (块高 − 屏高) 行：实测 44 列 × 12 行跑一次 20 服务 compose pull = 3012 行
  // （2151 行重复）；plain 是逐行追加日志，任何尺寸都稳定。
  // 但画布（几何层，默认开）已经把块高塞进逻辑屏、实测富进度 0 堆行 —— 这时再压成
  // plain 就是净损失（看不到动画、回显三行 export、等于替所有人改 docker 的展示设置）。
  // 所以：画布开 → 不注入；画布关（用户主动贴屏，行数兜底没了）→ 自动注入。
  // 用户手动点过「日志逐行输出」就听用户的，画布再切也不动它（plainManualRef）。
  const [plainInit] = useState(() =>
    resolveQuietProgress(readQuietProgressPref(), readCanvasPref()),
  )
  const [composePlain, setComposePlain] = useState<boolean>(plainInit.value)
  const composePlainRef = useRef(composePlain)
  /** 用户是否手动点过「日志逐行输出」（没点过 = 跟随「进度原地刷新」） */
  const plainManualRef = useRef(plainInit.manual)
  // ─── 终端画布开关（逻辑尺寸与可视尺寸解耦，见 utils/terminal-canvas.ts）───
  // 默认开启：窄视口（手机键盘弹起约 12 行）下把 PTY 逻辑屏抬到 30 行，
  // 可视区只是这扇屏上的一扇窗（跟随光标、可平移）。这样"整块重画"的进度 UI
  // 有足够行数原地重绘，不再每帧往 scrollback 丢重复块（实测 44×12 跑 20 服务
  // compose pull：2383 行 → 0 行）。
  // 关掉 = 贴屏（逻辑尺寸 = 可视尺寸，即改造前行为），留给 tmux / top 这类
  // 非备用屏全屏程序，或不喜欢窗口平移的场景。
  const [canvasOn, setCanvasOn] = useState<boolean>(readCanvasPref)
  const canvasOnRef = useRef(canvasOn)
  /** 画布控制器（终端初始化 effect 注入；供芯片 /「回到底部」按钮调用） */
  const canvasCtlRef = useRef<{ refit: () => void; goLive: () => void } | null>(null)
  // 用户是否已在本次连接里敲过键（自动注入安静进度变量前用它避让）
  const userTypedRef = useRef(false)
  // 自动注入安静进度变量的"等提示符出现"轮询定时器
  const plainInjectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // ─── 移动端快捷键工具栏收起状态（收起＝把行数还给终端）───
  const [toolbarCollapsed, setToolbarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wrench_ssh_toolbar_collapsed') === '1'
    } catch {
      return false
    }
  })
  // ─── 终端内轻提示（开关反馈）───
  const [hint, setHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 终端内轻提示（2.5s 自动消失）——声明在连接 effect 之前，供其中的自动注入逻辑使用 */
  const showHint = (text: string) => {
    setHint(text)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setHint(null), 2500)
  }

  /**
   * 粘贴这条链的唯一入口（读剪贴板 → 直接发 / 多行确认 / 粘贴框兜底）。
   * 声明在连接 effect 之前：菜单条目与快捷键处理器都在 effect / 长按回调里构建。
   */
  const paste = useTerminalPaste({
    getTerm: () => terminalRef.current,
    showHint,
    fallbackSend: (text) => {
      const encoded = btoa(unescape(encodeURIComponent(text)))
      termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
      onTerminalData?.(encoded)
    },
    emptyHint: '剪贴板里没有可粘贴的文本',
  })

  /** 真正去重开会话（连接 effect 里赋值：WS 还活着就重发 connect，死了就重开 WsClient） */
  const reopenSessionRef = useRef<(() => void) | null>(null)
  /** 本次 connect 是否由自动重连发起（重连成功后不清屏；超时后继续退避而不是直接放弃） */
  const reconnectingRef = useRef(false)
  /** 这个终端是否成功建立过 SSH 会话（区分"首次连接"与"掉线后恢复"） */
  const sshEstablishedRef = useRef(false)
  const reopenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnect = useTerminalReconnect({
    onReconnect: () => reopenSessionRef.current?.(),
    onAttempt: (attempt) => {
      showHint(attempt > 1 ? `正在重新连接（第 ${attempt} 次）…` : '正在重新连接…')
    },
  })

  /**
   * 把一组显示偏好应用到当前终端实例。
   * 字号/行高会改变行高像素与可视行数，所以必须让画布重算几何（`refit` 会清掉
   * 可视行数缓存 —— 那个缓存是和字号绑定的，不清就会按旧字号算窗口平移量）。
   */
  const applyPrefsToTerminal = useCallback((next: TerminalPrefs) => {
    const term = terminalRef.current
    if (!term) return
    term.options.fontSize = next.fontSize
    term.options.fontFamily = next.fontFamily
    term.options.lineHeight = next.lineHeight
    term.options.cursorStyle = next.cursorStyle
    term.options.cursorBlink = next.cursorBlink
    term.options.scrollback = next.scrollback
    term.options.macOptionIsMeta = next.macOptionIsMeta
    canvasCtlRef.current?.refit()
  }, [])

  // 渲染期不能写 ref（React Compiler 规则），用 effect 同步
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  // 偏好变化（设置面板 / 快捷键 / 另一个标签页）→ 同步到本实例
  useEffect(() => {
    return subscribeTerminalPrefs(() => setPrefs(readTerminalPrefs()))
  }, [])

  useEffect(() => {
    applyPrefsToTerminal(prefs)
  }, [prefs, applyPrefsToTerminal])

  /**
   * 字号缩放：Ctrl/⌘ + `+`/`-`/`0`（`Ctrl+0` 复位）。
   * 只写偏好存储 —— 落盘 + 广播后，本组件与其他终端（含容器终端）一起更新，
   * 不需要在这里直接碰 xterm。
   */
  const changeFontSize = (delta: number | 'reset') => {
    const current = prefsRef.current.fontSize
    const next = delta === 'reset' ? FONT_SIZE_DEFAULT : stepFontSize(current, delta)
    if (next === current) {
      showHint(`终端字号已到边界（${next}px）`)
      return
    }
    patchTerminalPrefs({ fontSize: next })
    showHint(formatFontSizeHint({ ...prefsRef.current, fontSize: next }))
  }

  // ─── 复制 / 菜单 / 回到底部：这些要在连接 effect **之前**声明 ───
  // （移动端长按菜单在 effect 里构建，声明晚于 effect 会被判定为 TDZ 使用）

  // ─── 复制操作辅助函数 ───

  /** 获取终端全部文本（优先用 buffer，fallback 到 selection API） */
  const getTerminalAllText = useCallback((): string => {
    const term = terminalRef.current
    if (!term) return ''
    // 方式 1：从 buffer 逐行读取（最可靠，不依赖 selection API）
    try {
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) || '')
      }
      return lines.join('\n')
    } catch {
      // fallthrough
    }
    // 方式 2：selection API fallback
    try {
      term.selectAll()
      const text = term.getSelection() || ''
      term.clearSelection()
      return text
    } catch {
      return ''
    }
  }, [])

  /** 复制操作（有选区则复制选中，无则复制全部） */
  const handleCopyAction = useCallback(() => {
    const term = terminalRef.current
    if (!term) return
    // 检查是否有选区
    const selection = term.getSelection() || ''
    if (selection.trim()) {
      safeWriteClipboard(selection)
    } else {
      const allText = getTerminalAllText()
      if (allText) safeWriteClipboard(allText)
    }
  }, [getTerminalAllText])

  /** 回到底部：画布开启时 = 窗口跟随光标贴底；否则直接滚到底 */
  const goLive = () => {
    userScrolledUpRef.current = false
    setUserScrolledUp(false)
    if (canvasCtlRef.current) canvasCtlRef.current.goLive()
    else terminalRef.current?.scrollToBottom()
  }

  /**
   * 上下文菜单条目 —— 桌面右键与移动长按**共用同一组**。
   *
   * 之前只有移动端长按有菜单，而且只有两项复制；桌面右键被 preventDefault 之后
   * 什么都不发生。这里补齐"一个终端该能做的事"，也顺手把两端的操作路径统一。
   */
  const buildTerminalMenuItems = (hasSel: boolean): TerminalMenuItem[] => {
    const items: TerminalMenuItem[] = [
      {
        id: 'copy',
        label: hasSel ? '复制选中' : '复制全部',
        icon: Copy,
        shortcut: 'Ctrl+Shift+C',
        onSelect: handleCopyAction,
      },
      {
        id: 'paste',
        label: '粘贴',
        icon: ClipboardPaste,
        shortcut: 'Ctrl+Shift+V',
        onSelect: () => void paste.pasteFromClipboard(),
      },
      {
        id: 'select-all',
        label: '全选',
        icon: TextSelect,
        separatorBefore: true,
        onSelect: () => {
          terminalRef.current?.selectAll()
          setHasSelection(true)
        },
      },
      {
        id: 'search',
        label: '查找',
        icon: Search,
        shortcut: 'Ctrl+F',
        onSelect: search.openSearch,
      },
      {
        id: 'clear',
        label: '清屏（仅本地视图）',
        icon: Eraser,
        separatorBefore: true,
        onSelect: () => {
          // 只清本地视口，不清远端 scrollback —— 免得用户以为把服务器输出删了
          terminalRef.current?.clear()
          goLive()
        },
      },
      {
        id: 'bottom',
        label: '回到底部',
        icon: ArrowDownToLine,
        disabled: !userScrolledUp,
        onSelect: goLive,
      },
    ]
    // 触屏设备：手指精确选字很难，保留"弹窗里挑文本再复制"这条路
    if (isCoarsePointer()) {
      items.splice(1, 0, {
        id: 'pick-copy',
        label: '选择并复制…',
        icon: TextSelect,
        onSelect: () => setTimeout(() => setSelectModalText(getTerminalAllText()), 50),
      })
    }
    return items
  }

  // ─── 长时间运行命令检测 ───
  const [longRunning, setLongRunning] = useState<{ lines: number; seconds: number } | null>(null)
  const outputTrackerRef = useRef({
    burstLines: 0,
    burstStart: 0,
    lastWriteTime: 0,
    checkTimer: null as ReturnType<typeof setTimeout> | null,
  })
  // 用 ref 避免 event handler 中的闭包过期
  const onConnectedRef = useRef(onConnected)
  const onDisconnectedRef = useRef(onDisconnected)
  useEffect(() => {
    onConnectedRef.current = onConnected
    onDisconnectedRef.current = onDisconnected
  }, [onConnected, onDisconnected])
  /** generation ID：每次 mount 递增，防止旧实例的异步回调污染新实例 */
  const genRef = useRef(0)
  // 每个终端独立的 WebSocket 客户端（用于 SSH I/O）
  const termWsRef = useRef<WsClient | null>(null)
  // 凭据 ref（避免 effect 依赖变化）
  const credentialsRef = useRef(credentials)
  // 用 ref 追踪连接状态，用于 credentials 就绪后重试
  const connectTerminalRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const prev = credentialsRef.current
    credentialsRef.current = credentials
    // 如果之前凭据为空且现在就绪了，触发连接
    // 同时允许重试（如果之前连接失败了，connectingRef 已重置为 false）
    if (!prev && credentials && connectTerminalRef.current) {
      connectTerminalRef.current()
    }
  }, [credentials])

  // ─── 移动端快捷键工具栏（固定在底部，不需要开关状态）──

  // ─── 移动端键盘弹出时自动滚动到光标 ──
  useEffect(() => {
    const vv = window.visualViewport
    const term = terminalRef.current
    if (!vv || !term) return

    let prevHeight = vv.height

    const handleResize = () => {
      const newHeight = vv.height
      // 键盘弹出时高度缩小 → 滚动到光标位置
      if (newHeight < prevHeight - 50) {
        setTimeout(() => {
          try {
            term.scrollToBottom()
          } catch {
            /* ignore */
          }
        }, 100)
      }
      prevHeight = newHeight
    }

    vv.addEventListener('resize', handleResize)
    return () => vv.removeEventListener('resize', handleResize)
  }, [])

  // 轻提示定时器清理
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    // 输出追踪对象引用（对象本身不重建，捕获一份供 cleanup 使用）
    const outputTracker = outputTrackerRef.current

    genRef.current += 1
    const gen = genRef.current
    disposedRef.current = false
    // 新连接（换主机/换标签）：重连状态与"建立过会话"的标记都从头开始
    sshEstablishedRef.current = false
    reconnectingRef.current = false
    reconnect.dismiss()
    // 重置滚动状态
    userScrolledUpRef.current = false
    setUserScrolledUp(false)
    setLongRunning(null)

    // 初始显示参数来自用户偏好（设置面板 / Ctrl± 改的都是这份；见 utils/terminal-prefs）
    const initialPrefs = prefsRef.current
    const term = new XTerm({
      cursorBlink: initialPrefs.cursorBlink,
      cursorStyle: initialPrefs.cursorStyle,
      fontSize: initialPrefs.fontSize,
      fontFamily: initialPrefs.fontFamily,
      lineHeight: initialPrefs.lineHeight,
      macOptionIsMeta: initialPrefs.macOptionIsMeta,
      theme: TERMINAL_THEME,
      allowTransparency: true,
      scrollback: initialPrefs.scrollback,
      tabStopWidth: 4,
      // 移动端优化
      screenReaderMode: false,
      disableStdin: false,
      allowProposedApi: true,
      // 给予初始 cols/rows 防止 Viewport 在 DOM 渲染前访问 undefined dimensions
      cols: 80,
      rows: 24,
      // 禁用平滑滚动，触摸滚动由自定义处理器控制
      smoothScrollDuration: 0,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    const container = containerRef.current
    term.open(container)

    // ─── GPU 加速渲染（WebGL2 → fallback canvas）───
    // WebGL 渲染器比默认 canvas 渲染器快 10x+，移动端滚动更流畅
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        // WebGL 上下文丢失时自动降级，避免白屏
        webgl.dispose()
      })
      term.loadAddon(webgl)
    } catch {
      // WebGL2 不可用（低端设备 / 隐私模式），使用默认 canvas 渲染
    }

    // ─── Unicode 11 宽字符支持 ───
    // 默认 unicode 版本对部分 CJK/Emoji 字符宽度计算不准确，
    // 导致光标偏移、行末截断。Unicode 11 修正了这些问题。
    try {
      const unicode11 = new Unicode11Addon()
      term.loadAddon(unicode11)
      term.unicode.activeVersion = '11'
    } catch {
      // 静默降级到默认 unicode 版本
    }

    // ─── 可点击链接（自实现 linkProvider，不引新依赖）───
    // 终端里的 URL 之前是一串死文本：想让用户能点开，只能手动选中再复制到浏览器。
    // 激活策略见 utils/terminal-links：桌面必须按 Ctrl/⌘（与 VS Code / ttyd 一致，
    // ─── 可点击链接（共享实现，见 utils/terminal-link-provider.ts）───
    const linkDisposable = registerTerminalLinks(term, showHint)

    // ─── 终端画布：逻辑尺寸与可视尺寸解耦（几何层面的根源修复）───
    // 可视区只是逻辑屏上的一扇窗：窗口偏移 W ∈ [0, 逻辑行数 − 可视行数]，
    // 渲染时把整块 xterm 元素上移 W 行高，容器 overflow:hidden 裁切。
    // 为什么这样做见 utils/terminal-canvas.ts 顶部（含 44×12 → 2383 行、
    // 44×30 → 0 行的实测数据）。
    let canvasOffset = 0
    let canvasFollow = true
    let canvasGrowRows = 0 // 自适应长出来的行数（只增不减）
    let canvasAlt = false // 备用屏（vim/less/htop）内保持 1:1
    let canvasRaf = 0
    let blockRunTotal = 0
    let blockRunSeenAt = 0
    let blockRunConfirmations = 0
    let canvasCapHinted = false // 「画布触顶」提示只给一次
    const cursorRunState = createCursorUpRunState()

    /**
     * 行高（px）。
     *
     * ⚠️ 必须用 `.xterm-screen`（它被 xterm 显式设成 `rows × 行高`），**不能**用
     * `.xterm-viewport`：viewport 是 `position:absolute; inset:0`，高度等于容器高，
     * 拿它 ÷ 逻辑行数，画布一开到 30 行就会算出「可视行数 = 30」，窗口永远缩不回去。
     */
    const canvasCellHeight = (): number => {
      const screen = container.querySelector('.xterm-screen') as HTMLElement | null
      if (screen && term.rows > 0 && screen.clientHeight > 0) return screen.clientHeight / term.rows
      return 0
    }

    /**
     * 可视行数 = 容器实际能放下几行。
     *
     * 首选 `FitAddon.proposeDimensions().rows`：它由容器像素高 ÷ 行高算出，**与
     * `term.rows`（可能已被画布抬到 30）无关**，就是"这扇窗有几行"。取不到时退回
     * 容器高 ÷ 行高（同样与逻辑行数无关）。
     */
    let canvasVisibleRowsCache = 0
    const canvasVisibleRows = (): number => {
      if (canvasVisibleRowsCache > 0) return canvasVisibleRowsCache
      const h = container.clientHeight
      const cellH = canvasCellHeight()
      if (h <= 0 || cellH <= 0) return Math.max(1, term.rows)
      return Math.max(1, Math.min(term.rows, Math.floor(h / cellH)))
    }

    /**
     * 目标逻辑行数。
     * 画布关 / 备用屏 / 搜索打开时 = 可视行数（与改造前一致）；
     * 否则 = max(可视行数, 30 或自适应值)。
     */
    const canvasTargetRows = (visibleRows: number): number => {
      if (!canvasOnRef.current || canvasAlt || showSearchRef.current) return visibleRows
      return resolveCanvasRows(visibleRows, Math.max(CANVAS_ROWS_FLOOR, canvasGrowRows))
    }

    /** 跟随光标：让光标落在窗口下沿（Ctrl+L / clear 后提示符回屏顶也看得见） */
    const canvasFollowOffset = (maxOffset: number, visibleRows: number): number => {
      const buf = term.buffer.active
      const cursorRow = buf.viewportY + buf.cursorY - buf.baseY
      return followWindowOffset(cursorRow, visibleRows, maxOffset)
    }

    /** 是否处于实时视图（决定自动滚底 + 是否显示「回到底部」按钮） */
    const syncScrolledUpState = () => {
      const buf = term.buffer.active
      const scrolled = !canvasFollow || buf.viewportY < buf.baseY
      if (scrolled !== userScrolledUpRef.current) {
        userScrolledUpRef.current = scrolled
        setUserScrolledUp(scrolled)
      }
    }

    /** 把窗口偏移写进 DOM（transform 不参与布局，FitAddon 的计算不受影响） */
    const canvasPaint = () => {
      const el = term.element
      if (!el || disposedRef.current) return
      const visibleRows = canvasVisibleRows()
      const maxOffset = maxWindowOffset(term.rows, visibleRows)
      if (maxOffset <= 0) {
        canvasOffset = 0
        canvasFollow = true
        if (el.style.transform) el.style.transform = ''
        return
      }
      const followOff = canvasFollowOffset(maxOffset, visibleRows)
      const buf = term.buffer.active
      if (!canvasFollow) {
        canvasOffset = clampWindowOffset(canvasOffset, maxOffset)
        if (
          isLiveBottom({
            offset: canvasOffset,
            followOffset: followOff,
            viewportY: buf.viewportY,
            baseY: buf.baseY,
          })
        ) {
          canvasFollow = true
          canvasOffset = followOff
        }
      } else {
        canvasOffset = followOff
      }
      el.style.transform =
        canvasOffset === 0 ? '' : `translateY(${-canvasOffset * canvasCellHeight()}px)`
    }

    /** rAF 合并：一帧内多次输出只重排一次 */
    const canvasSync = () => {
      if (canvasRaf || disposedRef.current) return
      canvasRaf = requestAnimationFrame(() => {
        canvasRaf = 0
        canvasPaint()
        syncScrolledUpState()
      })
    }

    /**
     * 平移窗口 / 滚历史。
     * 往更早内容翻：先平移窗口、平移到顶再滚 scrollback；
     * 反向：先滚 scrollback、到底再平移窗口 —— 两个方向都连续移动，且最老历史可达。
     */
    const canvasPan = (deltaLines: number) => {
      if (deltaLines === 0) return
      const maxOffset = maxWindowOffset(term.rows, canvasVisibleRows())
      const buf = term.buffer.active
      const step = panWindow({
        offset: canvasOffset,
        deltaLines,
        maxOffset,
        viewportY: buf.viewportY,
        baseY: buf.baseY,
      })
      canvasFollow = false
      canvasOffset = step.offset
      if (step.bufferScroll !== 0) term.scrollLines(step.bufferScroll)
      canvasSync()
    }

    /** 回到实时视图：跟随光标 + 贴底 */
    const canvasGoLive = () => {
      canvasFollow = true
      try {
        term.scrollToBottom()
      } catch {
        /* ignore */
      }
      canvasSync()
    }

    /** fit：逻辑行数 = max(可视行数, 画布行数)；列数依旧交给 FitAddon（与改造前一致） */
    const canvasRefit = () => {
      const c = containerRef.current
      if (!c || c.offsetWidth === 0 || c.offsetHeight === 0 || disposedRef.current) return
      if (gen !== genRef.current) return
      let proposed: { cols: number; rows: number } | undefined
      try {
        proposed = fitAddon.proposeDimensions()
      } catch {
        proposed = undefined
      }
      if (!proposed || !Number.isFinite(proposed.cols) || proposed.cols < 1) return
      if (!Number.isFinite(proposed.rows) || proposed.rows < 1) return
      // 先记下"可视行数"（此刻 proposed.rows 就是窗高），再按画布行数 resize
      canvasVisibleRowsCache = Math.max(1, Math.floor(proposed.rows))
      try {
        term.resize(proposed.cols, canvasTargetRows(proposed.rows))
      } catch {
        /* ignore */
      }
      canvasSync()
    }

    /**
     * 自适应增高：观察到"整块重画"的块高超过当前画布 → 把画布长高。
     * 同一块高连续出现两次才动手（避免一次性异常序列触发 resize），封顶且只增不减。
     */
    const canvasObserveBlock = (runTotal: number) => {
      if (!canvasOnRef.current || canvasAlt || runTotal <= 0) return
      const now = Date.now()
      if (
        blockRunTotal > 0 &&
        Math.abs(blockRunTotal - runTotal) <= 1 &&
        now - blockRunSeenAt <= CANVAS_GROW_MEMORY_MS
      ) {
        blockRunConfirmations += 1
      } else {
        blockRunConfirmations = 1
      }
      blockRunTotal = runTotal
      blockRunSeenAt = now
      const next = nextCanvasRowsForBlock({
        currentRows: term.rows,
        runTotal,
        confirmations: blockRunConfirmations,
      })
      if (next > 0) {
        canvasGrowRows = next
        canvasRefit()
        return
      }
      // 画布已顶到上限（80 行）而块还在长：几何层到此为止，给用户一条出路 ——
      // 否则用户只会看到重复行继续堆，却不知道右上角「显示」菜单里能改成逐行日志。
      if (!canvasCapHinted && isCanvasCappedOut({ currentRows: term.rows, runTotal })) {
        canvasCapHinted = true
        showHint('进度块太高，画面放不下了：打开右上「显示」→ 开启「日志逐行输出」')
      }
    }

    /**
     * 强制重算几何：`canvasVisibleRowsCache` 存的是"这扇窗有几行"，它由**行高**推出 ——
     * 字号/行高变了以后这个缓存必然过期（不清就会按旧行高算窗口平移量）。
     * 偏好变更（设置面板 / Ctrl±）走这里；容器尺寸变化走 `canvasRefit`（缓存可复用）。
     */
    const canvasHardRefit = () => {
      canvasVisibleRowsCache = 0
      canvasRefit()
    }

    canvasCtlRef.current = { refit: canvasHardRefit, goLive: canvasGoLive }

    // 备用屏（vim / less / htop / fzf 的 smcup）自动 1:1：全屏程序按可视尺寸渲染，
    // 行为与改造前一致，不受画布影响。
    const bufferChangeDisposable = term.buffer.onBufferChange((buf) => {
      const nextAlt = buf.type === 'alternate'
      if (nextAlt === canvasAlt) return
      canvasAlt = nextAlt
      // 回调发生在 term.write 解析过程中，延后一帧再 resize，避免写入中途重入
      requestAnimationFrame(() => {
        if (!disposedRef.current) canvasRefit()
      })
    })

    // ─── 阻止终端容器的默认浏览器行为 ───
    // 长按方向键时浏览器可能触发右键菜单或文本选择
    const preventContextMenu = (e: Event) => e.preventDefault()
    const preventSelectStart = (e: Event) => e.preventDefault()
    container.addEventListener('contextmenu', preventContextMenu)
    container.addEventListener('selectstart', preventSelectStart)

    // ⚠️ xterm.js 内部元素会覆盖容器的事件阻止
    // 需要直接在 xterm-screen 和 xterm-viewport 上也注册
    const xtermScreen = container.querySelector('.xterm-screen') as HTMLElement | null
    const xtermViewport = container.querySelector('.xterm-viewport') as HTMLElement | null
    xtermScreen?.addEventListener('contextmenu', preventContextMenu)
    xtermViewport?.addEventListener('contextmenu', preventContextMenu)
    xtermScreen?.addEventListener('selectstart', preventSelectStart)
    xtermViewport?.addEventListener('selectstart', preventSelectStart)

    // ─── 自动滚动管理：检测用户是否在查看历史 ───
    const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null
    const checkScrollPosition = () => {
      // 画布开启时"是否在实时视图"由窗口状态决定（见 syncScrolledUpState），
      // 这里只负责把 viewport 自身滚动（桌面滚轮 / 滚动条）也纳入判断。
      syncScrolledUpState()
    }
    viewport?.addEventListener('scroll', checkScrollPosition)
    // xterm 6 的滚动条是自绘的 ScrollableElement，桌面滚轮滚回历史时**不一定**在
    // .xterm-viewport 上派发 DOM scroll 事件；只挂 DOM 监听会出现：滚轮看历史时
    // 「回到底部」按钮不出现、新输出还把用户拽回底部（改造前就有）。用 xterm 自己的
    // onScroll 兜底，滚动状态才准。
    const scrollDisposable = term.onScroll(() => syncScrolledUpState())

    // ─── 自定义触摸滚动处理器（含惯性滚动） ───
    // xterm.js 的 .xterm-screen 覆盖在 .xterm-viewport 之上，
    // 触摸事件被 screen 层拦截，无法到达 viewport 的滚动机制。
    // 通过 JS 直接处理触摸事件并调用 term.scrollLines() 解决。
    let touchLastY = 0
    let touchStartY = 0
    let touchAccumulator = 0
    let touchVelocity = 0
    let lastTouchTime = 0
    let momentumRafId = 0
    let isScrolling = false

    /**
     * 动态获取当前行高（像素）。
     * ⚠️ 用 canvasCellHeight()（`.xterm-screen` 像素高 ÷ 逻辑行数）。
     * 不能用 `.xterm-viewport`：画布开启时它等于容器高，÷30 会把行高算小 2.5 倍，
     * 触摸滚动就会快 2.5 倍。
     */
    const getRowHeight = (): number => {
      const cell = canvasCellHeight()
      return cell > 0 ? cell : 16
    }

    /** 按像素滚动（支持亚行精度）：画布开启时优先平移窗口，到顶再滚 scrollback */
    const scrollByPixels = (px: number) => {
      const rowHeight = getRowHeight()
      touchAccumulator += px
      const linesToScroll = Math.trunc(touchAccumulator / rowHeight)
      if (linesToScroll !== 0) {
        // 手指下滑 → px 正 → 查看更早内容 → deltaLines 取负
        canvasPan(-linesToScroll)
        touchAccumulator -= linesToScroll * rowHeight
      }
    }

    /** 惯性滚动动画 */
    const momentumScroll = () => {
      if (Math.abs(touchVelocity) < 0.5) {
        touchVelocity = 0
        return
      }
      scrollByPixels(touchVelocity)
      touchVelocity *= 0.92 // 摩擦系数
      momentumRafId = requestAnimationFrame(momentumScroll)
    }

    const handleTouchStart = (e: TouchEvent) => {
      // 停止惯性滚动
      cancelAnimationFrame(momentumRafId)
      touchVelocity = 0
      isScrolling = false

      const touch = e.touches[0]
      if (touch) {
        touchLastY = touch.clientY
        touchStartY = touch.clientY
      }
      touchAccumulator = 0
      lastTouchTime = Date.now()
    }

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return

      const deltaY = touch.clientY - touchStartY

      // 只有滑动超过阈值才认定为滚动（防止误判 tap 为 scroll）
      if (!isScrolling && Math.abs(deltaY) > 8) {
        isScrolling = true
      }

      if (isScrolling) {
        e.preventDefault() // 仅在滚动时阻止默认行为（保留 tap 的 click 事件）

        const moveDelta = touch.clientY - touchLastY
        const now = Date.now()
        const dt = Math.max(1, now - lastTouchTime)

        // 计算瞬时速度（像素/帧，假设 60fps ≈ 16.7ms/帧）
        touchVelocity = (moveDelta / dt) * 16.7

        touchLastY = touch.clientY
        lastTouchTime = now

        scrollByPixels(moveDelta)
      }
    }

    const handleTouchEnd = () => {
      if (isScrolling) {
        // 启动惯性滚动
        if (Math.abs(touchVelocity) > 1) {
          momentumRafId = requestAnimationFrame(momentumScroll)
        }
      }
      isScrolling = false
      touchAccumulator = 0
    }

    // 使用 { passive: false } 以允许 preventDefault
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })

    // ─── 长按检测：长按 500ms 弹出浮动上下文菜单 ───
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressTouchX = 0
    let longPressTouchY = 0

    // 合并到 handleTouchStart 中（已注册 non-passive），在非滚动时 preventDefault 阻止浏览器默认长按行为
    // 注意：不能在 passive listener 中 preventDefault，所以这里直接在已有的 touchstart handler 中处理
    // 但 handleTouchStart 已注册为 passive: true，无法 preventDefault
    // 因此我们用一个新的 non-passive touchstart handler 专门处理长按阻止

    const handleLongPressStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch) return
      longPressTouchX = touch.clientX
      longPressTouchY = touch.clientY

      // 不在 touchstart 阻止默认行为（会阻止 click/focus）
      // 改为在 contextmenu 事件中阻止（长按后浏览器会触发 contextmenu）

      longPressTimer = setTimeout(() => {
        // 先用 selection API 尝试选中触碰位置的文本
        try {
          const range = document.caretRangeFromPoint(touch.clientX, touch.clientY)
          if (range) {
            const selection = window.getSelection()
            if (selection) {
              selection.removeAllRanges()
              selection.addRange(range)
            }
          }
        } catch {
          // caretRangeFromPoint 不可用
        }
        // 检查 xterm selection（用户可能通过 selection API 选中了文本）
        const selection = term.getSelection()
        const hasSelection = !!(selection && selection.trim())
        setContextMenu({
          x: longPressTouchX,
          y: longPressTouchY,
          items: buildTerminalMenuItems(hasSelection),
        })
      }, 500)
    }
    const handleLongPressMove = (e: TouchEvent) => {
      if (longPressTimer && e.touches[0]) {
        const touch = e.touches[0]
        const dx = touch.clientX - longPressTouchX
        const dy = touch.clientY - longPressTouchY
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          clearTimeout(longPressTimer)
          longPressTimer = null
        }
      }
    }
    const handleLongPressEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }
    container.addEventListener('touchstart', handleLongPressStart, { passive: true })
    container.addEventListener('touchmove', handleLongPressMove, { passive: true })
    container.addEventListener('touchend', handleLongPressEnd, { passive: true })
    container.addEventListener('touchcancel', handleLongPressEnd, { passive: true })

    // ─── 桌面端：监听文本选区变化，选中时浮现复制按钮 ───
    const handleSelectionChange = () => {
      const sel = window.getSelection()
      const text = sel?.toString() || ''
      setHasSelection(text.trim().length > 0)
    }
    document.addEventListener('selectionchange', handleSelectionChange)

    // ─── 选中即复制（偏好项，默认关）───
    // 走自家的 safeWriteClipboard 而不是 xterm 内部复制：HTTP 页面 / 移动 WebView 里
    // navigator.clipboard 可能不存在，需要 execCommand 兜底（见文件顶部）。
    const selectionDisposable = term.onSelectionChange(() => {
      if (!prefsRef.current.copyOnSelect) return
      const sel = term.getSelection()
      if (sel) void safeWriteClipboard(sel)
    })

    // 延迟执行 fit 确保容器已渲染
    const fitTimer = setTimeout(() => {
      canvasRefit()
    }, 50)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // 跨 WebSocket 分片拼接未完成 ESC/CSI；光标序列原样交给 xterm.js
    const ansiBuf = new AnsiStreamBuffer()

    // ─── 输出追踪：检测长时间运行的命令 ───
    const trackOutput = (data: string) => {
      const tracker = outputTrackerRef.current
      const now = Date.now()
      const lineCount = (data.match(/\r?\n/g) || []).length + 1

      if (!tracker.burstStart || now - tracker.lastWriteTime > 3000) {
        tracker.burstLines = lineCount
        tracker.burstStart = now
      } else {
        tracker.burstLines += lineCount
      }
      tracker.lastWriteTime = now

      if (!tracker.checkTimer) {
        tracker.checkTimer = setTimeout(() => {
          tracker.checkTimer = null
          if (disposedRef.current || gen !== genRef.current) return
          const elapsed = (Date.now() - tracker.burstStart) / 1000
          const idle = Date.now() - tracker.lastWriteTime > 3000
          if (idle || tracker.burstLines < 50) {
            setLongRunning(null)
            tracker.burstLines = 0
            tracker.burstStart = 0
          } else if (elapsed >= 5 && tracker.burstLines / elapsed > 100) {
            setLongRunning({ lines: tracker.burstLines, seconds: Math.floor(elapsed) })
          } else {
            setLongRunning(null)
          }
        }, 2000)
      }
    }

    const writePty = (chunk: string) => {
      const ready = ansiBuf.push(chunk)
      if (!ready || disposedRef.current) return
      // 探测"整块重画"（连续回移光标累计行数 = 块高 − 1）：块高超过画布就把画布长高。
      // 只做识别，不改写输出 —— 误判最坏是多一次 resize，绝不丢数据。
      const runTotal = scanCursorUpRuns(ready, cursorRunState)
      if (runTotal > 0) canvasObserveBlock(runTotal)
      term.write(ready, () => {
        canvasSync()
        if (!userScrolledUpRef.current && !disposedRef.current) {
          term.scrollToBottom()
        }
      })
      trackOutput(ready)
    }

    // ─── 创建独立 WebSocket 连接用于此终端 ───
    // 后端 handle_terminal_connect 会阻塞整个 WS 主循环，
    // 因此每个终端必须有自己的 WS 连接以支持多主机同时连接。
    const initTerminalConnection = async () => {
      if (gen !== genRef.current) return
      // 防止重复连接
      if (connectingRef.current || connectedRef.current) return

      const creds = credentialsRef.current
      if (!creds) {
        term.write('\r\x1b[2K\x1b[33m[等待凭据] 连接凭据尚未就绪，等待中...\x1b[0m\r\n')
        return
      }

      connectingRef.current = true
      term.write('\r\x1b[2K')
      console.log(`[Terminal] initTerminalConnection started for ${creds.host}:${creds.port}`)

      // 前端 SSH 连接超时检测（后端 15s 超时，前端给 20s 容差）
      const sshTimeout = setTimeout(() => {
        if (connectingRef.current && !connectedRef.current && gen === genRef.current) {
          connectingRef.current = false
          if (!disposedRef.current) {
            term.write(
              '\r\n\x1b[31m[超时] SSH 连接超时，请检查主机地址、端口和凭据是否正确\x1b[0m\r\n',
            )
            console.error(`[Terminal] SSH connection timeout for ${creds.host}`)
            if (reconnectingRef.current) {
              // 自动重连期间超时（远端还在重启之类）→ 继续退避重试，不要停下
              reconnect.notifyAttemptFailed()
            } else {
              reconnect.notifyLost('error', 'SSH 连接超时（检查主机/端口/凭据）')
            }
          }
        }
      }, 20_000)

      try {
        console.log('[Terminal] Creating session WS client (short-lived ws token)...')
        // 关掉上一个 WsClient：它自带退避重连，不关的话会在后台一直重连（僵尸连接）
        termWsRef.current?.disconnect()
        const termWs = createSessionWsClient('/ws')
        console.log(
          `[Terminal] Created WsClient, URL: ${termWs['url'].split('?')[0]}, status=${termWs['status']}`,
        )
        termWsRef.current = termWs

        // 注册事件处理器（在连接前注册，确保不遗漏）
        termWs.on('data', (msg) => {
          if (msg.connectionId !== connectionId) return

          // 处理 SSH 连接成功消息（通过 dispatch 的 type:"connected" 路由）
          // 注意：此 handler 只会收到 type:"data" 的消息，
          // SSH 连接成功消息通过 termWs.on('connected') 处理
          if (msg.type === 'connected') {
            clearTimeout(sshTimeout)
            connectingRef.current = false
            connectedRef.current = true
            // SSH 连接成功后，执行 fit 调整终端尺寸
            setTimeout(() => {
              if (gen === genRef.current) canvasRefit()
            }, 50)
            return
          }

          // 过滤后端非关键错误（如 "Unknown message type"），
          // 但 SSH 连接/认证错误必须展示给用户
          if (msg.type === 'error') {
            const errMsg = (msg.message as string) || (msg.data as string) || '连接失败'
            if (errMsg.includes('Unknown message type')) return
            // SSH 错误：重置连接状态，允许重试
            clearTimeout(sshTimeout)
            connectingRef.current = false
            if (gen === genRef.current && !disposedRef.current) {
              term.write(`\r\n\x1b[31m[错误] ${errMsg}\x1b[0m\r\n`)
              if (reopenTimeoutRef.current) clearTimeout(reopenTimeoutRef.current)
              if (reconnectingRef.current) reconnect.notifyAttemptFailed()
              else reconnect.notifyLost('error', errMsg)
            }
            return
          }

          const raw = msg.data as string
          try {
            writePty(decodeURIComponent(escape(atob(raw))))
          } catch {
            writePty(raw)
          }
        })

        termWs.on('connected', () => {
          // SSH 连接成功 ack（dispatch type:"connected"）
          console.log('[Terminal] ✅ termWs.on("connected") fired!')
          clearTimeout(sshTimeout)
          if (reopenTimeoutRef.current) clearTimeout(reopenTimeoutRef.current)
          connectingRef.current = false
          connectedRef.current = true
          const wasReconnect = reconnectingRef.current
          reconnectingRef.current = false
          sshEstablishedRef.current = true
          reconnect.notifyConnected()
          // 清除 [连接中] 提示行，替换为 [已连接] 确认
          if (!disposedRef.current) {
            ansiBuf.reset()
            if (wasReconnect) {
              // 重连：上一次会话的输出对用户还有用，不能清屏，只加一条分隔
              term.write('\r\n\x1b[33m[已重新连接 · 上一次会话的输出保留在上面]\x1b[0m\r\n')
            } else {
              // 首次连接：清除 [连接中] 等状态行，让 SSH banner/prompt 从第一行开始
              term.clear()
            }
            if (canvasCtlRef.current) canvasCtlRef.current.goLive()
            else term.scrollToBottom()
          }
          term.focus()
          onConnectedRef.current?.()
          // 新会话的环境变量不会自动带过来：把「安静进度」变量组重新注入一次。
          // （只在开关打开时才注入；开关默认跟随画布 —— 画布开着就不注入，
          //   富进度 UI 在几何层已经不堆行，见 quiet-env 的 defaultQuietProgress。）
          //
          // ⚠️ 这等于"替用户打字"，所以必须先确认他正坐在 shell 提示符上：
          //   · 全屏 TUI（vim/htop/less → xterm alternate buffer）里注入会打进 TUI；
          //   · ssh/sudo 密码提示里注入会把命令行当密码敲进去。
          // 因此改为轮询探测提示符：探测不到就**不注入**，只给一次提示，
          // 用户可随时在右上「显示」菜单里手动开启（功能不会因此丢失）。
          userTypedRef.current = false
          if (plainInjectTimerRef.current) clearTimeout(plainInjectTimerRef.current)
          if (composePlainRef.current) {
            const MAX_TRIES = 15
            const RETRY_MS = 600
            const tryInject = (n: number) => {
              plainInjectTimerRef.current = null
              if (disposedRef.current || !connectedRef.current || gen !== genRef.current) return
              if (!composePlainRef.current) return
              if (userTypedRef.current) {
                showHint('日志逐行输出未自动开启（你正在输入）· 打开右上「显示」可手动开启')
                return
              }
              const t = terminalRef.current
              if (!t) return
              if (!isAtShellPrompt(t.buffer.active)) {
                // TUI 里 / 提示符还没打出来：等下一轮；超时后只提示，绝不硬注入
                if (n < MAX_TRIES) {
                  plainInjectTimerRef.current = setTimeout(() => tryInject(n + 1), RETRY_MS)
                } else {
                  showHint(
                    '未检测到 shell 提示符，日志逐行输出未自动开启 · 打开右上「显示」可手动开启',
                  )
                }
                return
              }
              termWsRef.current?.send({
                type: 'exec',
                connectionId,
                data: encodePtyLine(buildQuietProgressExportLine()),
              })
              // 首次自动注入时说明一下默认行为（老用户会注意到变化）
              try {
                if (localStorage.getItem('wrench_ssh_plain_hint_shown') !== '1') {
                  localStorage.setItem('wrench_ssh_plain_hint_shown', '1')
                  showHint(
                    '已开启日志逐行输出（docker compose / buildkit）：终端行数不足时动画进度块会重复堆叠 · 打开右上「显示」可恢复动画',
                  )
                }
              } catch {
                /* ignore */
              }
            }
            plainInjectTimerRef.current = setTimeout(() => tryInject(0), 250)
          }
        })

        /**
         * 在**同一个 WS** 上（重）发一次 SSH connect。防重复：已经连上 / 有尝试在飞就返回 false。
         * 轻量重连的价值：省一次 WS 握手与令牌刷新，也不会让旧 WsClient 留在后台退避。
         */
        const resendConnect = (force = false) => {
          // force=true：本次调用就是「这一代 WS 的第一次连接」，只防"已经有会话了"，
          // 不查 connectingRef —— 因为 initTerminalConnection 在发起连接前就把它置 true 了
          // （见本函数上方 onStatus 里 initialConnectSent 的注释）。
          if (force) {
            if (connectedRef.current) return false
          } else if (connectedRef.current || connectingRef.current) return false
          connectingRef.current = true
          connectedRef.current = false
          termWs.send({
            type: 'connect',
            connectionId,
            host: creds.host,
            port: creds.port,
            username: creds.username,
            password: creds.password || '',
            privateKey: creds.privateKey || '',
            sudoPassword: creds.sudoPassword || '',
            cols: term.cols,
            rows: term.rows,
          })
          return true
        }

        /**
         * 自动重连真正干活的地方（batch 2b ②）：倒计时到点后由 hook 调过来。
         * - WS 还活着（WS 重连成功、或只是 SSH 通道断了）→ 重发 connect，25s 没连上就继续退避；
         * - WS 也没了（WsClient 自己放弃了 / 令牌过期）→ 完整重连（新 WsClient + 新令牌），
         *   超时由 initTerminalConnection 里的 20s 兜底继续退避。
         */
        const reopenSession = () => {
          if (disposedRef.current || gen !== genRef.current) return
          reconnectingRef.current = true
          if (termWs.status === 'connected') {
            if (reopenTimeoutRef.current) clearTimeout(reopenTimeoutRef.current)
            reopenTimeoutRef.current = setTimeout(() => {
              reopenTimeoutRef.current = null
              if (disposedRef.current || gen !== genRef.current) return
              if (!connectedRef.current) {
                connectingRef.current = false
                reconnect.notifyAttemptFailed()
              }
            }, 25_000)
            resendConnect()
            return
          }
          // WS 也没了：放开闸门走完整重连
          connectingRef.current = false
          connectedRef.current = false
          void initTerminalConnection()
        }
        reopenSessionRef.current = reopenSession

        termWs.on('disconnected', (msg) => {
          clearTimeout(sshTimeout)
          if (reopenTimeoutRef.current) clearTimeout(reopenTimeoutRef.current)
          connectingRef.current = false
          connectedRef.current = false
          if (!disposedRef.current) {
            term.write('\r\n\x1b[31m[连接已断开]\x1b[0m\r\n')
            // 后端现在带 reason：exit = 用户自己敲的退出（不自动重开），closed = 掉线（自动重连）
            reconnect.notifyLost(normalizeDisconnectReason((msg as { reason?: unknown })?.reason))
          }
          onDisconnectedRef.current?.()
        })

        termWs.on('error', (msg) => {
          // 静默忽略 "Unknown message type" 错误（SSH 断开后后端主循环拒绝消息）
          const errMsg = (msg.message as string) || ''
          if (errMsg.includes('Unknown message type')) return
          // 重置连接状态，允许重试
          clearTimeout(sshTimeout)
          connectingRef.current = false
          if (reopenTimeoutRef.current) clearTimeout(reopenTimeoutRef.current)
          if (!disposedRef.current) {
            term.write(`\r\n\x1b[31m[错误] ${errMsg || '未知错误'}\x1b[0m\r\n`)
            if (reconnectingRef.current) reconnect.notifyAttemptFailed()
            else reconnect.notifyLost('error', errMsg || '未知错误')
          }
        })

        // 连接 WebSocket（令牌由 createSessionWsClient 在每次连接前自动刷新）
        console.log('[Terminal] Connecting WebSocket to /ws')
        // 先注册 onStatus handler，再 connect()，避免错过 'connected' 状态
        // （某些浏览器 onopen 可能在微任务内同步触发，connect 后再注册 handler 会丢失事件）
        console.log(`[Terminal] register onStatus, current ws status: ${termWs['status']}`)
        // ⚠️ 使用 ref 包裹 unsub 避免 TDZ 问题：
        // onStatus 在注册时会同步触发 handler（用当前状态），
        // 而 handler 内需要调用 unsub()，但 const unsub 尚未赋值。
        // 通过 ref 间接引用，绕过 const 的时域死区（Temporal Dead Zone）。
        const unsubRef: { current: (() => void) | null } = { current: null }
        // ⚠️ onStatus 注册时会同步用当前状态调用 handler，
        // 新建 WsClient 状态为 'disconnected'（初始值），这不是真正的断连。
        // 用 startedRef 跳过首次同步回调，只处理 connect() 之后的真实状态变化。
        let startedRef = false
        // 这一代 WS 是否已经发过「初始连接」的 connect。
        // ⚠️ 不能拿 connectingRef 当这个判据：initTerminalConnection 在调用 termWs.connect()
        // 之前就把它置成了 true，而 WS 的 onStatus('connected') 是之后才回调的 ——
        // 用 connectingRef 判会把**初始连接自己**挡掉，后端根本收不到 connect，
        // 用户只看到 20s 后的「[超时] SSH 连接超时」（2026-09-16 在临时实例上实测复现）。
        let initialConnectSent = false
        const unsub = termWs.onStatus((status) => {
          console.log(`[Terminal] onStatus: ${status}`)
          if (status === 'connected') {
            // 注意：这里**不再 unsub**。WsClient 自己会把掉线的 WS 重连回来，
            // 而「WS 通了」不等于「SSH 会话回来了」—— 保持订阅才能在那之后重开会话，
            // 这也是掉线后最快的一条恢复路（不用等倒计时走到下一档）。
            if (gen !== genRef.current) return
            const recovery = sshEstablishedRef.current
            if (!recovery) {
              // 初始连接：这一代 WS 只发一次
              if (initialConnectSent || connectedRef.current) {
                console.log('[Terminal] onStatus: connected（初始连接已发过/已有会话，跳过）')
                return
              }
              initialConnectSent = true
              console.log(
                `[Terminal] ✅ WS connected, sending initial SSH connect to ${creds.host}:${creds.port}`,
              )
              resendConnect(true)
              return
            }
            // 断线恢复：走原来的防重复判据（有会话/有连接在飞就跳过）
            if (connectedRef.current || connectingRef.current) {
              console.log(
                '[Terminal] onStatus: connected（恢复期已有会话/连接在飞，跳过重复 connect）',
              )
              return
            }
            reconnectingRef.current = true
            reconnect.markAttempting()
            term.write('\r\n\x1b[33m[网络恢复 · 正在重新建立 SSH 会话…]\x1b[0m\r\n')
            console.log(
              `[Terminal] ✅ WS connected, sending SSH connect to ${creds.host}:${creds.port}`,
            )
            resendConnect()
          } else if (status === 'disconnected') {
            if (!startedRef) {
              // 初始状态同步回调，忽略——connect() 还没调用
              console.log(`[Terminal] onStatus: disconnected (initial, skipping)`)
              return
            }
            // 这里**不能 unsub**：WsClient 自己会把 WS 重连回来，我们还要靠这个 handler
            // 在它恢复时重开 SSH 会话（unsub 在 effect 清理时做）。
            clearTimeout(sshTimeout)
            const lastErr = termWs.lastError || '未知原因'
            console.error(
              `[Terminal] WebSocket disconnected — host: ${creds.host}, error: ${lastErr}`,
            )
            // WS 连接失败：重置状态，允许重试
            connectingRef.current = false
            // ⚠️ 必须同时清掉 connectedRef：SSH 会话是绑在这条 WS 上的，
            // 传输层断了会话就没了。不清的话后面每一条恢复路径都被它挡住 ——
            // 快路径（WS 重连成功 → onStatus('connected') 的恢复分支）走不到，
            // 倒计时里 reopenSession() 的 resendConnect() 也会被挡，
            // 结果 WS 明明恢复了却再也建不起会话（只能刷页面）。
            // 语义与下面 termWs.on('disconnected') 里的一致（那里也是这么清的）。
            connectedRef.current = false
            if (!disposedRef.current) {
              term.write(`\r\n\x1b[31m[WebSocket 连接失败] ${lastErr}\x1b[0m\r\n`)
              // WS 断开是传输层的事：WsClient 自己会退避重连，我们负责在那之后把 SSH 会话重开
              reconnect.notifyLost('closed', `连接中断：${lastErr}`)
            }
            onDisconnectedRef.current?.()
          }
        })
        unsubRef.current = unsub

        // 注册完毕后再连接（新一代 WS ⇒ 初始连接标记复位）
        initialConnectSent = false
        startedRef = true
        console.log(`[Terminal] Calling termWs.connect()...`)
        termWs.connect()
      } catch (err) {
        clearTimeout(sshTimeout)
        if (gen !== genRef.current) return
        connectingRef.current = false
        const msg = err instanceof Error ? err.message : '获取认证令牌失败'
        term.write(`\r\n\x1b[31m[错误] ${msg}\x1b[0m\r\n`)
      }
    }

    // 将 initTerminalConnection 暴露给 credentials ref effect 用于重试
    connectTerminalRef.current = initTerminalConnection

    // 如果凭据已就绪，立即连接；否则等待 credentials ref effect 触发
    if (credentialsRef.current) {
      initTerminalConnection()
    }

    // ─── 快捷键注册 ───
    // Ctrl+C: 选中文本时复制，未选中时发送 SIGINT
    // Ctrl+V / Shift+Insert: 粘贴
    // Ctrl+Shift+C: 强制复制 / Ctrl+Shift+V: 强制粘贴
    term.attachCustomKeyEventHandler((e) => {
      const { key, ctrlKey, shiftKey, altKey, metaKey, type } = e

      // Ctrl/⌘ + `+`/`=`/`-`/`0` → 字号缩放（`0` 复位）。
      // 终端里最常见的"看不清/太挤"自救操作，之前只能去改浏览器缩放（会连整个界面一起变）。
      if (type === 'keydown' && (ctrlKey || metaKey) && !altKey) {
        if (key === '=' || key === '+') {
          changeFontSize(FONT_SIZE_STEP)
          return false
        }
        if (key === '-' || key === '_') {
          changeFontSize(-FONT_SIZE_STEP)
          return false
        }
        if (key === '0') {
          changeFontSize('reset')
          return false
        }
      }

      // Ctrl+Shift+C → 复制选中文本
      if (type === 'keydown' && ctrlKey && shiftKey && key.toLowerCase() === 'c') {
        const selection = term.getSelection()
        if (selection) {
          safeWriteClipboard(selection)
          term.clearSelection()
        }
        return false // 阻止发送到终端
      }

      // Ctrl+Shift+A → 全选并复制全部终端内容
      if (type === 'keydown' && ctrlKey && shiftKey && key.toLowerCase() === 'a') {
        term.selectAll()
        const allText = term.getSelection()
        term.clearSelection()
        if (allText) {
          safeWriteClipboard(allText)
        }
        return false
      }

      // Ctrl+Shift+V → 粘贴（走统一入口：读得到就读，读不到就开粘贴框）
      if (type === 'keydown' && ctrlKey && shiftKey && key.toLowerCase() === 'v') {
        void paste.pasteFromClipboard()
        return false
      }

      // Ctrl+C → 有选中则复制，否则放行（终端发 SIGINT）
      if (type === 'keydown' && ctrlKey && !shiftKey && key.toLowerCase() === 'c') {
        const selection = term.getSelection()
        if (selection) {
          safeWriteClipboard(selection)
          term.clearSelection()
          return false // 阻止 SIGINT
        }
        return true // 放行给终端（发送 SIGINT）
      }

      // Ctrl+V → **放行给浏览器原生粘贴**（batch 2b ①）：
      // HTTP 部署下 `navigator.clipboard` 是 undefined（规范里的 [SecureContext]），
      // 自己读剪贴板必然失败；而浏览器的 paste 事件不受安全上下文限制，
      // xterm 自己就把原生 paste 处理好（含远端 bracketed paste 包裹）。
      // 唯一残留：xterm 会按默认动作先发一个 0x16(^V)，由 onData 精确丢掉（见 pendingPasteKeystrokeRef）。
      if (type === 'keydown' && ctrlKey && !shiftKey && !altKey && key.toLowerCase() === 'v') {
        pendingPasteKeystrokeRef.current = true
        return true
      }

      // Shift+Insert → 粘贴（X11 习惯键，浏览器没有原生粘贴，走统一入口）
      if (type === 'keydown' && !ctrlKey && shiftKey && key === 'Insert') {
        void paste.pasteFromClipboard()
        return false
      }

      // 🔧 关键修复：Backspace/Delete — 直接发送到服务端，不经过 term.input()
      // term.input() 会同时做两件事：(1) 触发 onData 发送到服务端
      // (2) 调用 parser.parse() 在本地解析处理（移动光标、修改缓冲区）
      // 本地处理 + 服务端回显 = 双重操作，导致字符重叠
      // 解决方案：跳过 term.input()，直接通过 WebSocket 发送到服务端，
      // 由服务端回显驱动终端显示更新
      //
      // 🔧 二次修复：移动端虚拟键盘会同时触发 keydown 和 onData，
      // 导致删除字符被发送两次（keydown 拦截一次 + onData 又一次）。
      // 解决方案：keydown 拦截后记录「本次删除序列 + 时间戳」，
      // onData 处理器只对同字节且同窗口内的第二条通路跳过（见 utils/terminal-delete-dedup.ts）。
      if (
        type === 'keydown' &&
        !ctrlKey &&
        !shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        (key === 'Backspace' || key === 'Delete')
      ) {
        const char = key === 'Backspace' ? '\x7f' : '\x1b[3~'
        // 直接发送到服务端，不调用 term.input() 避免 xterm.js 本地解析
        const encoded = btoa(unescape(encodeURIComponent(char)))
        termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
        onTerminalData?.(encoded)
        // 标记"这次删除已经发过了"：只对同字节且落在时间窗内的第二条通路生效，
        // 不会像旧的裸布尔那样吞掉用户后面输入的第一个字符
        pendingDeleteRef.current = markDeleteSent(char, Date.now())
        return false
      }

      return true
    })

    term.onData((data) => {
      // 🔧 防止 Backspace/Delete 被重复发送（第二通路）：只有**同一个删除序列**
      // 且落在时间窗内才丢弃；其它字符一律放行 —— 旧实现无条件吞下一条数据，
      // 桌面端会把用户紧接着输入的第一个字符吃掉（表现为"打字不显示"）。
      if (pendingDeleteRef.current) {
        const dup = isDuplicateDelete(pendingDeleteRef.current, data, Date.now())
        pendingDeleteRef.current = null
        if (dup) return
      }
      // 🔧 粘贴（batch 2b ①）：Ctrl+V 放行给浏览器原生粘贴后，xterm 会先送一个 ^V
      // （readline 会把它当 quoted-insert 吃掉粘贴内容的第一个字符）。只丢这一个字符，
      // 随后浏览器 paste 事件带来的正文照常通过。
      if (pendingPasteKeystrokeRef.current) {
        pendingPasteKeystrokeRef.current = false
        if (data === '\x16') return
      }
      // 用户在本次连接里敲过键 → 自动注入不再打扰他（见 on('connected') 里的 plain 注入）
      userTypedRef.current = true
      // 用户输入时自动滚到底部，确保看到命令输出
      userScrolledUpRef.current = false
      setUserScrolledUp(false)
      // 将用户输入以 base64 编码发送
      const encoded = btoa(unescape(encodeURIComponent(data)))
      termWsRef.current?.send({
        type: 'exec',
        connectionId,
        data: encoded,
      })
      // 命令同步：广播到同组其他分屏
      onTerminalData?.(encoded)
    })

    // 监听来自命令页"再次执行"的事件
    const unsubTerminal = on('wrench:send-to-terminal', ({ command }) => {
      if (command && termWsRef.current) {
        // 追加换行符模拟回车
        const text = command + '\n'
        const encoded = btoa(unescape(encodeURIComponent(text)))
        termWsRef.current.send({ type: 'exec', connectionId, data: encoded })
        onTerminalData?.(encoded)
      }
    })
    // Resize 监听 — 只有尺寸真正变化时才 fit，避免清空内容
    let lastFitWidth = 0
    let lastFitHeight = 0
    const observer = new ResizeObserver(() => {
      if (gen !== genRef.current) return
      requestAnimationFrame(() => {
        if (gen !== genRef.current) return
        const c = containerRef.current
        if (!c || c.offsetWidth === 0 || c.offsetHeight === 0) return
        // 只有尺寸真正变化时才 fit
        if (c.offsetWidth === lastFitWidth && c.offsetHeight === lastFitHeight) return
        lastFitWidth = c.offsetWidth
        lastFitHeight = c.offsetHeight
        canvasRefit()
      })
    })
    observer.observe(container)

    // 发送 resize 到后端
    term.onResize(({ cols, rows }) => {
      termWsRef.current?.send({
        type: 'resize',
        connectionId,
        cols,
        rows,
      })
    })

    // ─── 搜索快捷键 ───
    // · Ctrl+Shift+F：全局（保持改造前的行为，快捷键帮助里就是这么写的）
    // · Ctrl/⌘+F：只在焦点位于本终端时接管 —— 否则会把浏览器查找键和其他面板的
    //   查找键一起吃掉（终端是唯一"没有原生查找"的地方，它才需要这个键）
    const searchKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!showSearchRef.current) return
        e.preventDefault()
        search.closeSearch()
        term.focus()
        return
      }
      const isGlobal = e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')
      const isLocal =
        (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')
      if (!isGlobal && !isLocal) return
      if (isLocal) {
        const target = e.target as Node | null
        if (!target || !container.contains(target)) return
      }
      e.preventDefault()
      search.toggleSearch()
    }
    window.addEventListener('keydown', searchKeyHandler)

    // 清理函数
    return () => {
      clearTimeout(fitTimer)
      observer.disconnect()
      window.removeEventListener('keydown', searchKeyHandler)
      unsubTerminal()
      // 移除触摸事件监听器
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchstart', handleLongPressStart)
      container.removeEventListener('touchmove', handleLongPressMove)
      container.removeEventListener('touchend', handleLongPressEnd)
      container.removeEventListener('touchcancel', handleLongPressEnd)
      document.removeEventListener('selectionchange', handleSelectionChange)
      // 移除滚动位置监听器
      viewport?.removeEventListener('scroll', checkScrollPosition)
      try {
        scrollDisposable.dispose()
      } catch {
        /* ignore */
      }
      try {
        linkDisposable.dispose()
      } catch {
        /* ignore */
      }
      try {
        selectionDisposable.dispose()
      } catch {
        /* ignore */
      }
      // 清理画布：待执行的 rAF / 备用屏监听 / 控制器引用
      if (canvasRaf) {
        cancelAnimationFrame(canvasRaf)
        canvasRaf = 0
      }
      try {
        bufferChangeDisposable.dispose()
      } catch {
        /* ignore */
      }
      canvasCtlRef.current = null
      // 清理输出追踪定时器
      if (outputTracker.checkTimer) {
        clearTimeout(outputTracker.checkTimer)
        outputTracker.checkTimer = null
      }
      // 清理"等 shell 提示符"轮询定时器
      if (plainInjectTimerRef.current) {
        clearTimeout(plainInjectTimerRef.current)
        plainInjectTimerRef.current = null
      }
      // 移除阻止默认行为的监听器
      container.removeEventListener('contextmenu', preventContextMenu)
      container.removeEventListener('selectstart', preventSelectStart)
      xtermScreen?.removeEventListener('contextmenu', preventContextMenu)
      xtermViewport?.removeEventListener('contextmenu', preventContextMenu)
      xtermScreen?.removeEventListener('selectstart', preventSelectStart)
      xtermViewport?.removeEventListener('selectstart', preventSelectStart)
      // 断线重连的兜底计时器也要清（否则旧 connectionId 的计时器会去重连新终端）
      if (reopenTimeoutRef.current) {
        clearTimeout(reopenTimeoutRef.current)
        reopenTimeoutRef.current = null
      }
      // 断开并清理独立 WebSocket
      if (termWsRef.current) {
        termWsRef.current.disconnect()
        termWsRef.current = null
      }
      connectingRef.current = false
      connectedRef.current = false
      try {
        term.dispose()
      } catch {}
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
    // connectionId/sessionId 变化时重新创建终端连接
    // credentials 通过 ref 引用，onTerminalData 由父组件 useCallback 包装，均稳定不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, sessionId])

  // ─── ColorOS / Android WebView 长按阻止（工具栏区域） ───
  // ColorOS 浏览器无视 touch-action: manipulation，长按按钮会弹出浏览器默认右键菜单。
  // 通过 capture-phase contextmenu + touchstart 监听器在工具栏区域彻底阻断。
  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return

    // Capture-phase contextmenu：阻止浏览器弹出长按菜单
    const blockContextMenu = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    // Non-passive touchstart：在 capture 阶段阻止 ColorOS 的长按手势识别。
    // ⚠️ 这只在工具栏区域内生效，不影响终端输入区。
    // 按钮的 onPointerDown 在 touchstart 之后、浏览器识别长按之前触发，
    // 所以按钮功能不受影响。
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    const handleToolbarTouchStart = (e: TouchEvent) => {
      // 清除之前的定时器
      if (longPressTimer) clearTimeout(longPressTimer)
      // 350ms 后如果手指还没抬起/移动，阻止默认行为（阻断 ColorOS 长按识别）
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        // 此时浏览器正在准备显示长按菜单，preventDefault 可以阻止它
        // 但对已经触发的 pointerdown 无影响（已经处理完毕）
        e.preventDefault()
      }, 350)
    }
    const handleToolbarTouchEnd = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    toolbar.addEventListener('contextmenu', blockContextMenu, true)
    toolbar.addEventListener('touchstart', handleToolbarTouchStart, {
      capture: true,
      passive: false,
    })
    toolbar.addEventListener('touchend', handleToolbarTouchEnd, { capture: true, passive: true })
    toolbar.addEventListener('touchcancel', handleToolbarTouchEnd, { capture: true, passive: true })

    return () => {
      toolbar.removeEventListener('contextmenu', blockContextMenu, true)
      toolbar.removeEventListener('touchstart', handleToolbarTouchStart, true)
      toolbar.removeEventListener('touchend', handleToolbarTouchEnd, true)
      toolbar.removeEventListener('touchcancel', handleToolbarTouchEnd, true)
      if (longPressTimer) clearTimeout(longPressTimer)
    }
  }, []) // 只挂载一次，toolbar DOM 不变

  /** 往当前 PTY 会话写入一行命令（返回是否已送出） */
  const injectPtyLine = (line: string): boolean => {
    const ws = termWsRef.current
    if (!ws || !connectedRef.current) return false
    const encoded = encodePtyLine(line)
    ws.send({ type: 'exec', connectionId, data: encoded })
    onTerminalData?.(encoded)
    return true
  }

  /**
   * 设定「进度纯文本」并尽可能在当前会话生效（注入 / 撤销安静进度变量组，
   * 变量清单见 utils/quiet-env.ts）。
   *
   * 背景：整块重画的进度块行数 B 取决于任务规模（compose 是 1 + 服务数），
   * 重绘需要终端有 B+1 行；只要块放不下，每帧就往下堆 (块高 − 屏高) 行，
   * 表现为"终端一直在重复加行"。plain 是逐行追加日志，任何行数下都稳定。
   *
   * @param next   目标状态
   * @param manual 是否用户显式选择（true 才写偏好；false = 跟随画布，
   *               不动 localStorage，画布下次切换还能带着它走）
   * @returns `not-connected` / `busy`（本次没注入，下次连接生效）/ `applied` / `failed`
   */
  const applyComposePlain = (
    next: boolean,
    manual: boolean,
  ): 'not-connected' | 'busy' | 'applied' | 'failed' => {
    setComposePlain(next)
    composePlainRef.current = next
    if (manual) {
      plainManualRef.current = true
      try {
        localStorage.setItem(QUIET_PROGRESS_STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
    }
    if (!connectedRef.current) return 'not-connected'
    if (longRunning) return 'busy'
    return injectPtyLine(next ? buildQuietProgressExportLine() : buildQuietProgressUnsetLine())
      ? 'applied'
      : 'failed'
  }

  /** 点右上「显示」→「日志逐行输出」：显式选择（此后不再跟随「进度原地刷新」） */
  const toggleComposePlain = () => {
    const next = !composePlain
    const result = applyComposePlain(next, true)
    if (result === 'not-connected') {
      showHint(next ? '日志逐行输出已开启（连接后自动生效）' : '日志逐行输出已关闭')
      return
    }
    if (result === 'busy') {
      showHint('命令执行中，切换将在下次连接生效')
      return
    }
    if (result === 'applied') {
      showHint(
        next ? '日志逐行输出：已开启（进度改一行一条）' : '日志逐行输出：已关闭（恢复动画进度条）',
      )
      return
    }
    showHint('连接不可用，切换将在下次连接生效')
  }

  /**
   * 切换「终端画布」：逻辑尺寸与可视尺寸解耦（见 utils/terminal-canvas.ts）。
   *
   * 开：窄视口下把 PTY 逻辑屏抬到 30 行，可视区只是这扇屏的一扇窗（跟随光标、
   *     可上下平移）。整块重画的进度 UI 因此有足够行数原地重绘，不再每帧往
   *     scrollback 丢重复块。
   * 关：贴屏（逻辑尺寸 = 可视尺寸），即改造前的行为。
   *
   * 安静进度变量组**跟随画布**：关掉画布 = 行数兜底没了，这时必须注入，
   * 否则又回到"每帧堆重复行"；开着画布则不必牺牲动画（实测富进度 0 堆行）。
   * 用户手动点过「日志逐行输出」就尊重他的选择，「进度原地刷新」再切也不动它。
   */
  const toggleCanvas = () => {
    const next = !canvasOn
    setCanvasOn(next)
    canvasOnRef.current = next
    try {
      localStorage.setItem(CANVAS_STORAGE_KEY, next ? '1' : '0')
    } catch {
      /* ignore */
    }
    canvasCtlRef.current?.refit()
    // 画布关 → 需要 plain（!next = true）；画布开 → 不再需要（false）
    const plainShouldBe = !next
    const followCanvas = !plainManualRef.current && composePlainRef.current !== plainShouldBe
    const followResult = followCanvas ? applyComposePlain(plainShouldBe, false) : null
    const tail = !followCanvas
      ? ''
      : plainShouldBe
        ? '；同时开启日志逐行输出（关掉「进度原地刷新」后没有行数兜底）'
        : '；同时恢复动画进度（「进度原地刷新」已能容纳进度块）'
    const deferred =
      followResult === 'busy' || followResult === 'not-connected' ? '（下次连接生效）' : ''
    showHint(
      (next
        ? '进度原地刷新：已开启（进度块原地重绘，窄窗口不刷屏；可上下平移回看）'
        : '进度原地刷新：已关闭（严格按窗口行数渲染）') +
        tail +
        deferred,
    )
  }

  return (
    <div className={`group relative flex flex-col ${className}`} style={{ minHeight: 0 }}>
      {/* 搜索面板（共用组件：带大小写/整词/正则开关与匹配计数，见 TerminalSearchBar） */}
      {search.open && (
        <TerminalSearchBar
          query={search.query}
          onQueryChange={search.setQuery}
          options={search.options}
          onOptionChange={search.updateOption}
          matchCount={search.matchCount}
          matchIndex={search.matchIndex}
          error={search.error}
          onNext={search.next}
          onPrev={search.prev}
          onClose={() => {
            search.closeSearch()
            terminalRef.current?.focus()
          }}
          inputRef={search.inputRef}
        />
      )}

      {/* 断线状态条：断线后不仅给"重连"，还能看到自动重连的倒计时与次数（batch 2b ②） */}
      {reconnect.state && (
        <div
          data-testid="terminal-connection-lost"
          className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5"
        >
          <Unplug size={13} className="shrink-0 text-amber-400" />
          <span
            data-testid="terminal-connection-lost-text"
            className="min-w-0 flex-1 truncate text-xs text-amber-300"
          >
            {reconnect.state.message}
          </span>
          {reconnect.state.auto && (
            <button
              type="button"
              data-testid="terminal-reconnect-stop"
              onClick={reconnect.stopAuto}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-500/10"
            >
              停止
            </button>
          )}
          <button
            type="button"
            data-testid="terminal-reconnect-now"
            onClick={reconnect.retryNow}
            className="shrink-0 rounded bg-amber-600/80 px-2 py-0.5 text-xs text-white hover:bg-amber-500"
          >
            重连
          </button>
          <button
            type="button"
            data-testid="terminal-reconnect-dismiss"
            onClick={reconnect.dismiss}
            className="shrink-0 rounded px-2 py-0.5 text-xs text-amber-400 hover:bg-amber-500/10"
          >
            忽略
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-slate-950 px-1"
        style={{
          // 阻止浏览器默认触摸行为，由自定义触摸滚动处理器接管
          touchAction: 'none',
        }}
        onContextMenu={(e) => {
          // 右键：桌面端唯一顺手的"复制/粘贴/查找"入口（之前这里 preventDefault 之后
          // 什么都没发生，用户会以为终端坏了）
          e.preventDefault()
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: buildTerminalMenuItems(!!terminalRef.current?.getSelection()),
          })
        }}
        onPointerDown={(e) => {
          // 移动端 tap 终端区域时，主动 focus 触发输入法键盘
          // touch-action: none 会阻止浏览器的默认 tap→focus 行为，
          // 导致 xterm.js 的 hidden textarea 无法获得焦点，输入法无法弹出。
          // pointerdown 在 touchstart 之前触发，不会和自定义滚动冲突。
          if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            terminalRef.current?.focus()
          }
        }}
      />
      {/* ─── 右上角悬浮控制：「显示」菜单（进度画法 / 字号）+ 快捷键栏收起 + 选中文本复制 ─── */}
      <div className="pointer-events-none absolute top-1 right-1 z-10 flex flex-col items-end gap-1">
        <TerminalDisplayMenu
          canvasOn={canvasOn}
          onToggleCanvas={toggleCanvas}
          plainOn={composePlain}
          onTogglePlain={toggleComposePlain}
          fontSize={prefs.fontSize}
          onFontSizeChange={changeFontSize}
          defaultFontSize={FONT_SIZE_DEFAULT}
        />
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const next = !toolbarCollapsed
            setToolbarCollapsed(next)
            try {
              localStorage.setItem('wrench_ssh_toolbar_collapsed', next ? '1' : '0')
            } catch {
              /* ignore */
            }
          }}
          className={`pointer-events-auto flex items-center gap-1 rounded px-2 py-1 text-[11px] shadow-lg backdrop-blur-sm transition-all duration-150 md:hidden ${
            toolbarCollapsed
              ? 'bg-sky-600/90 text-white hover:bg-sky-500'
              : 'bg-slate-800/90 text-slate-400 hover:bg-slate-700 hover:text-white'
          }`}
          style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
          title={
            toolbarCollapsed
              ? '展开快捷键栏'
              : '收起快捷键栏，把约 5 行还给终端（compose 进度块需要足够行数）'
          }
        >
          {toolbarCollapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>键栏</span>
        </button>
        <button
          onClick={handleCopyAction}
          className={`pointer-events-auto flex items-center gap-1 rounded bg-slate-800/90 px-2 py-1 text-[11px] text-slate-300 shadow-lg backdrop-blur-sm transition-all duration-150 hover:bg-slate-700 hover:text-white ${
            hasSelection ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
          }`}
          title="复制选中文本 (Ctrl+Shift+C)"
        >
          <Copy size={12} />
          <span>复制</span>
        </button>
        {hint && (
          <span className="max-w-[70vw] rounded bg-slate-800/95 px-2 py-1 text-right text-[10px] leading-snug text-slate-300 shadow-lg backdrop-blur-sm">
            {hint}
          </span>
        )}
      </div>

      {/* ─── "回到底部"浮动按钮 ─── */}
      {userScrolledUp && (
        <button
          onClick={goLive}
          className={`absolute right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-700/90 text-slate-300 shadow-lg backdrop-blur-sm transition-all hover:bg-slate-600 hover:text-white md:bottom-6 ${
            toolbarCollapsed ? 'bottom-6' : 'bottom-28'
          }`}
          title="回到底部"
        >
          <ChevronDown size={16} />
        </button>
      )}

      {/* ─── 长时间运行命令提示条 ─── */}
      {longRunning && (
        <div className="pointer-events-none absolute top-1 left-1/2 z-10 -translate-x-1/2 rounded-full bg-slate-800/90 px-3 py-1 text-[11px] text-slate-400 shadow-lg backdrop-blur-sm">
          ⏳ 命令执行中... (已输出 {longRunning.lines} 行, {longRunning.seconds}s)
        </div>
      )}

      {/* ─── 上下文菜单：桌面右键 / 移动端长按共用（见 components/terminal/TerminalContextMenu）─── */}
      {contextMenu && (
        <TerminalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ─── 粘贴框 / 粘贴确认框（HTTP 下读不到剪贴板时的入口，也是移动端粘贴入口）─── */}
      {paste.dialog && (
        <TerminalPasteDialog
          mode={paste.dialog.mode}
          text={paste.dialog.text}
          reason={paste.dialog.reason}
          onSubmit={paste.submitDialog}
          onClose={paste.closeDialog}
        />
      )}

      {/* ─── 移动端：选择文本模态框（textarea 让用户自由选择复制） ─── */}
      {selectModalText !== null && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-950"
          style={{
            // 留出系统安全区域（刘海屏、状态栏）
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          {/* 顶栏：标题 + 操作按钮 */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-700/50 bg-slate-900 px-3 py-2">
            <span className="text-xs font-medium text-slate-400">选择文本后复制</span>
            <div className="flex gap-1.5">
              <button
                onPointerDown={(e) => {
                  e.preventDefault()
                  const ta = selectModalRef.current
                  if (ta) {
                    ta.focus()
                    ta.select()
                    document.execCommand('copy')
                  }
                }}
                className="bg-wrench-600 active:bg-wrench-700 rounded px-3 py-1 text-xs font-medium text-white"
              >
                全选复制
              </button>
              <button
                onPointerDown={(e) => {
                  e.preventDefault()
                  const ta = selectModalRef.current
                  if (ta) {
                    const start = ta.selectionStart
                    const end = ta.selectionEnd
                    const selected = ta.value.substring(start, end)
                    if (selected.trim()) {
                      safeWriteClipboard(selected)
                    } else {
                      ta.focus()
                      ta.select()
                      document.execCommand('copy')
                    }
                  }
                }}
                className="rounded bg-slate-700 px-3 py-1 text-xs text-slate-300 active:bg-slate-600"
              >
                复制选中
              </button>
              <button
                onPointerDown={(e) => {
                  e.preventDefault()
                  setSelectModalText(null)
                }}
                className="rounded bg-slate-800 px-3 py-1 text-xs text-slate-400 active:bg-slate-700"
              >
                关闭
              </button>
            </div>
          </div>
          {/* textarea：用户可以自由选择、滚动、复制 */}
          <textarea
            ref={selectModalRef}
            readOnly
            value={selectModalText}
            className="flex-1 resize-none border-none bg-slate-950 p-3 font-mono text-xs leading-4 text-slate-300 outline-none"
            style={{
              userSelect: 'text',
              WebkitUserSelect: 'text',
              // 确保 textarea 填满剩余空间
              minHeight: 0,
            }}
          />
        </div>
      )}

      {/* 移动端快捷键工具栏 — 三行紧凑布局 */}
      <div
        ref={toolbarRef}
        className="flex shrink-0 flex-col border-t border-slate-700/30 bg-slate-900/95 md:hidden"
        style={
          {
            // 禁用长按选中复制（快捷键按钮不需要）
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            touchAction: 'manipulation',
          } as React.CSSProperties
        }
      >
        {/* 快捷键三行：收起时整体 display:none（不卸载 DOM，保留长按拦截）
            收起开关放在右上角悬浮芯片（⌨ 键栏）里，这样展开态不额外占行，
            与改造前的高度完全一致；收起后这 3 行连同边框一起还给终端。*/}
        {/* 第一行：控制键 */}
        <div className={`${toolbarCollapsed ? 'hidden' : 'flex'} gap-px px-0.5 pt-0.5`}>
          {(
            [
              ['ESC', '\x1b'],
              ['TAB', '\t'],
              ['Ctrl+C', '\x03'],
              ['Ctrl+D', '\x04'],
              ['Ctrl+L', '\x0c'],
            ] as const
          ).map(([label, seq]) => (
            <button
              key={label}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // 防抖：50ms 内不重复发送，防止快速连击导致 WS 断连
                const now = Date.now()
                if (now - lastShortcutTime.current < 50) return
                lastShortcutTime.current = now
                const encoded = btoa(unescape(encodeURIComponent(seq)))
                termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
                onTerminalData?.(encoded)
                // 阻止输入法触发
                e.currentTarget.blur()
                containerRef.current?.focus()
              }}
              className="flex h-8 flex-1 items-center justify-center rounded bg-slate-800/80 font-mono text-[11px] text-slate-300 active:bg-slate-700 active:text-white"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 第二行：方向键 + Home/End（支持连续按，防抖间隔更短） */}
        <div className={`${toolbarCollapsed ? 'hidden' : 'flex'} gap-px px-0.5 pt-0.5`}>
          {(
            [
              ['Hom', '\x1b[H'],
              [' ↑ ', '\x1b[A'],
              [' ↓ ', '\x1b[B'],
              [' ← ', '\x1b[D'],
              [' → ', '\x1b[C'],
              ['End', '\x1b[F'],
            ] as const
          ).map(([label, seq]) => (
            <button
              key={label}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                // 方向键防抖间隔更短（30ms），支持快速连续按
                const now = Date.now()
                if (now - lastArrowKeyTime.current < 30) return
                lastArrowKeyTime.current = now
                const encoded = btoa(unescape(encodeURIComponent(seq)))
                termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
                onTerminalData?.(encoded)
                // 阻止输入法触发
                e.currentTarget.blur()
                containerRef.current?.focus()
              }}
              className="flex h-8 flex-1 items-center justify-center rounded bg-slate-800/80 font-mono text-[11px] text-slate-300 active:bg-slate-700 active:text-white"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 第三行：翻页 + 编辑 */}
        <div className={`${toolbarCollapsed ? 'hidden' : 'flex'} gap-px px-0.5 pt-0.5 pb-0.5`}>
          {(
            [
              ['PG↑', '\x1b[5~'],
              ['PG↓', '\x1b[6~'],
              [' Ins', '\x1b[2~'],
              [' Del', '\x1b[3~'],
              ['  |  ', '\x7c'],
            ] as const
          ).map(([label, seq]) => (
            <button
              key={label}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const now = Date.now()
                if (now - lastShortcutTime.current < 50) return
                lastShortcutTime.current = now
                const encoded = btoa(unescape(encodeURIComponent(seq)))
                termWsRef.current?.send({ type: 'exec', connectionId, data: encoded })
                onTerminalData?.(encoded)
                // 阻止输入法触发
                e.currentTarget.blur()
                containerRef.current?.focus()
              }}
              className="flex h-8 flex-1 items-center justify-center rounded bg-slate-800/80 font-mono text-[11px] text-slate-300 active:bg-slate-700 active:text-white"
              style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none' }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── 分屏管理器组件 ───

export interface SplitDef {
  id: string
  connectionId: string
  sessionId: string
  direction: 'vertical' | 'horizontal'
  split?: 'vertical' | 'horizontal'
  first?: SplitDef
  second?: SplitDef
  size?: number // 百分比
  /** 命令同步组 */
  syncGroup?: string
}

interface SplitContainerProps {
  splits: SplitDef[]
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
  connections: Array<{ id: string; name: string }>
  /** 命令同步切换 */
  onToggleSync?: (id: string) => void
  /** 拖动合并 */
  onMerge?: (
    sourceId: string,
    targetId: string,
    position: 'left' | 'right' | 'top' | 'bottom',
  ) => void
  /** 同步组映射：syncGroup → split ID 列表 */
  syncGroups?: Record<string, string[]>
  /** 当前活跃的分屏 ID */
  activeSplitId?: string | null
  onSetActiveSplit?: (id: string) => void
  /** 命令同步：分屏收到的终端输入 */
  onTerminalData?: (sessionId: string, data: string) => void
  /** 每个 session 的 SSH 凭据（用于建立独立 WS 连接） */
  credentialsMap?: Map<string, SshCredentials>
  /** 异步解密兜底凭据（页面刷新后内存 Map 为空时使用） */
  resolvedCredentials?: Record<string, SshCredentials> | null
}

export function SplitContainer({
  splits,
  onSplit,
  onRemove,
  onConnectionChange,
  connections,
  onToggleSync,
  onMerge,
  syncGroups,
  activeSplitId,
  onSetActiveSplit,
  onTerminalData,
  credentialsMap,
  resolvedCredentials,
}: SplitContainerProps) {
  if (splits.length === 0) return null

  // 辅助：优先从 Map 取凭据，回退到异步解密兜底
  const getCreds = (sessionId: string): SshCredentials | undefined =>
    credentialsMap?.get(sessionId) || resolvedCredentials?.[sessionId]

  // 单个分屏或同方向平铺
  if (splits.length === 1) {
    const single = splits[0]!
    return (
      <SplitPane
        key={single.id}
        split={single}
        onSplit={onSplit}
        onRemove={onRemove}
        onConnectionChange={onConnectionChange}
        connections={connections}
        onToggleSync={onToggleSync}
        onMerge={onMerge}
        syncGroups={syncGroups}
        activeSplitId={activeSplitId}
        onSetActiveSplit={onSetActiveSplit}
        onTerminalData={onTerminalData}
        credentialsMap={credentialsMap}
        getCreds={getCreds}
      />
    )
  }

  // 构建树形布局：找到方向变化点
  const firstDir = splits[0]!.direction
  // 从右往左找第一个方向不同的分界点
  let splitIdx = splits.length
  for (let i = splits.length - 1; i >= 1; i--) {
    if (splits[i]!.direction !== firstDir) {
      splitIdx = i
      break
    }
  }

  // 全部同方向 → 直接平铺
  if (splitIdx === splits.length) {
    return (
      <div
        className={`flex flex-1 overflow-hidden ${
          splits[0]!.direction === 'vertical' ? 'flex-col' : 'flex-row'
        }`}
        style={{ minHeight: 0 }}
      >
        {splits.map((s, i) => (
          <div
            key={s.id}
            className="flex overflow-hidden"
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          >
            {i > 0 && (
              <div
                className={`shrink-0 bg-slate-700/50 ${
                  splits[0]!.direction === 'vertical' ? 'h-px' : 'w-px'
                }`}
              />
            )}
            <SplitPane
              split={s}
              onSplit={onSplit}
              onRemove={onRemove}
              onConnectionChange={onConnectionChange}
              connections={connections}
              onToggleSync={onToggleSync}
              onMerge={onMerge}
              syncGroups={syncGroups}
              activeSplitId={activeSplitId}
              onSetActiveSplit={onSetActiveSplit}
              onTerminalData={onTerminalData}
              credentialsMap={credentialsMap}
              getCreds={getCreds}
            />
          </div>
        ))}
      </div>
    )
  }

  // 有方向变化：外层用 firstDir，内层用另一个方向
  const outerSplits = splits.slice(0, splitIdx)
  const innerSplits = splits.slice(splitIdx)

  return (
    <div
      className={`flex flex-1 overflow-hidden ${firstDir === 'vertical' ? 'flex-col' : 'flex-row'}`}
      style={{ minHeight: 0 }}
    >
      <div
        className="flex overflow-hidden"
        style={{ flex: outerSplits.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          key={`outer-${outerSplits.map((s) => s.id).join('-')}`}
          splits={outerSplits}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
          onToggleSync={onToggleSync}
          onMerge={onMerge}
          syncGroups={syncGroups}
          activeSplitId={activeSplitId}
          onSetActiveSplit={onSetActiveSplit}
          onTerminalData={onTerminalData}
          credentialsMap={credentialsMap}
          resolvedCredentials={resolvedCredentials}
        />
      </div>

      <div className={`shrink-0 bg-slate-700/50 ${firstDir === 'vertical' ? 'h-px' : 'w-px'}`} />

      <div
        className="flex overflow-hidden"
        style={{ flex: innerSplits.length, minHeight: 0, minWidth: 0 }}
      >
        <SplitContainer
          key={`inner-${innerSplits.map((s) => s.id).join('-')}`}
          splits={innerSplits}
          onSplit={onSplit}
          onRemove={onRemove}
          onConnectionChange={onConnectionChange}
          connections={connections}
          onToggleSync={onToggleSync}
          onMerge={onMerge}
          syncGroups={syncGroups}
          activeSplitId={activeSplitId}
          onSetActiveSplit={onSetActiveSplit}
          onTerminalData={onTerminalData}
          credentialsMap={credentialsMap}
          resolvedCredentials={resolvedCredentials}
        />
      </div>
    </div>
  )
}

// 单个分屏面板
function SplitPane({
  split,
  onSplit,
  onRemove,
  onConnectionChange,
  connections,
  onToggleSync,
  onMerge,
  syncGroups,
  activeSplitId,
  onSetActiveSplit,
  onTerminalData,
  credentialsMap,
  getCreds,
}: {
  split: SplitDef
  onSplit: (id: string, direction: 'vertical' | 'horizontal') => void
  onRemove: (id: string) => void
  onConnectionChange: (id: string, connectionId: string, sessionId: string) => void
  connections: Array<{ id: string; name: string }>
  onToggleSync?: (id: string) => void
  onMerge?: (
    sourceId: string,
    targetId: string,
    position: 'left' | 'right' | 'top' | 'bottom',
  ) => void
  syncGroups?: Record<string, string[]>
  activeSplitId?: string | null
  onSetActiveSplit?: (id: string) => void
  onTerminalData?: (sessionId: string, data: string) => void
  credentialsMap?: Map<string, SshCredentials>
  getCreds?: (sessionId: string) => SshCredentials | undefined
}) {
  const isSyncOn = !!split.syncGroup
  const groupId = split.syncGroup || ''
  const groupMembers = (groupId && syncGroups?.[groupId]) || []
  const isActive = activeSplitId === split.id

  // 拖拽状态
  const [dragOver, setDragOver] = useState<'none' | 'left' | 'right' | 'top' | 'bottom'>('none')
  const dragOverRef = useRef<'none' | 'left' | 'right' | 'top' | 'bottom'>('none')
  const dragRef = useRef<string | null>(null)

  const handleDragStart = (e: React.DragEvent) => {
    dragRef.current = split.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', split.id)
    // 让拖拽时显示一个半透明卡片
    const el = e.currentTarget as HTMLElement
    el.classList.add('opacity-40')
  }

  const handleDragEnd = (e: React.DragEvent) => {
    dragRef.current = null
    setDragOver('none')
    const el = e.currentTarget as HTMLElement
    el.classList.remove('opacity-40')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // 判断鼠标在拖拽目标中的位置
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const threshold = 0.25 // 25% 边缘触发

    let pos: 'none' | 'left' | 'right' | 'top' | 'bottom' = 'none'
    if (x / rect.width < threshold) {
      pos = 'left'
    } else if (x / rect.width > 1 - threshold) {
      pos = 'right'
    } else if (y / rect.height < threshold) {
      pos = 'top'
    } else if (y / rect.height > 1 - threshold) {
      pos = 'bottom'
    }
    dragOverRef.current = pos
    setDragOver(pos)
  }

  const handleDragLeave = () => {
    dragOverRef.current = 'none'
    setDragOver('none')
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === split.id || !onMerge) return
    setDragOver('none')

    // 直接用鼠标位置计算 drop 位置（避免 state 过期）
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const threshold = 0.25

    let pos: 'left' | 'right' | 'top' | 'bottom'
    if (x / rect.width < threshold) {
      pos = 'left'
    } else if (x / rect.width > 1 - threshold) {
      pos = 'right'
    } else if (y / rect.height < threshold) {
      pos = 'top'
    } else if (y / rect.height > 1 - threshold) {
      pos = 'bottom'
    } else {
      // 中心区域：根据分屏方向决定默认插入位置
      pos = split.direction === 'vertical' ? 'right' : 'bottom'
    }

    onMerge(sourceId, split.id, pos)
  }

  // 计算边框高亮
  const borderStyles = (() => {
    if (dragOver === 'none') return {}
    const color = 'rgba(34, 211, 238, 0.5)' // cyan-400
    switch (dragOver) {
      case 'left':
        return { borderLeft: `3px solid ${color}` }
      case 'right':
        return { borderRight: `3px solid ${color}` }
      case 'top':
        return { borderTop: `3px solid ${color}` }
      case 'bottom':
        return { borderBottom: `3px solid ${color}` }
    }
  })()

  return (
    <div
      className={`flex flex-1 flex-col overflow-hidden transition-shadow ${
        isActive ? 'ring-1 ring-cyan-500/40' : ''
      }`}
      style={{ minHeight: 0, ...borderStyles }}
      onClick={() => onSetActiveSplit?.(split.id)}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 分屏工具栏 */}
      <div className="flex items-center justify-between border-b border-slate-700/50 bg-slate-900/80 px-2 py-1">
        <div className="flex items-center gap-1">
          <select
            value={split.connectionId}
            onChange={(e) => {
              const val = e.target.value
              // 如果是 sessionId（已连接），直接使用；否则需要新建连接
              const isSession = connections.some((c) => c.id === val)
              if (isSession) {
                onConnectionChange(split.id, val, `sess_${val}_${Date.now()}`)
              }
            }}
            className="max-w-[120px] truncate rounded bg-transparent text-[11px] text-slate-400 outline-none hover:text-slate-300"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-0.5">
          {/* 命令同步开关 */}
          {onToggleSync && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleSync(split.id)
              }}
              className={`btn-icon relative ${
                isSyncOn ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400'
              }`}
              title={isSyncOn ? `命令同步中 (${groupMembers.length} 个分屏)` : '开启命令同步'}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
              {isSyncOn && groupMembers.length > 1 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-cyan-500 text-[8px] text-white">
                  {groupMembers.length}
                </span>
              )}
            </button>
          )}
          {/* 垂直分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSplit(split.id, 'vertical')
            }}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="垂直分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
          {/* 水平分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSplit(split.id, 'horizontal')
            }}
            className="btn-icon text-slate-600 hover:text-slate-400"
            title="水平分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </button>
          <div className="mx-1 h-3 w-px bg-slate-700/50" />
          {/* 关闭分屏 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRemove(split.id)
            }}
            className="btn-icon text-slate-600 hover:text-red-400"
            title="关闭分屏"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 终端 */}
      <TerminalView
        connectionId={split.connectionId}
        sessionId={split.sessionId}
        className="flex-1"
        onTerminalData={
          onTerminalData ? (data: string) => onTerminalData(split.sessionId, data) : undefined
        }
        credentials={getCreds?.(split.sessionId) || credentialsMap?.get(split.sessionId)}
      />
    </div>
  )
}
