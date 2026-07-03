/**
 * Toast component tests
 *
 * Uses createRoot directly to avoid React 19 CJS act issue.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import Toast from '../../components/Toast'

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

function fireNotification(message: string, type: 'success' | 'error' | 'info' = 'info') {
  window.dispatchEvent(
    new CustomEvent('smartbox-notification', {
      detail: { message, type },
    }),
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
    await new Promise(r => setTimeout(r, 20))
    expect(container.textContent).toContain('Hello World')
  })

  it('shows success text', async () => {
    await render(<Toast />)
    fireNotification('Success!', 'success')
    await new Promise(r => setTimeout(r, 20))
    expect(container.textContent).toContain('Success!')
  })

  it('shows error text', async () => {
    await render(<Toast />)
    fireNotification('Error!', 'error')
    await new Promise(r => setTimeout(r, 20))
    expect(container.textContent).toContain('Error!')
  })

  it('ignores events without message', async () => {
    await render(<Toast />)
    window.dispatchEvent(
      new CustomEvent('smartbox-notification', {
        detail: { message: '', type: 'info' },
      }),
    )
    await new Promise(r => setTimeout(r, 20))
    expect(container.innerHTML).toBe('')
  })

  it('removes toast when close button is clicked', async () => {
    await render(<Toast />)
    fireNotification('Closable', 'info')
    await new Promise(r => setTimeout(r, 20))
    const closeBtn = container.querySelector('button')
    expect(closeBtn).toBeTruthy()
    closeBtn!.click()
    // Toast has 300ms exit animation then gets removed
    await new Promise(r => setTimeout(r, 400))
    expect(container.innerHTML).toBe('')
  })
})
