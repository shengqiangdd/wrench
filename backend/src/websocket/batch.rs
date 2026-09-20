use std::time::{Duration, Instant};

use base64::Engine as _;

/// Batching configuration for output data streams.
///
/// Accumulates data chunks and flushes on size threshold (e.g. 16KB)
/// or time interval (e.g. 50ms), whichever comes first.
#[derive(Clone, Debug)]
pub struct BatchConfig {
    /// Flush when buffer exceeds this size (bytes).
    pub size_threshold: usize,
    /// Max latency before a forced flush.
    pub max_interval: Duration,
}

impl Default for BatchConfig {
    fn default() -> Self {
        Self {
            size_threshold: 16_384,                  // 16 KB
            max_interval: Duration::from_millis(50), // 50 ms max latency
        }
    }
}

impl BatchConfig {
    /// Fast path for interactive terminal output.
    pub fn terminal() -> Self {
        Self { size_threshold: 8_192, max_interval: Duration::from_millis(30) }
    }

    /// High-latency path for log tailing.
    pub fn log_tail() -> Self {
        Self { size_threshold: 32_768, max_interval: Duration::from_millis(200) }
    }
}
/// Server-side terminal batching profile.
///
/// Interactive output starts with the shortest window. Consecutive chunks
/// arriving close together promote the profile, reducing frame and redraw
/// churn for build/log bursts. An idle gap immediately returns to the
/// interactive profile, so the next command echo is never held by a stale
/// high-throughput setting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerminalBatchProfile {
    pub size_threshold: usize,
    pub max_interval: Duration,
}

const INTERACTIVE_PROFILE: TerminalBatchProfile =
    TerminalBatchProfile { size_threshold: 32 * 1024, max_interval: Duration::from_millis(8) };
const BURST_PROFILE: TerminalBatchProfile =
    TerminalBatchProfile { size_threshold: 48 * 1024, max_interval: Duration::from_millis(12) };
const SUSTAINED_PROFILE: TerminalBatchProfile =
    TerminalBatchProfile { size_threshold: 64 * 1024, max_interval: Duration::from_millis(16) };
const BURST_GAP: Duration = Duration::from_millis(2);
const IDLE_RESET: Duration = Duration::from_millis(40);

/// Learns whether a terminal is interactive or currently producing a burst.
#[derive(Debug, Default)]
pub struct AdaptiveTerminalBatcher {
    burst_level: u8,
    last_chunk_at: Option<Instant>,
}

impl AdaptiveTerminalBatcher {
    pub fn observe_chunk(&mut self, now: Instant) -> TerminalBatchProfile {
        match self.last_chunk_at.map(|last| now.saturating_duration_since(last)) {
            Some(gap) if gap >= IDLE_RESET => self.burst_level = 0,
            Some(gap) if gap <= BURST_GAP => self.burst_level = self.burst_level.saturating_add(1).min(2),
            Some(_) => self.burst_level = self.burst_level.saturating_sub(1),
            None => self.burst_level = 0,
        }
        self.last_chunk_at = Some(now);
        self.profile()
    }

    pub fn profile(&self) -> TerminalBatchProfile {
        match self.burst_level {
            0 => INTERACTIVE_PROFILE,
            1 => BURST_PROFILE,
            _ => SUSTAINED_PROFILE,
        }
    }
}

/// Helper to encode buffered bytes as base64 in a JSON object.
///
/// Returns `(base64_data, json_object)` for flexible use.
pub fn encode_buffer_as_data(buffer: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(buffer)
}

/// Create a flush timer pinned on the heap (suitable for use in `tokio::select!`).
pub fn new_flush_timer(interval: Duration) -> std::pin::Pin<Box<tokio::time::Sleep>> {
    Box::pin(tokio::time::sleep(interval))
}

/// Reset a pinned flush timer to fire after the given interval.
pub fn reset_timer(timer: &mut std::pin::Pin<Box<tokio::time::Sleep>>, interval: Duration) {
    timer.as_mut().reset(tokio::time::Instant::now() + interval);
}
#[cfg(test)]
mod tests {
    use super::{AdaptiveTerminalBatcher, BURST_PROFILE, INTERACTIVE_PROFILE, SUSTAINED_PROFILE};
    use std::time::{Duration, Instant};

    #[test]
    fn terminal_batching_promotes_only_for_consecutive_bursts() {
        let start = Instant::now();
        let mut batcher = AdaptiveTerminalBatcher::default();
        assert_eq!(batcher.observe_chunk(start), INTERACTIVE_PROFILE);
        assert_eq!(batcher.observe_chunk(start + Duration::from_millis(1)), BURST_PROFILE);
        assert_eq!(batcher.observe_chunk(start + Duration::from_millis(2)), SUSTAINED_PROFILE);
    }

    #[test]
    fn terminal_batching_returns_to_interactive_after_idle() {
        let start = Instant::now();
        let mut batcher = AdaptiveTerminalBatcher::default();
        batcher.observe_chunk(start);
        batcher.observe_chunk(start + Duration::from_millis(1));
        assert_eq!(batcher.profile(), BURST_PROFILE);
        assert_eq!(batcher.observe_chunk(start + Duration::from_millis(50)), INTERACTIVE_PROFILE);
    }
}
