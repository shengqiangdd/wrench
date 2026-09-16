/**
 * 终端里的可点击链接 —— 纯函数（识别 + 安全判定 + 打开），不依赖 xterm。
 *
 * 背景：网页终端里出现的 URL 如果不能点，用户只能手动选中再复制到浏览器
 * （移动端尤其难受）。业界（VS Code / ttyd / Tabby）的做法都是**必须配合修饰键**
 * 才能打开 —— 否则在终端里点一下就把内容点走了，是更糟的体验。
 *
 * 安全边界：
 * - 只认 `http` / `https`，其他 scheme（`file:` / `javascript:` / `data:` …）一律不成链。
 * - 打开时带 `noopener,noreferrer`，不让目标页拿到 window.opener。
 * - 只匹配"像 URL 的"片段（`http(s)://` 或 `www.` 开头），不对裸域名/文件名下结论，
 *   避免把 `main.rs` 这种普通文本变成链接。
 */

export interface TerminalLinkMatch {
  /** 在传入行文本中的起止下标（含头不含尾） */
  start: number
  end: number
  /** 命中原文 */
  text: string
  /** 实际打开的地址（`www.` 前缀会补上 https://） */
  href: string
}

/** URL 主体允许的字符：排除空白与常见的"这是文本不是 URL"的定界符 */
const URL_BODY = /[^\s<>"'`|\\\p{Cc}]+/gu

/** 总是可以从尾部剥掉的标点（句末的逗号/句号几乎不是 URL 的一部分） */
const TRAILING_ALWAYS = /[.,;:!?*]+$/

/**
 * 从一行文本里找出所有可点击 URL。
 *
 * 尾部标点处理沿用"平衡括号"规则（与 VS Code / 终端模拟器一致）：
 * `(https://a) ` 里的 `)` 属于句子而不是 URL，剥掉；
 * 但 `https://en.wikipedia.org/wiki/Foo_(bar)` 里的 `)` 要保留。
 */
export function findTerminalLinks(line: string): TerminalLinkMatch[] {
  if (!line) return []
  const matches: TerminalLinkMatch[] = []
  URL_BODY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = URL_BODY.exec(line)) !== null) {
    const raw = m[0]
    const start = m.index
    const candidate = trimUrlTail(raw, line, start)
    if (!candidate) continue
    const href = normalizeTerminalLink(candidate)
    if (!href) continue
    matches.push({ start, end: start + candidate.length, text: candidate, href })
  }
  return matches
}

/**
 * 剥掉紧贴 URL 尾部的标点，返回干净的候选串（空串表示这段根本不构成链接）。
 */
function trimUrlTail(raw: string, line: string, start: number): string {
  const schemeMatch = /^(https?:\/\/|www\.)/i.exec(raw)
  if (!schemeMatch) return ''
  let text = raw
  // 1. 先剥总是多余的标点
  text = text.replace(TRAILING_ALWAYS, '')
  // 反复剥 `)` `]` `}` `>`：只要该闭合符在后面出现得比开符多，它就是句子的
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  for (;;) {
    const last = text.slice(-1)
    const opener = closers[last]
    if (!opener) break
    const haystack = line.slice(start, start + text.length)
    const opens = countChar(haystack, opener)
    const closes = countChar(haystack, last)
    if (closes > opens) {
      text = text.slice(0, -1)
      continue
    }
    break
  }
  // 剥完标点后必须仍是「scheme + 内容」：`www.` 会被剥成 `www`，`https://` 会只剩 scheme
  if (!/^(https?:\/\/|www\.)/i.test(text)) return ''
  const afterScheme = text.replace(/^(https?:\/\/|www\.)/i, '')
  return afterScheme.length > 0 ? text : ''
}

function countChar(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n += 1
  return n
}

/**
 * 文本 → 可打开的 href；不成链返回 `null`。
 * `www.example.com` → `https://www.example.com`（补 scheme 才能开）。
 */
export function normalizeTerminalLink(text: string): string | null {
  if (!text) return null
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`
  return isSafeTerminalHref(withScheme) ? withScheme : null
}

/**
 * 链接安全白名单：只允许 http / https。
 * `javascript:` / `data:` / `file:` / `vbscript:` 等一律拒绝（终端内容可能来自远端主机）。
 */
export function isSafeTerminalHref(href: string): boolean {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname.length > 0
}

/**
 * 链接激活策略：桌面（有鼠标）**必须按 Ctrl/⌘**才打开 —— 与 VS Code 终端、ttyd 一致，
 * 否则用户在终端里随手一点就把内容点走了，比不能点更糟；
 * 触摸设备没有修饰键可用，直接点开（配合触屏"点一下就是点一下"的直觉）。
 */
export function shouldActivateLink(input: {
  hasModifier: boolean
  coarsePointer: boolean
}): boolean {
  return input.coarsePointer || input.hasModifier
}

/** 当前是否为"粗指针"（触摸/笔）设备；拿不到 matchMedia 时按桌面处理 */
export function isCoarsePointer(
  win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  try {
    return !!win?.matchMedia?.('(hover: none) and (pointer: coarse)').matches
  } catch {
    return false
  }
}

/** `window.open` 的最小接口（测试可注入） */
export type WindowOpenLike = { open(url: string, target?: string, features?: string): unknown }

/**
 * 在浏览器里打开链接：新标签 + `noopener,noreferrer`。
 * 返回是否成功发起（`window.open` 被弹窗拦截时返回 `false`）。
 */
export function openTerminalLink(href: string, opener?: WindowOpenLike): boolean {
  if (!isSafeTerminalHref(href)) return false
  const win = opener ?? (typeof window === 'undefined' ? undefined : window)
  if (!win) return false
  return win.open(href, '_blank', 'noopener,noreferrer') != null
}
