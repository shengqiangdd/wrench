import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import Toast from '../../components/Toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Toast', () => {
  it('renders nothing by default', () => {
    const { container } = render(<Toast />)
    expect(container.firstChild).toBeNull()
  })

  it('shows toast after custom event', () => {
    render(<Toast />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('smartbox-notification', {
          detail: { message: '操作成功', type: 'success' },
        }),
      )
    })

    expect(screen.getByText('操作成功')).toBeInTheDocument()
  })

  it('shows multiple toasts', () => {
    render(<Toast />)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('smartbox-notification', {
          detail: { message: '消息一', type: 'info' },
        }),
      )
      window.dispatchEvent(
        new CustomEvent('smartbox-notification', {
          detail: { message: '消息二', type: 'error' },
        }),
      )
    })

    expect(screen.getByText('消息一')).toBeInTheDocument()
    expect(screen.getByText('消息二')).toBeInTheDocument()
  })
})
