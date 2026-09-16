/**
 * 剪贴板读写 —— 带降级链，SSH 终端与容器终端共用。
 *
 * 为什么不能直接用 `navigator.clipboard`：
 * - 非安全上下文（HTTP 访问、部分内网地址）下 `navigator.clipboard` 直接是 `undefined`；
 * - 移动端 WebView 也常常不给权限。
 * 所以保留 `execCommand('copy')` 与 iframe 父窗口两条退路。
 */

/** 安全读取剪贴板（WebView 中 navigator.clipboard 可能为 undefined） */
export async function safeReadClipboard(): Promise<string> {
  try {
    if (navigator.clipboard?.readText) {
      return (await navigator.clipboard.readText()) || ''
    }
  } catch {
    /* ignore — permission denied or not supported */
  }
  return ''
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
