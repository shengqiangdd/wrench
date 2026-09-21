import { describe, expect, it } from 'vitest'
import { getSftpVirtualWindow } from '../../utils/sftp-virtual-list'

describe('SFTP virtual list window', () => {
  it('keeps the initial viewport and a bounded overscan', () => {
    expect(getSftpVirtualWindow({ count: 1_000, scrollTop: 0, viewportHeight: 280 })).toEqual({
      start: 0,
      end: 22,
      topSpacer: 0,
      bottomSpacer: 27_384,
    })
  })

  it('clamps a late scroll position without negative spacers', () => {
    expect(getSftpVirtualWindow({ count: 100, scrollTop: 2_700, viewportHeight: 280 })).toEqual({
      start: 84,
      end: 100,
      topSpacer: 2_352,
      bottomSpacer: 0,
    })
  })
})
