/**
 * 剪贴板读写 —— 带降级链，SSH 终端与容器终端共用。
 *
 * 为什么不能直接用 `navigator.clipboard`：
 * - 非安全上下文（HTTP 访问、部分内网地址）下 `navigator.clipboard` 直接是 `undefined`；
 * - 移动端 WebView 也常常不给权限。
 * 所以保留 `execCommand('copy')` 与 iframe 父窗口两条退路。
 */

import type { ClipboardRead } from './terminal-paste'

/**
 * 读剪贴板 —— **把"读不到"和"读到空"分开**。
 *
 * 旧实现读不到就返回空串，调用方只能看到 `''`，于是"没权限"被当成"剪贴板是空的"，
 * 提示也只能是干瞪眼的一句。调用方需要知道**为什么**读不到，才能给出可操作的动作
 * （HTTP 下引导到粘贴框，权限被拒时提示浏览器授权）。
 */
export async function readClipboardText(): Promise<ClipboardRead> {
  let apiAvailable = false

  // 方案 1：Clipboard API（安全上下文 + 有权限时可用）
  try {
    if (navigator.clipboard?.readText) {
      apiAvailable = true
      return { ok: true, text: (await navigator.clipboard.readText()) || '' }
    }
  } catch {
    /* 有 API 但被拒（权限 / 非用户手势）→ 继续往下试 */
  }

  // 方案 2：execCommand('paste') —— Chromium 系已禁用，但部分 Android WebView 仍可用。
  // 失败无副作用（临时 textarea，用完即删）。
  try {
    const textarea = document.createElement('textarea')
    textarea.value = ''
    textarea.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;'
    document.body.appendChild(textarea)
    textarea.focus()
    const ok = document.execCommand('paste')
    const text = textarea.value
    document.body.removeChild(textarea)
    if (ok && text) return { ok: true, text }
  } catch {
    /* fallthrough */
  }

  // 区分原因：HTTP 下 `navigator.clipboard` 不存在（规范里的 [SecureContext] → unsupported），
  // 有 API 却失败才是"权限/手势"问题（denied）。文案不同，用户该做的事也不同。
  const supported = apiAvailable || !!navigator.clipboard?.readText
  return { ok: false, reason: supported ? 'denied' : 'unsupported' }
}

/** 安全写入剪贴板 — 多层 fallback：clipboard API → execCommand → 静默失败 */
export async function safeWriteClipboard(text: string): Promise<boolean> {
  if (!text) return false

  // 方案 1：Clipboard API（HTTPS + 有权限时可用）
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallthrough */
  }

  // 方案 2：execCommand('copy') — 利用 textarea + 选区触发浏览器原生复制
  // 在移动端 WebView / HTTP 页面中仍可工作（需要用户手势触发的调用栈）
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // 防止滚动条闪现
    textarea.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    // 移动端需要 setSelectionRange 确保选中
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    if (ok) return true
  } catch {
    /* fallthrough */
  }

  // 方案 3：如果在 iframe 中，尝试 parent window
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      const textarea = window.parent.document.createElement('textarea')
      textarea.value = text
      textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;'
      window.parent.document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      textarea.setSelectionRange(0, text.length)
      const ok = window.parent.document.execCommand('copy')
      window.parent.document.body.removeChild(textarea)
      if (ok) return true
    }
  } catch {
    /* fallthrough */
  }

  return false
}
