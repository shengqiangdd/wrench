import { describe, expect, it } from 'vitest'
import { getSshTerminalPanelClass, SSH_SFTP_PANEL_CLASS } from '../../modules/ssh/ssh-layout'

describe('SSH terminal and SFTP layout contract', () => {
  it('keeps the terminal bounded and visible beside SFTP on desktop', () => {
    const className = getSshTerminalPanelClass(true)

    expect(className).toContain('min-h-0')
    expect(className).toContain('min-w-0')
    expect(className).toContain('hidden md:flex')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:min-w-[280px]')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:w-[min(36vw,420px)]')
    expect(SSH_SFTP_PANEL_CLASS).toContain('md:flex-none')
  })

  it('makes the terminal the only panel on mobile when SFTP is closed', () => {
    expect(getSshTerminalPanelClass(false)).toContain('flex')
    expect(getSshTerminalPanelClass(false)).not.toContain('hidden md:flex')
  })
})
