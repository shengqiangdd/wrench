import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../stores/app-store'
import BottomNav from '../../components/layout/BottomNav'

const mockSetActiveNav = vi.fn()

beforeEach(() => {
  useAppStore.setState({
    activeNav: 'ssh',
    setActiveNav: mockSetActiveNav,
    sshSessions: [],
    sshSftpOpen: false,
  } as any)
})

afterEach(() => {
  useAppStore.setState({
    activeNav: 'ssh',
    setActiveNav: () => {},
    sshSessions: [],
    sshSftpOpen: false,
  } as any)
  document.body.innerHTML = ''
})

function render(el: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => root.render(el))
  return { container, root, unmount: () => { flushSync(() => root.unmount()); container.remove() } }
}

describe('BottomNav', () => {
  it('renders all nav items', () => {
    const { container } = render(<BottomNav />)
    const text = container.textContent!
    expect(text).toContain('SSH')
    expect(text).toContain('命令')
    expect(text).toContain('Docker')
    expect(text).toContain('监控')
    expect(text).toContain('文件')
    expect(text).toContain('日志')
    expect(text).toContain('插件')
    expect(text).toContain('设置')
    expect(text).toContain('审计')
  })

  it('renders 9 nav buttons', () => {
    const { container } = render(<BottomNav />)
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(9)
  })

  it('highlights the active nav item', () => {
    useAppStore.setState({ activeNav: 'docker' } as any)
    const { container } = render(<BottomNav />)

    // Find all buttons and check the active one
    let foundActive = false
    container.querySelectorAll('button').forEach((btn) => {
      if (btn.textContent?.includes('Docker')) {
        // Active button should have the primary color class
        const svg = btn.querySelector('svg')
        if (svg) {
          expect(svg.getAttribute('class')).toContain('smartbox')
          foundActive = true
        }
      }
    })
    expect(foundActive).toBe(true)
  })

  it('calls setActiveNav on click', () => {
    const { container } = render(<BottomNav />)
    const buttons = container.querySelectorAll('button')
    // Click the Docker button
    const dockerBtn = Array.from(buttons).find(b => b.textContent?.includes('Docker'))
    expect(dockerBtn).toBeTruthy()
    dockerBtn!.click()
    expect(mockSetActiveNav).toHaveBeenCalledWith('docker')
  })

  it('calls setActiveNav with correct id', () => {
    const { container } = render(<BottomNav />)
    const buttons = container.querySelectorAll('button')

    const testCases = [
      { label: 'SSH', id: 'ssh' },
      { label: '命令', id: 'commands' },
      { label: 'Docker', id: 'docker' },
      { label: '监控', id: 'monitor' },
      { label: '文件', id: 'files' },
      { label: '日志', id: 'logs' },
      { label: '插件', id: 'plugins' },
      { label: '审计', id: 'audit' },
      { label: '设置', id: 'settings' },
    ]

    testCases.forEach(({ label, id }) => {
      mockSetActiveNav.mockClear()
      const btn = Array.from(buttons).find(b => b.textContent?.includes(label))
      expect(btn, `Button "${label}" not found`).toBeTruthy()
      btn!.click()
      expect(mockSetActiveNav).toHaveBeenCalledWith(id)
    })
  })

  it('hides when SSH terminal is fullscreen', () => {
    useAppStore.setState({
      activeNav: 'ssh',
      sshSessions: [{ id: 's1', host: 'test' }],
      sshSftpOpen: false,
    } as any)
    const { container } = render(<BottomNav />)
    // Should be empty (null return)
    expect(container.innerHTML).toBe('')
  })

  it('shows SSH page with sftp open', () => {
    useAppStore.setState({
      activeNav: 'ssh',
      sshSessions: [{ id: 's1', host: 'test' }],
      sshSftpOpen: true,
    } as any)
    const { container } = render(<BottomNav />)
    // Should still render because sftp is open
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('renders icons in each button', () => {
    const { container } = render(<BottomNav />)
    container.querySelectorAll('button').forEach((btn) => {
      const svg = btn.querySelector('svg')
      expect(svg, `Button "${btn.textContent}" missing icon`).toBeTruthy()
    })
  })
})
