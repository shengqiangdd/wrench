/**
 * 判断终端是否"停在 shell 提示符上"——即可以安全地往 PTY 里注入一行命令。
 *
 * 为什么需要它：往 PTY 注入 `export COMPOSE_PROGRESS=plain` 等同于替用户打字，
 * 一旦打错地方就会造成真实打扰：
 *   · 全屏 TUI（vim / htop / less / top / man）用的是 xterm 的 **alternate buffer**，
 *     注入的字符会落进 TUI 的输入流；
 *   · ssh / sudo 的密码提示会把你注入的命令行当作密码敲进去（既失败又难看）。
 *
 * 依据（都是终端本地状态，不需要后端配合）：
 *   1. `buffer.active.type === 'alternate'` → 一定不是 shell 提示符；
 *   2. 从光标行往上找最后一行非空文本，其行尾必须是常见 shell 提示符尾字符
 *      （`$ # % >` / `❯` / `➜` / `λ`）。
 *
 * 判定为「否」时调用方应当**放弃注入**并提示用户手动开启，绝不能退化成"照打"。
 */

/** xterm `IBuffer` 中本模块真正依赖的部分（便于单测传入假实现） */
export interface TerminalBufferLike {
  /** `'normal'` | `'alternate'`；TUI 用 alternate */
  readonly type?: string
  /** 视口底部对应的绝对行号 */
  readonly baseY: number
  /** 光标相对 baseY 的行号 */
  readonly cursorY: number
  getLine(y: number): { translateToString(trimRight?: boolean): string } | undefined
}

/** 常见 shell 提示符行尾：bash/zsh(默认) `$`、root `#`、fish/csh `%`、PowerShell `>`、starship/oh-my-zsh `❯ ➜ λ` */
const PROMPT_TAIL = /(?:[$#%>]|❯|➜|λ)$/
/** 行首箭头：oh-my-zsh / starship 把箭头放在行首（`➜  proj git:(main) ✗`） */
const PROMPT_HEAD = /^\s*(?:❯|➜|λ)/

/**
 * 终端当前是否停在 shell 提示符上。
 *
 * @param buffer `term.buffer.active`；传入 null/undefined 或抛错时一律返回 false（fail-closed）
 */
export function isAtShellPrompt(buffer: TerminalBufferLike | null | undefined): boolean {
  if (!buffer) return false
  try {
    // 备用屏 = 全屏 TUI，绝不注入
    if ((buffer.type ?? 'normal') !== 'normal') return false

    // 从光标所在行（含）往上找第一行非空文本，只信它
    for (let y = buffer.baseY + buffer.cursorY; y >= 0; y--) {
      const text = buffer.getLine(y)?.translateToString(true) ?? ''
      if (!text.trim()) continue
      return PROMPT_TAIL.test(text) || PROMPT_HEAD.test(text)
    }
    return false
  } catch {
    return false
  }
}
