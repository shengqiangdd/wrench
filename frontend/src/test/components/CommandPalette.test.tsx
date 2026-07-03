import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { useAppStore } from '../../stores/app-store'
import { usePluginStore } from '../../stores/plugin-store'
import CommandPalette, { fuzzyMatch, registerCommand, getCommands } from '../../components/CommandPalette'

// ─── Mock stores ────────────────────────────────────────────────
const mockSetOpen = vi.fn()
const mockSetActiveNav = vi.fn()
const mockSetTheme = vi.fn()
const mockToggleSidebar = vi.fn()
const mockExecuteCommand = vi.fn()

beforeEach(() => {
  useAppStore.setState({
    commandPaletteOpen: true,
    theme: 'dark',
    setCommandPaletteOpen: mockSetOpen,
    setActiveNav: mockSetActiveNav,
    setTheme: mockSetTheme,
    toggleSidebar: mockToggleSidebar,
    activeNav: 'ssh',
  } as any)
  usePluginStore.setState({
    commands: [],
    executeCommand: mockExecuteCommand,
  } as any)
})

afterEach(() => {
  useAppStore.setState({
    commandPaletteOpen: false,
    setCommandPaletteOpen: () => {},
    setActiveNav: () => {},
    setTheme: () => {},
    toggleSidebar: () => {},
    activeNav: 'ssh',
  } as any)
  usePluginStore.setState({ commands: [], executeCommand: () => {} } as any)
  document.body.innerHTML = ''
})

function render(el: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  flushSync(() => root.render(el))
  return { container, root, unmount: () => { flushSync(() => root.unmount()); container.remove() } }
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    useAppStore.setState({ commandPaletteOpen: false } as any)
    const { container } = render(<CommandPalette />)
    expect(container.innerHTML).toBe('')
  })

  it('renders input when open', () => {
    const { container } = render(<CommandPalette />)
    expect(container.querySelector('input')).toBeTruthy()
  })

  it('shows command sections', () => {
    const { container } = render(<CommandPalette />)
    const text = container.textContent!
    expect(text).toContain('导航')
    expect(text).toContain('主题')
  })

  it('displays registered external commands', () => {
    registerCommand({
      id: 'test-cmd',
      label: 'Test Command',
      description: 'A test registered command',
      keywords: ['test', 'example'],
      category: '工具',
      action: vi.fn(),
    })
    const { container } = render(<CommandPalette />)
    expect(container.textContent).toContain('Test Command')
  })

  it('getCommands returns registered commands', () => {
    registerCommand({
      id: 'cmd-1',
      label: 'CMD1',
      keywords: [],
      category: '工具',
      action: vi.fn(),
    })
    const cmds = getCommands()
    expect(cmds.some(c => c.id === 'cmd-1')).toBe(true)
  })

  it('shows plugin commands when available', () => {
    usePluginStore.setState({
      commands: [
        { id: 'say-hello', label: 'Say Hello', description: 'Greets the user', keywords: ['hello'], icon: 'MessageSquare' },
      ],
    } as any)

    const { container } = render(<CommandPalette />)
    expect(container.textContent).toContain('Say Hello')
  })

  it('renders without crashing', () => {
    const { container } = render(<CommandPalette />)
    expect(container.querySelector('input')).toBeTruthy()
  })
})

describe('fuzzyMatch', () => {
  it('matches direct substring', () => {
    expect(fuzzyMatch('hello world', 'world')).toBe(true)
  })

  it('matches empty query', () => {
    expect(fuzzyMatch('anything', '')).toBe(true)
  })

  it('rejects non-matching', () => {
    expect(fuzzyMatch('hello', 'xyz')).toBe(false)
  })

  it('matches case insensitive', () => {
    expect(fuzzyMatch('Hello World', 'hello')).toBe(true)
  })

  it('matches first letter of each latin word', () => {
    expect(fuzzyMatch('SSH 连接', 's')).toBe(true)
    expect(fuzzyMatch('打开 SSH 连接', 'ss')).toBe(true)
  })

  it('handles underscore_separated initials', () => {
    // 'toggle_sidebar' → initials: 't', 's' → 'ts'
    // 'ts'.includes('ts') → true
    expect(fuzzyMatch('toggle_sidebar', 'ts')).toBe(true)
  })

  it('matches hyphen-separated initials', () => {
    expect(fuzzyMatch('toggle-sidebar', 'ts')).toBe(true)
  })

  it('matches camelCase initials after fix', () => {
    // 'toggleSidebar' → 'toggle Sidebar' → 'ts'
    expect(fuzzyMatch('toggleSidebar', 'ts')).toBe(true)
  })

  it('trims the query', () => {
    expect(fuzzyMatch('hello', '  HE  ')).toBe(true)
  })
})
