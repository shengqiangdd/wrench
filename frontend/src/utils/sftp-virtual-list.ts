export interface SftpVirtualWindowInput {
  count: number
  scrollTop: number
  viewportHeight: number
  rowHeight?: number
  overscan?: number
}

export interface SftpVirtualWindow {
  start: number
  end: number
  topSpacer: number
  bottomSpacer: number
}

export const SFTP_VIRTUAL_ROW_HEIGHT = 28
export const SFTP_VIRTUALIZE_AFTER = 160

/**
 * Return a bounded render window for the fixed-height SFTP file rows.
 * Small directories retain their ordinary DOM list for accessibility and simpler focus behavior.
 */
export function getSftpVirtualWindow({
  count,
  scrollTop,
  viewportHeight,
  rowHeight = SFTP_VIRTUAL_ROW_HEIGHT,
  overscan = 12,
}: SftpVirtualWindowInput): SftpVirtualWindow {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 }
  const firstVisible = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight))
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight))
  const start = Math.max(0, firstVisible - Math.max(0, overscan))
  const end = Math.min(count, firstVisible + visibleCount + Math.max(0, overscan))
  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, count - end) * rowHeight,
  }
}
