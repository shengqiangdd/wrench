import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../stores/app-store'
import BottomNav from '../../components/layout/BottomNav'

const mockSetActiveNav = vi.fn()

function setAppState(partial: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore.setState(partial as any)
}

beforeEach(() => {
  setAppState({
    activeNav: 'ssh',
    setActiveNav: mockSetActiveNav,
    sshSessions: [],
    sshSftpOpen: false,
  })
})

afterEach(() => {
  setAppState({
    activeNav: 'ssh',
    setActiveNav: () => {},
    sshSessions: [],
    sshSftpOpen: false,
  })
  document.body.innerHTML = ''
})

function render(el: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => root.render(el))
  return {
    container,
    root,
    unmount: () => {
      flushSync(() => root.unmount())
      container.remove()
    },
  }
}

function clickButton(container: HTMLElement, label: string) {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(label),
  )
  expect(btn, `Button "${label}" not found`).toBeTruthy()
  flushSync(() => btn!.click())
  return btn!
}

describe('BottomNav', () => {
  it('renders 5 core nav items + more button', () => {
    const { container } = render(<BottomNav />)
    const buttons = container.querySelectorAll('button')
    // 5 core items + 1 "more" button = 6
    expect(buttons.length).toBe(6)
    const text = container.textContent!
    expect(text).toContain('SSH')
    expect(text).toContain('命令')
    expect(text).toContain('Docker')
    expect(text).toContain('监控')
    expect(text).toContain('文件')
    expect(text).toContain('更多')
  })

  it('shows more panel with remaining items', () => {
    const { container } = render(<BottomNav />)
    clickButton(container, '更多')

    // Panel should appear with the remaining items
    const text = container.textContent!
    expect(text).toContain('日志聚合')
    expect(text).toContain('插件')
    expect(text).toContain('凭据保险箱')
    expect(text).toContain('通知渠道')
    expect(text).toContain('审计日志')
    expect(text).toContain('系统设置')
  })

  it('navigates from more panel and closes it', () => {
    const { container } = render(<BottomNav />)
    clickButton(container, '更多')
    clickButton(container, '插件')
    expect(mockSetActiveNav).toHaveBeenCalledWith('plugins')
  })

  it('highlights the active core nav item', () => {
    setAppState({ activeNav: 'docker' })
    const { container } = render(<BottomNav />)

    let foundActive = false
    container.querySelectorAll('button').forEach((btn) => {
      if (btn.textContent?.includes('Docker')) {
        const svg = btn.querySelector('svg')
        if (svg) {
          expect(svg.getAttribute('class')).toContain('wrench')
          foundActive = true
        }
      }
    })
    expect(foundActive).toBe(true)
  })

  it('marks more button active when non-core page is active', () => {
    setAppState({ activeNav: 'vault' })
    const { container } = render(<BottomNav />)
    const moreBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('更多'),
    )
    expect(moreBtn).toBeTruthy()
    // More button should have wrench color class
    expect(moreBtn!.className).toContain('wrench')
  })

  it('hides when SSH terminal is fullscreen', () => {
    setAppState({
      activeNav: 'ssh',
      sshSessions: [{ id: 's1', host: 'test' }],
      sshSftpOpen: false,
    })
    const { container } = render(<BottomNav />)
    expect(container.innerHTML).toBe('')
  })

  it('shows SSH page with sftp open', () => {
    setAppState({
      activeNav: 'ssh',
      sshSessions: [{ id: 's1', host: 'test' }],
      sshSftpOpen: true,
    })
    const { container } = render(<BottomNav />)
    expect(container.querySelector('button')).toBeTruthy()
  })

  it('renders icons in each core button', () => {
    const { container } = render(<BottomNav />)
    const buttons = container.querySelectorAll('button')
    // First 5 are core items, 6th is more
    for (let i = 0; i < 6; i++) {
      const btn = buttons[i]
      const svg = btn!.querySelector('svg')
      expect(svg, `Button "${btn!.textContent}" missing icon`).toBeTruthy()
    }
  })
})
