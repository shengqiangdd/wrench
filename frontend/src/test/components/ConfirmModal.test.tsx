/**
 * ConfirmModal & AlertModal component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
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
  await new Promise<void>((r) => setTimeout(r, 10))
}

describe('ConfirmModal', () => {
  it('returns null when not open', async () => {
    await render(
      <ConfirmModal
        open={false}
        title="Test"
        message="Message"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders title and message when open', async () => {
    await render(
      <ConfirmModal
        open
        title="确认删除"
        message="此操作不可撤销"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('确认删除')
    expect(container.textContent).toContain('此操作不可撤销')
  })

  it('renders default button texts', async () => {
    await render(
      <ConfirmModal open title="Test" message="Test" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(container.textContent).toContain('确认')
    expect(container.textContent).toContain('取消')
  })

  it('renders custom button texts', async () => {
    await render(
      <ConfirmModal
        open
        title="Test"
        message="Test"
        confirmText="Yes"
        cancelText="No"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('Yes')
    expect(container.textContent).toContain('No')
  })

  it('calls onConfirm when confirm button clicked', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    await render(
      <ConfirmModal open title="Test" message="Test" onConfirm={onConfirm} onCancel={onCancel} />,
    )
    const buttons = container.querySelectorAll('button')
    // Last button is the confirm button
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    buttons[buttons.length - 1]!.click()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('calls onCancel when cancel button clicked', async () => {
    const onCancel = vi.fn()
    await render(
      <ConfirmModal open title="Test" message="Test" onConfirm={vi.fn()} onCancel={onCancel} />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    buttons[0]!.click()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('applies danger variant styling', async () => {
    await render(
      <ConfirmModal
        open
        title="Danger"
        message="Danger action"
        variant="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons[1]?.className).toContain('bg-red-600')
  })

  it('has exit animation when closed', async () => {
    await render(
      <ConfirmModal open title="Test" message="Test" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    // Close it
    root.render(
      <ConfirmModal
        open={false}
        title="Test"
        message="Test"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    await new Promise((r) => setTimeout(r, 20))
    // Should still be in DOM during exit animation
    expect(container.textContent).toContain('Test')
    // After 300ms animation, should be removed
    await new Promise((r) => setTimeout(r, 350))
    expect(container.innerHTML).toBe('')
  })
})

describe('AlertModal', () => {
  it('returns null when not open', async () => {
    await render(<AlertModal open={false} title="Alert" message="Msg" onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders title and message when open', async () => {
    await render(<AlertModal open title="注意" message="操作成功" onClose={vi.fn()} />)
    expect(container.textContent).toContain('注意')
    expect(container.textContent).toContain('操作成功')
  })

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn()
    await render(<AlertModal open title="Alert" message="Msg" onClose={onClose} />)
    const btn = container.querySelector('button')
    expect(btn).toBeTruthy()
    btn!.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
