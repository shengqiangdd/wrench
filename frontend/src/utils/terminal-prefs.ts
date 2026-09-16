/**
 * 终端显示/交互偏好 —— **单一来源**。
 *
 * 为什么单独抽一个模块：本产品的"终端"有两处（SSH 终端 `modules/ssh/Terminal.tsx`、
 * 容器终端 `modules/docker/DockerTerminal.tsx`），此外还有即将到来的设置面板。
 * 在此之前字号/字体是各自硬编码的字面量，用户无法调整，两个终端也无法保持一致手感。
 *
 * 设计要点：
 * - **一处存储**：单个 localStorage 键（JSON），读失败/字段非法时逐字段回退默认值，
 *   绝不让坏数据把终端打不开（`normalizeTerminalPrefs` 是纯函数，有单测钉住）。
 * - **一处广播**：`patchTerminalPrefs` 写入后广播事件，同页所有终端/设置面板实时同步；
 *   另监听 `storage` 事件覆盖"另一个标签页改了偏好"的情况。
 * - 只做数据，不碰 xterm API —— 应用偏好由各终端组件自己接线。
 */

export const TERMINAL_PREFS_STORAGE_KEY = 'wrench_terminal_prefs'

/** 同页偏好变更事件名（`CustomEvent`，无 detail —— 读的时候总是重新读存储） */
export const TERMINAL_PREFS_EVENT = 'wrench:terminal-prefs-changed'

export type CursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalPrefs {
  /** 字号（px） */
  fontSize: number
  /** 字体栈（CSS font-family 列表） */
  fontFamily: string
  /** 行高倍数（xterm `lineHeight`，1 = 紧贴） */
  lineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  /** 回滚缓冲行数 */
  scrollback: number
  /** 选中即复制（Linux/macOS 用户习惯；默认关，避免误覆盖剪贴板） */
  copyOnSelect: boolean
  /** macOS：把 Option 当 Meta（否则 Option+B 会被解释成特殊字符） */
  macOptionIsMeta: boolean
}

/** 默认字体栈：与既有实现一致（JetBrains Mono → Fira Code → Cascadia → Menlo） */
export const DEFAULT_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace"

export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 24
/** 一次缩放（Ctrl/⌘ + `+`/`-`）的步进 */
export const FONT_SIZE_STEP = 1
/** 设置面板里的字号预设（也用于把 Ctrl+0 复位到这个值） */
export const FONT_SIZE_DEFAULT = 13

export const LINE_HEIGHT_MIN = 1
export const LINE_HEIGHT_MAX = 1.8

export const SCROLLBACK_OPTIONS = [1000, 3000, 10000, 50000] as const
export const SCROLLBACK_DEFAULT = 3000

export const CURSOR_STYLES: readonly CursorStyle[] = ['block', 'underline', 'bar']

export const DEFAULT_TERMINAL_PREFS: TerminalPrefs = {
  fontSize: FONT_SIZE_DEFAULT,
  fontFamily: DEFAULT_FONT_FAMILY,
  lineHeight: 1,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: SCROLLBACK_DEFAULT,
  copyOnSelect: false,
  macOptionIsMeta: true,
}

/** 把字号夹到合法区间并取整（防止 localStorage 里塞进 0 / NaN / 9999） */
export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return FONT_SIZE_DEFAULT
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/**
 * 字号步进。基于**当前实际值**加减（而不是吸附到网格），
 * 这样用户手改过字号（设置面板允许任意值）之后，快捷键仍然从当前值继续走。
 */
export function stepFontSize(current: number, delta: number): number {
  return clampFontSize(clampFontSize(current) + delta)
}

/**
 * 防御式归一化：任何来源（localStorage、导入、未来的后端同步）的数据
 * 都要先过这里。**任何字段不合法 → 用默认值**，不抛异常。
 */
export function normalizeTerminalPrefs(raw: unknown): TerminalPrefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof TerminalPrefs, unknown>
  >
  const fontSize =
    typeof src.fontSize === 'number' || typeof src.fontSize === 'string'
      ? clampFontSize(Number(src.fontSize))
      : DEFAULT_TERMINAL_PREFS.fontSize
  const fontFamily =
    typeof src.fontFamily === 'string' && src.fontFamily.trim()
      ? src.fontFamily.trim()
      : DEFAULT_TERMINAL_PREFS.fontFamily
  const lineHeightRaw = Number(src.lineHeight)
  const lineHeight =
    Number.isFinite(lineHeightRaw) && lineHeightRaw > 0
      ? Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, lineHeightRaw))
      : DEFAULT_TERMINAL_PREFS.lineHeight
  const cursorStyle =
    typeof src.cursorStyle === 'string' &&
    (CURSOR_STYLES as readonly string[]).includes(src.cursorStyle)
      ? (src.cursorStyle as CursorStyle)
      : DEFAULT_TERMINAL_PREFS.cursorStyle
  const scrollbackRaw = Number(src.scrollback)
  const scrollback =
    Number.isFinite(scrollbackRaw) && scrollbackRaw >= 0
      ? Math.round(scrollbackRaw)
      : DEFAULT_TERMINAL_PREFS.scrollback
  return {
    fontSize,
    fontFamily,
    lineHeight,
    cursorStyle,
    cursorBlink:
      typeof src.cursorBlink === 'boolean' ? src.cursorBlink : DEFAULT_TERMINAL_PREFS.cursorBlink,
    scrollback,
    copyOnSelect:
      typeof src.copyOnSelect === 'boolean'
        ? src.copyOnSelect
        : DEFAULT_TERMINAL_PREFS.copyOnSelect,
    macOptionIsMeta:
      typeof src.macOptionIsMeta === 'boolean'
        ? src.macOptionIsMeta
        : DEFAULT_TERMINAL_PREFS.macOptionIsMeta,
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式 / 沙箱里访问 localStorage 会抛
    return null
  }
}

/** 读取偏好（永远返回完整对象；坏数据逐字段回退默认值） */
export function readTerminalPrefs(storage: StorageLike | null = defaultStorage()): TerminalPrefs {
  if (!storage) return { ...DEFAULT_TERMINAL_PREFS }
  try {
    const raw = storage.getItem(TERMINAL_PREFS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TERMINAL_PREFS }
    return normalizeTerminalPrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_TERMINAL_PREFS }
  }
}

/** 订阅偏好变化（同页事件 + 跨标签页 storage 事件）；返回取消订阅函数 */
export function subscribeTerminalPrefs(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    // key 为 null 表示 storage 被 clear()
    if (e.key === null || e.key === TERMINAL_PREFS_STORAGE_KEY) onChange()
  }
  window.addEventListener(TERMINAL_PREFS_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(TERMINAL_PREFS_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** 写入偏好（先归一化，再落盘 + 广播）；返回最终生效值 */
export function writeTerminalPrefs(
  prefs: TerminalPrefs,
  storage: StorageLike | null = defaultStorage(),
): TerminalPrefs {
  const normalized = normalizeTerminalPrefs(prefs)
  try {
    storage?.setItem(TERMINAL_PREFS_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* 写不进去（配额/隐私模式）也要让当前会话生效 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TERMINAL_PREFS_EVENT))
  }
  return normalized
}

/** 局部更新（设置面板/快捷键都走这里，避免整对象覆盖） */
export function patchTerminalPrefs(
  patch: Partial<TerminalPrefs>,
  storage: StorageLike | null = defaultStorage(),
): TerminalPrefs {
  return writeTerminalPrefs({ ...readTerminalPrefs(storage), ...patch }, storage)
}
