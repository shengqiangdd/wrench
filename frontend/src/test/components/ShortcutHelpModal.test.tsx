/**
 * ShortcutHelpModal component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 * 注意 render() 必须把 React 的提交**等干净**再返回：早先用「固定 await 10ms」，
 * 单跑没事，但全量并行跑时 CPU 争抢会让提交晚于 10ms，于是 `container.textContent`
 * 还是空串、`querySelector('button')!` 直接抛 —— 实测在 pre-commit 里偶发红灯一次。
 * 也不能用 `act`（React 19 + CJS 下 `Maximum call stack size exceeded`，实测），
 * 所以改成「轮询到 DOM 出现内容」；唯一期望渲染为空的用例显式声明 expectEmpty。
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import ShortcutHelpModal from '../../components/ShortcutHelpModal'

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  root.unmount()
  container.parentNode?.removeChild(container)
})

async function render(el: React.ReactElement, opts: { expectEmpty?: boolean } = {}) {
  root.render(el)
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 5))
    if (opts.expectEmpty) {
      if (container.innerHTML === '') return
    } else if (container.innerHTML !== '') {
      return
    }
  }
}

describe('ShortcutHelpModal', () => {
  it('returns null when not open', async () => {
    await render(<ShortcutHelpModal open={false} onClose={vi.fn()} />, { expectEmpty: true })
    expect(container.innerHTML).toBe('')
  })

  it('renders modal content when open', async () => {
    await render(<ShortcutHelpModal open onClose={vi.fn()} />)
    expect(container.textContent).toContain('快捷键列表')
  })

  it('displays shortcut groups', async () => {
    await render(<ShortcutHelpModal open onClose={vi.fn()} />)
    expect(container.textContent).toContain('全局')
    expect(container.textContent).toContain('终端')
    expect(container.textContent).toContain('编辑器')
    expect(container.textContent).toContain('文件管理器')
  })

  it('displays specific shortcuts', async () => {
    await render(<ShortcutHelpModal open onClose={vi.fn()} />)
    expect(container.textContent).toContain('Ctrl+K')
    expect(container.textContent).toContain('打开命令面板')
    expect(container.textContent).toContain('Ctrl+S')
    expect(container.textContent).toContain('保存当前文件')
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    await render(<ShortcutHelpModal open onClose={onClose} />)
    const closeBtn = container.querySelector('button')!
    closeBtn.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    await render(<ShortcutHelpModal open onClose={onClose} />)
    const backdrop = container.querySelector('.bg-black\\/60')!
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    await render(<ShortcutHelpModal open onClose={onClose} />)

    // Wait a bit longer for useEffect to register the keydown listener
    await new Promise((r) => setTimeout(r, 50))

    // Create a proper KeyboardEvent with key property
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    window.dispatchEvent(event)

    // Wait for the event handler to run
    await new Promise((r) => setTimeout(r, 50))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not call onClose for other keys', async () => {
    const onClose = vi.fn()
    await render(<ShortcutHelpModal open onClose={onClose} />)

    const event = new Event('keydown', { bubbles: true })
    Object.defineProperty(event, 'key', { value: 'Enter' })
    window.dispatchEvent(event)
    await new Promise((r) => setTimeout(r, 20))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('renders kbd elements for shortcut keys', async () => {
    await render(<ShortcutHelpModal open onClose={vi.fn()} />)
    const kbds = container.querySelectorAll('kbd')
    expect(kbds.length).toBeGreaterThan(0)
  })
})
