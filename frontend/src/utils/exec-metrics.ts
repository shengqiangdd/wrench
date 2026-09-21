export interface ExecMetricsSnapshot {
  timestamp: number
  exec_started: number
  exec_completed: number
  exec_cancelled: number
  exec_active: number
}

export interface ExecMetricsSummary {
  finished: number
  completedWithoutCancellation: number
  completionRate: number
  cancellationRate: number
}

/** Derive display-only rates from low-cardinality server counters. */
export function summarizeExecMetrics(snapshot: ExecMetricsSnapshot): ExecMetricsSummary {
  const finished = Math.min(snapshot.exec_started, snapshot.exec_completed)
  const completedWithoutCancellation = Math.max(0, finished - snapshot.exec_cancelled)
  return {
    finished,
    completedWithoutCancellation,
    completionRate: snapshot.exec_started
      ? Math.round((finished / snapshot.exec_started) * 100)
      : 0,
    cancellationRate: finished ? Math.round((snapshot.exec_cancelled / finished) * 100) : 0,
  }
}
