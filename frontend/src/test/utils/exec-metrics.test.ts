import { describe, expect, it } from 'vitest'
import { summarizeExecMetrics } from '../../utils/exec-metrics'

describe('execution metrics summary', () => {
  it('derives rates without retaining commands, hosts, or request identifiers', () => {
    expect(
      summarizeExecMetrics({
        timestamp: 1,
        exec_started: 12,
        exec_completed: 10,
        exec_cancelled: 2,
        exec_active: 2,
      }),
    ).toEqual({
      finished: 10,
      completedWithoutCancellation: 8,
      completionRate: 83,
      cancellationRate: 20,
    })
  })

  it('keeps fresh and inconsistent counters safe for display', () => {
    expect(
      summarizeExecMetrics({
        timestamp: 1,
        exec_started: 0,
        exec_completed: 3,
        exec_cancelled: 9,
        exec_active: 0,
      }),
    ).toEqual({
      finished: 0,
      completedWithoutCancellation: 0,
      completionRate: 0,
      cancellationRate: 0,
    })
  })
})
