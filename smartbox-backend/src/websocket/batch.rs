use std::time::Duration;

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
            size_threshold: 16_384,     // 16 KB
            max_interval: Duration::from_millis(50), // 50 ms max latency
        }
    }
}

impl BatchConfig {
    /// Fast path for interactive terminal output.
    pub fn terminal() -> Self {
        Self {
            size_threshold: 8_192,
            max_interval: Duration::from_millis(30),
        }
    }

    /// High-latency path for log tailing.
    pub fn log_tail() -> Self {
        Self {
            size_threshold: 32_768,
            max_interval: Duration::from_millis(200),
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
pub fn reset_timer(
    timer: &mut std::pin::Pin<Box<tokio::time::Sleep>>,
    interval: Duration,
) {
    timer.as_mut().reset(tokio::time::Instant::now() + interval);
}
