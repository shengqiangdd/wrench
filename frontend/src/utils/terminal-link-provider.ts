import type { IDisposable, Terminal } from '@xterm/xterm'
import {
  findTerminalLinks,
  isCoarsePointer,
  openTerminalLink,
  shouldActivateLink,
} from './terminal-links'

/**
 * 给任意 xterm 实例挂上"终端里的 URL 可以点"的能力。
 *
 * 自实现 `registerLinkProvider` 而不是引 `@xterm/addon-web-links`：
 * 上游 addon 是"点到就开"，而我们要的是 VS Code / ttyd 的行为 —— 桌面必须按 Ctrl/⌘
 * （防止在终端里随手一点把内容点走），触摸设备才允许直接点。另外不引新依赖也避免了
 * 服务器构建期去 npm 取包（那边网络时通时断）。
 *
 * @param term   目标终端实例
 * @param onHint 需要给用户解释时的回调（"按住 Ctrl 点击" / "被浏览器拦截"）
 */
export function registerTerminalLinks(
  term: Terminal,
  onHint: (message: string) => void,
): IDisposable {
  return term.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      let text: string
      try {
        text = term.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true) ?? ''
      } catch {
        callback(undefined)
        return
      }
      const matches = findTerminalLinks(text)
      if (matches.length === 0) {
        callback(undefined)
        return
      }
      callback(
        matches.map((match) => ({
          text: match.text,
          range: {
            start: { x: match.start + 1, y: bufferLineNumber },
            end: { x: match.end, y: bufferLineNumber },
          },
          decorations: { underline: true, pointerCursor: true },
          activate: (event: MouseEvent) => {
            if (
              !shouldActivateLink({
                hasModifier: event.ctrlKey || event.metaKey,
                coarsePointer: isCoarsePointer(),
              })
            ) {
              onHint('按住 Ctrl（macOS 为 ⌘）点击可打开链接 · 触屏设备可直接点')
              return
            }
            if (!openTerminalLink(match.href)) {
              onHint('浏览器拦截了新标签页：请手动复制链接打开')
            }
          },
        })),
      )
    },
  })
}
