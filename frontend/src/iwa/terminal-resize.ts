export type TerminalDimensions = {
  cols: number
  rows: number
}

export const MAX_TERMINAL_COLUMNS = 500
export const MAX_TERMINAL_ROWS = 300
export const TERMINAL_RESIZE_DEBOUNCE_MS = 120

export function isValidTerminalDimensions({ cols, rows }: TerminalDimensions) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= 1 &&
    cols <= MAX_TERMINAL_COLUMNS &&
    rows >= 1 &&
    rows <= MAX_TERMINAL_ROWS
  )
}

export function createTerminalResizeScheduler(
  sendResize: (cols: number, rows: number) => Promise<void>,
  onError: (error: unknown) => void,
  delayMs = TERMINAL_RESIZE_DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastSent: TerminalDimensions = { cols: 80, rows: 24 }

  return {
    setInitial(dimensions: TerminalDimensions) {
      if (isValidTerminalDimensions(dimensions)) lastSent = dimensions
    },
    schedule(dimensions: TerminalDimensions) {
      if (!isValidTerminalDimensions(dimensions)) {
        onError(new Error('Terminal dimensions exceed the supported range'))
        return
      }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (dimensions.cols === lastSent.cols && dimensions.rows === lastSent.rows) return
        lastSent = dimensions
        void sendResize(dimensions.cols, dimensions.rows).catch(onError)
      }, delayMs)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
