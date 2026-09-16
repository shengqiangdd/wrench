/**
 * 粘贴策略 —— **纯函数**，SSH 终端与容器终端共用（batch 2b ①）。
 *
 * 背景（读码取证 + 上游源码取证）：
 * - `navigator.clipboard` 在规范里标了 `[SecureContext]`，**HTTP 部署下它是 undefined**，
 *   于是原来那条链（`safeReadClipboard` → 空串 → 提示"用 Ctrl+V"）在 HTTP 下等于死路；
 *   更糟的是 Ctrl+V 被自定义键处理器拦下（`attachCustomKeyEventHandler` 返回 false 会
 *   preventDefault），而 xterm 对 Ctrl+V 的默认动作是发 `0x16`(^V) —— 所以也不能简单放行，
 *   否则 readline 的 quoted-insert 会吃掉粘贴内容的第一个字符。
 *   → HTTP / 无权限时**不猜**，明确落到"粘贴框"让用户自己贴。
 * - 多行粘贴：xterm `paste()` 会把 `\r?\n` 转成 `\r`(回车)，**每个换行都是一次执行**；
 *   只有当远端程序开了 bracketed paste（DECSET 2004）时，整块粘贴才不会被逐行执行。
 *   所以"要不要拦一下"这件事必须由**远端当前模式**决定，而不是我们拍脑袋。
 *
 * 这个文件只做判定与文案，不碰 DOM / xterm / WS，便于单测覆盖全部分支。
 */

/** 读剪贴板失败的原因（决定粘贴框里的解释文案） */
export type ClipboardFailureReason = 'unsupported' | 'denied'

export type ClipboardRead =
  { ok: true; text: string } | { ok: false; reason: ClipboardFailureReason }

export interface PasteStats {
  /** 字符数（已把 CRLF 规范成 LF） */
  chars: number
  /** 逻辑行数（忽略末尾换行；全空为 0） */
  lines: number
  /** 非空行数 */
  nonEmptyLines: number
  /** 发送后会被**立即执行**的条数 = 内容里的换行数 */
  executeNow: number
  /** 命中的破坏性命令标签（仅提示，不阻断） */
  dangers: string[]
}

export type PasteDecision =
  | { kind: 'empty' }
  | { kind: 'send'; text: string; stats: PasteStats; hint: string }
  | { kind: 'reader'; reason: ClipboardFailureReason }
  | { kind: 'confirm'; text: string; stats: PasteStats }

/**
 * 破坏性命令特征 —— 只在「确认粘贴」框里作为**提醒**出现（不阻断、不自动拦截）。
 * 宁可多提醒一句，也不要在用户粘贴 40 行脚本时默默执行。
 */
const DANGEROUS_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'rm -rf', re: /\brm\s+-[^\s]*[rf]/i },
  { label: 'mkfs', re: /\bmkfs(?:\.[a-z0-9]+)?\b/i },
  { label: 'dd of=/dev/…', re: /\bdd\b[^\n]*\bof=\s*\/dev\//i },
  { label: '> /dev/sdX', re: />\s*\/dev\/(?:sd|nvme|vd|hd)[a-z0-9]*/i },
  { label: 'fork bomb', re: /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/ },
  { label: 'shutdown / reboot', re: /\b(?:shutdown|reboot)\b/i },
  { label: 'chmod -R 777 /', re: /\bchmod\s+(?:-[a-zA-Z]+\s+)*777\s+\// },
  { label: 'curl | sh', re: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i },
]

/** 把 CRLF / 单独 CR 统一成 LF（Windows 剪贴板、CRT 风格的复制源很常见） */
export function normalizePastedText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function analyzePaste(text: string): PasteStats {
  const normalized = normalizePastedText(text)
  const chars = normalized.length
  const withoutTrailing = normalized.replace(/\n+$/, '')
  const lines = withoutTrailing === '' ? 0 : withoutTrailing.split('\n').length
  const nonEmptyLines = normalized.split('\n').filter((line) => line.trim() !== '').length
  const executeNow = (normalized.match(/\n/g) ?? []).length
  const dangers: string[] = []
  for (const { label, re } of DANGEROUS_PATTERNS) {
    if (re.test(normalized) && !dangers.includes(label)) dangers.push(label)
  }
  return { chars, lines, nonEmptyLines, executeNow, dangers: dangers.slice(0, 3) }
}

/** 「3 行 · 其中 2 条会立即执行」这种人话统计 */
export function formatPasteStats(stats: PasteStats): string {
  if (stats.chars === 0) return '没有内容'
  if (stats.lines <= 1) {
    return stats.executeNow > 0 ? '1 行 · 末尾换行会执行' : '1 行'
  }
  const head = `${stats.lines} 行`
  return stats.executeNow > 0 ? `${head} · 其中 ${stats.executeNow} 条会立即执行` : head
}

/** 粘贴框里的预览（超长只展示前 maxLines 行） */
export function previewPaste(text: string, maxLines = 12): { text: string; truncated: boolean } {
  const lines = normalizePastedText(text).split('\n')
  if (lines.length <= maxLines) return { text: lines.join('\n'), truncated: false }
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true }
}

function describeFailure(reason: ClipboardFailureReason): string {
  return reason === 'unsupported'
    ? '当前页面是 HTTP 访问，浏览器不允许网页直接读剪贴板'
    : '浏览器没有授予读剪贴板的权限'
}

/** 读剪贴板失败时，粘贴框顶部要说的那句话 */
export function describeClipboardFailure(reason: ClipboardFailureReason): string {
  return `${describeFailure(reason)} —— 在下面的框里粘贴（Ctrl/⌘ + V，手机长按），再发送到终端。`
}

function sendHint(stats: PasteStats, bracketed: boolean): string {
  if (stats.lines <= 1) return '已粘贴到终端'
  return bracketed
    ? `已粘贴 ${stats.lines} 行（Shell 会整块显示，回车才执行）`
    : `已粘贴 ${stats.lines} 行（已立即执行 ${stats.executeNow} 条）`
}

/**
 * 判定：拿到的文本该怎么处理。
 *
 * - 空 → empty
 * - 单行 → 直接发送（粘贴一行没有"先执行"的歧义）
 * - 多行 + 远端开了 bracketed paste → 直接发送（shell 端整块显示，回车才执行，安全）
 * - 多行 + 没开 → 需要确认框（每个换行都是一次执行，误粘即误执行）
 */
export function decidePasteText(text: string, opts: { bracketed: boolean }): PasteDecision {
  const stats = analyzePaste(text)
  if (stats.chars === 0 || text.trim() === '') return { kind: 'empty' }
  if (stats.lines <= 1) return { kind: 'send', text, stats, hint: sendHint(stats, opts.bracketed) }
  if (opts.bracketed) return { kind: 'send', text, stats, hint: sendHint(stats, true) }
  return { kind: 'confirm', text, stats }
}

/** 判定：剪贴板读取结果该怎么处理（读不到就该去粘贴框，而不是提示一句让人干瞪眼） */
export function decidePaste(read: ClipboardRead, opts: { bracketed: boolean }): PasteDecision {
  if (!read.ok) return { kind: 'reader', reason: read.reason }
  return decidePasteText(read.text, opts)
}

/** 发送后给用户的提示（确认框走过后也要有一句，让用户知道发生了什么） */
export function pasteSentHint(text: string, bracketed: boolean): string {
  return sendHint(analyzePaste(text), bracketed)
}
