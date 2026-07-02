/**
 * ConfirmModal component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { ConfirmModal, AlertModal } from '../../components/ConfirmModal'

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

async function render(el: React.ReactElement) {
  root.render(el)
  await new Promise<void>(r => setTimeout(r, 10))
}

function getButtons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

describe('ConfirmModal', () => {
  it('renders title and message when open', async () => {
    await render(<ConfirmModal open title="Delete?" message="Are you sure?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(container.textContent).toContain('Delete?')
    expect(container.textContent).toContain('Are you sure?')
  })

  it('shows default button texts', async () => {
    await render(<ConfirmModal open title="T" message="M" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(container.textContent).toContain('确认')
    expect(container.textContent).toContain('取消')
  })

  it('shows custom button texts', async () => {
    await render(<ConfirmModal open title="T" message="M" confirmText="Yes" cancelText="No" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(container.textContent).toContain('Yes')
    expect(container.textContent).toContain('No')
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    await render(<ConfirmModal open title="T" message="M" onConfirm={onConfirm} onCancel={vi.fn()} />)
    const btns = getButtons()
    const confirmBtn = btns.find(b => b.textContent === '确认')!
    confirmBtn.click()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when cancel button is clicked', async () => {
    const onCancel = vi.fn()
    await render(<ConfirmModal open title="T" message="M" onConfirm={vi.fn()} onCancel={onCancel} />)
    const btns = getButtons()
    const cancelBtn = btns.find(b => b.textContent === '取消')!
    cancelBtn.click()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when backdrop is clicked', async () => {
    const onCancel = vi.fn()
    await render(<ConfirmModal open title="T" message="M" onConfirm={vi.fn()} onCancel={onCancel} />)
    const backdrop = container.querySelector('[class*="bg-black"]')
    if (backdrop) {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onCancel).toHaveBeenCalled()
    }
  })

  it('applies danger variant styling', async () => {
    await render(<ConfirmModal open variant="danger" title="T" message="M" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const btns = getButtons()
    const confirmBtn = btns.find(b => b.textContent === '确认')!
    expect(confirmBtn.className).toContain('bg-red-600')
  })

  it('applies default variant styling', async () => {
    await render(<ConfirmModal open variant="default" title="T" message="M" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const btns = getButtons()
    const confirmBtn = btns.find(b => b.textContent === '确认')!
    expect(confirmBtn.className).toContain('bg-smartbox')
  })

  it('returns null when not open', async () => {
    await render(<ConfirmModal open={false} title="T" message="M" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('AlertModal', () => {
  it('renders title and message', async () => {
    await render(<AlertModal open title="Info" message="Something happened" onClose={vi.fn()} />)
    expect(container.textContent).toContain('Info')
    expect(container.textContent).toContain('Something happened')
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    await render(<AlertModal open title="T" message="M" onClose={onClose} />)
    const btns = getButtons()
    const closeBtn = btns.find(b => b.textContent === '确定')!
    closeBtn.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when backdrop is clicked', async () => {
    const onClose = vi.fn()
    await render(<AlertModal open title="T" message="M" onClose={onClose} />)
    const backdrop = container.querySelector('[class*="bg-black"]')
    if (backdrop) {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onClose).toHaveBeenCalled()
    }
  })

  it('returns null when not open', async () => {
    await render(<AlertModal open={false} title="T" message="M" onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })
})
