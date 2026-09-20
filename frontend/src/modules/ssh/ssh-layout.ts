export function getSshTerminalPanelClass(sftpOpen: boolean): string {
  return `flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
    sftpOpen ? 'hidden md:flex' : 'flex'
  }`
}

export const SSH_SFTP_PANEL_CLASS =
  'flex min-h-0 min-w-0 flex-1 flex-col border-l border-slate-700/50 md:h-full md:w-[min(36vw,420px)] md:max-w-[420px] md:min-w-[280px] md:flex-none'

/** Focus the xterm input belonging to a specific SSH session. */
export function focusSshTerminalInput(sessionId: string, root: ParentNode = document): boolean {
  const terminals = root.querySelectorAll<HTMLElement>('[data-terminal-session]')
  for (const terminal of terminals) {
    if (terminal.dataset.terminalSession !== sessionId) continue
    const input = terminal.querySelector<HTMLElement>('.xterm-helper-textarea')
    if (!input) return false
    input.focus()
    return document.activeElement === input
  }
  return false
}
