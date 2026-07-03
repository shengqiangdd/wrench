import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../stores/app-store'
import Sidebar from '../../components/layout/Sidebar'

function click(el: Element | null | undefined) {
  if (el) (el as HTMLElement).click()
}

const mockSetActiveNav = vi.fn()
const mockToggleSidebar = vi.fn()

beforeEach(() => {
  useAppStore.setState({
    activeNav: 'ssh',
    setActiveNav: mockSetActiveNav,
    sidebarCollapsed: false,
    toggleSidebar: mockToggleSidebar,
    sshSessions: [],
  } as any)
})

afterEach(() => {
  useAppStore.setState({
    activeNav: 'ssh',
    setActiveNav: () => {},
    sidebarCollapsed: false,
    toggleSidebar: () => {},
    sshSessions: [],
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

describe('Sidebar (expanded)', () => {
  it('renders brand name and all nav items', () => {
    const { container } = render(<Sidebar />)
    const text = container.textContent!
    expect(text).toContain('智盒 SmartBox')
    expect(text).toContain('SSH 连接')
    expect(text).toContain('常用命令')
    expect(text).toContain('Docker 管理')
    expect(text).toContain('性能看板')
    expect(text).toContain('文件管理')
    expect(text).toContain('日志聚合')
    expect(text).toContain('插件')
    expect(text).toContain('凭据保险箱')
    expect(text).toContain('通知渠道')
    expect(text).toContain('审计日志')
    expect(text).toContain('设置')
  })

  it('renders 11 nav buttons in expanded mode', () => {
    const { container } = render(<Sidebar />)
    // All sidebar-item buttons (not the collapse toggle)
    const navBtns = container.querySelectorAll('.sidebar-item')
    expect(navBtns.length).toBe(11)
  })

  it('highlights the active nav', () => {
    useAppStore.setState({ activeNav: 'docker' } as any)
    const { container } = render(<Sidebar />)
    const activeBtn = container.querySelector('.sidebar-item.active')
    expect(activeBtn).toBeTruthy()
    expect(activeBtn!.textContent).toContain('Docker 管理')
  })

  it('calls setActiveNav on click', () => {
    const { container } = render(<Sidebar />)
    const dockerBtn = Array.from(container.querySelectorAll('.sidebar-item'))
      .find(b => b.textContent?.includes('Docker'))
    expect(dockerBtn).toBeTruthy()
    click(dockerBtn)
    expect(mockSetActiveNav).toHaveBeenCalledWith('docker')
  })

  it('shows SSH session count badge', () => {
    useAppStore.setState({
      sshSessions: [{ id: 's1', host: 'host1' }, { id: 's2', host: 'host2' }],
    } as any)
    const { container } = render(<Sidebar />)
    const sshBtn = Array.from(container.querySelectorAll('.sidebar-item'))
      .find(b => b.textContent?.includes('SSH'))
    expect(sshBtn).toBeTruthy()
    expect(sshBtn!.textContent).toContain('2')
  })

  it('does not show badge when zero sessions', () => {
    useAppStore.setState({ sshSessions: [] } as any)
    const { container } = render(<Sidebar />)
    const sshBtn = Array.from(container.querySelectorAll('.sidebar-item'))
      .find(b => b.textContent?.includes('SSH'))
    expect(sshBtn).toBeTruthy()
    // Should not contain session count badge
    const badge = sshBtn!.querySelector('[class*="rounded-full"]')
    expect(badge).toBeNull()
  })

  it('calls toggleSidebar on collapse button click', () => {
    const { container } = render(<Sidebar />)
    const collapseBtn = container.querySelector('button[title="收起侧边栏"]')
    expect(collapseBtn).toBeTruthy()
    click(collapseBtn)
    expect(mockToggleSidebar).toHaveBeenCalled()
  })

  it('shows version number', () => {
    const { container } = render(<Sidebar />)
    expect(container.textContent).toContain('v0.3.0')
  })

  it('shows online status indicator', () => {
    const { container } = render(<Sidebar />)
    const indicator = container.querySelector('.bg-emerald-500')
    expect(indicator).toBeTruthy()
  })
})

describe('Sidebar (collapsed)', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarCollapsed: true,
      activeNav: 'ssh',
      sshSessions: [],
    } as any)
  })

  it('renders icons only when collapsed', () => {
    const { container } = render(<Sidebar />)
    // Should not have brand name
    expect(container.textContent).not.toContain('智盒 SmartBox')
    // Should have 10 icon buttons
    const buttons = container.querySelectorAll('nav button')
    expect(buttons.length).toBe(12) // 11 nav + 1 expand toggle
  })

  it('shows expand button with correct title', () => {
    const { container } = render(<Sidebar />)
    const expandBtn = container.querySelector('button[title="展开侧边栏"]')
    expect(expandBtn).toBeTruthy()
    click(expandBtn)
    expect(mockToggleSidebar).toHaveBeenCalled()
  })

  it('highlights active nav in collapsed mode', () => {
    useAppStore.setState({ activeNav: 'docker' } as any)
    // Re-render with new state
    const { container } = render(<Sidebar />)
    // In collapsed mode, active button has bg-slate-800 + text-smartbox-400
    const buttons = container.querySelectorAll('nav button')
    let foundActive = false
    buttons.forEach(btn => {
      const classes = btn.getAttribute('class') || ''
      if (classes.includes('smartbox-400')) {
        foundActive = true
      }
    })
    expect(foundActive).toBe(true)
  })

  it('calls setActiveNav in collapsed mode', () => {
    const { container } = render(<Sidebar />)
    const dockerBtn = Array.from(container.querySelectorAll('nav button'))
      .find(b => b.getAttribute('title') === 'Docker 管理')
    expect(dockerBtn).toBeTruthy()
    click(dockerBtn)
    expect(mockSetActiveNav).toHaveBeenCalledWith('docker')
  })
})
