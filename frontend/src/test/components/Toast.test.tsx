/**
 * Toast component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root as _Root } from 'react-dom/client'
import Toast from '../../components/Toast'
import { emit } from '../../services/event-bus'

let container: HTMLElement
let root: _Root

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
  // Wait long enough for React to commit + useEffect to register the listener.
  // In CI (Node 22) the microtask queue and jsdom event dispatch can be slower,
  // so a generous sleep eliminates flakiness.
  await new Promise<void>((r) => setTimeout(r, 50))
}

function fireNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
  emit('wrench-notification', { message, type })
}

async function waitForContent(text: string) {
  await vi.waitFor(
    () => {
      expect(container.textContent).toContain(text)
    },
    { timeout: 3000 },
  )
}

describe('Toast', () => {
  it('returns null when no notifications', async () => {
    await render(<Toast />)
    expect(container.innerHTML).toBe('')
  })

  it('displays a notification when event is fired', async () => {
    await render(<Toast />)
    fireNotification('Hello World', 'success')
    await waitForContent('Hello World')
  })

  it('shows success text', async () => {
    await render(<Toast />)
    fireNotification('Success!', 'success')
    await waitForContent('Success!')
  })

  it('shows error text', async () => {
    await render(<Toast />)
    fireNotification('Error!', 'error')
    await waitForContent('Error!')
  })

  it('ignores events without message', async () => {
    await render(<Toast />)
    emit('wrench-notification', { message: '', type: 'info' })
    await new Promise((r) => setTimeout(r, 50))
    expect(container.innerHTML).toBe('')
  })

  it('removes toast when close button is clicked', async () => {
    await render(<Toast />)
    fireNotification('Closable', 'info')
    await waitForContent('Closable')
    const closeBtn = container.querySelector('button')
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    // Toast has 300ms exit animation then gets removed
    await vi.waitFor(
      () => {
        expect(container.innerHTML).toBe('')
      },
      { timeout: 2000 },
    )
  })
})
