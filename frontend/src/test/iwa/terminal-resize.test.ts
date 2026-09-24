import { describe, expect, it, vi } from 'vitest'
import { createTerminalResizeScheduler } from '../../iwa/terminal-resize'

describe('IWA terminal resize scheduler', () => {
  it('debounces to the latest dimensions and ignores the initial size', async () => {
    vi.useFakeTimers()
    const sendResize = vi.fn(async () => {})
    const onError = vi.fn()
    const scheduler = createTerminalResizeScheduler(sendResize, onError, 50)
    scheduler.setInitial({ cols: 80, rows: 24 })

    scheduler.schedule({ cols: 90, rows: 28 })
    scheduler.schedule({ cols: 110, rows: 40 })
    await vi.advanceTimersByTimeAsync(49)
    expect(sendResize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sendResize).toHaveBeenCalledTimes(1)
    expect(sendResize).toHaveBeenCalledWith(110, 40)

    scheduler.schedule({ cols: 110, rows: 40 })
    await vi.advanceTimersByTimeAsync(50)
    expect(sendResize).toHaveBeenCalledTimes(1)
    scheduler.cancel()
    vi.useRealTimers()
  })

  it('rejects zero, fractional, and oversized dimensions without sending a request', () => {
    const sendResize = vi.fn(async () => {})
    const onError = vi.fn()
    const scheduler = createTerminalResizeScheduler(sendResize, onError)

    scheduler.schedule({ cols: 0, rows: 24 })
    scheduler.schedule({ cols: 80.5, rows: 24 })
    scheduler.schedule({ cols: 501, rows: 24 })
    scheduler.schedule({ cols: 80, rows: 301 })

    expect(onError).toHaveBeenCalledTimes(4)
    expect(sendResize).not.toHaveBeenCalled()
    scheduler.cancel()
  })
})
