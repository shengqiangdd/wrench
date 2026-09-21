import { describe, expect, it } from 'vitest'
import {
  focusSshSftpPanel,
  focusSshTerminalInput,
  getSshTerminalPanelClass,
  SSH_SFTP_PANEL_CLASS,
} from '../../modules/ssh/ssh-layout'

describe('SSH terminal and SFTP layout contract', () => {
  it('keeps the terminal bounded and visible beside desktop SFTP', () => {
    const className = getSshTerminalPanelClass(true)

    expect(className).toContain('min-h-0')
    expect(className).toContain('min-w-0')
    expect(className).toContain('flex')
    expect(className.split(' ')).not.toContain('hidden')
    expect(SSH_SFTP_PANEL_CLASS).toContain('hidden')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:flex')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:min-w-[280px]')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:w-[min(36vw,420px)]')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:flex-none')
  })

  it('keeps the terminal visible on mobile even when desktop SFTP is open', () => {
    expect(getSshTerminalPanelClass(true)).toContain('flex')
    expect(getSshTerminalPanelClass(true).split(' ')).not.toContain('hidden')
  })
})

it('focuses the input for the requested session instead of the first terminal', () => {
  const root = document.createElement('div')
  for (const sessionId of ['first', 'active']) {
    const terminal = document.createElement('div')
    terminal.dataset.terminalSession = sessionId
    const input = document.createElement('textarea')
    input.className = 'xterm-helper-textarea'
    terminal.appendChild(input)
    root.appendChild(terminal)
  }

  document.body.appendChild(root)
  expect(focusSshTerminalInput('active', root)).toBe(true)
  expect(root.querySelector('[data-terminal-session="active"] textarea')).toBe(
    document.activeElement,
  )
  root.remove()
})

it('focuses the SFTP panel once it is mounted', () => {
  const root = document.createElement('div')
  const panel = document.createElement('div')
  panel.dataset.testid = 'ssh-sftp-panel'
  panel.tabIndex = -1
  root.appendChild(panel)
  document.body.appendChild(root)

  expect(focusSshSftpPanel(root)).toBe(true)
  expect(document.activeElement).toBe(panel)
  root.remove()
})
