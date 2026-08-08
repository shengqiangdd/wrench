use axum::{
    body::Body,
    extract::{connect_info::ConnectInfo, Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::app_state::AppState;

/// Token Bucket rate limiter - O(1) per check
pub struct TokenBucket {
    tokens: AtomicU64,
    last_refill: Mutex<Instant>,
    max_tokens: u64,
    refill_rate: f64, // tokens per second
}

impl TokenBucket {
    pub fn new(max_tokens: u64, refill_rate: f64) -> Self {
        Self {
            tokens: AtomicU64::new(max_tokens),
            last_refill: Mutex::new(Instant::now()),
            max_tokens,
            refill_rate,
        }
    }

    pub fn check(&self) -> bool {
        self.refill();
        self.tokens
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                if current > 0 {
                    Some(current - 1)
                } else {
                    None
                }
            })
            .is_ok()
    }

    fn refill(&self) {
        let mut last = self.last_refill.lock();
        let elapsed = last.elapsed().as_secs_f64();
        let new_tokens = (elapsed * self.refill_rate) as u64;
        if new_tokens > 0 {
            let current = self.tokens.load(Ordering::Relaxed);
            let new = (current + new_tokens).min(self.max_tokens);
            self.tokens.store(new, Ordering::Relaxed);
            *last = Instant::now();
        }
    }
}

/// Rate limiter with per-IP token buckets
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, Arc<TokenBucket>>>,
    max_requests: u64,
    window_secs: u64,
}

impl RateLimiter {
    pub fn new(window_secs: u64, max_requests: u32) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            max_requests: max_requests as u64,
            window_secs,
        }
    }

    pub fn check(&self, key: &str) -> bool {
        if self.window_secs == 0 {
            return true; // No limit if window is 0
        }
        
        let bucket = {
            let mut buckets = self.buckets.lock();
            buckets
                .entry(key.to_string())
                .or_insert_with(|| {
                    let refill_rate = self.max_requests as f64 / self.window_secs as f64;
                    Arc::new(TokenBucket::new(self.max_requests, refill_rate))
                })
                .clone()
        };
        bucket.check()
    }
}

/// Legacy sliding-window rate limiter (fallback)
pub struct LegacyRateLimiter {
    window_secs: u64,
    max_requests: u32,
    clients: Mutex<HashMap<String, std::collections::VecDeque<Instant>>>,
}

impl LegacyRateLimiter {
    pub fn new(window_secs: u64, max_requests: u32) -> Self {
        Self {
            window_secs,
            max_requests,
            clients: Mutex::new(HashMap::new()),
        }
    }

    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let window = Duration::from_secs(self.window_secs);
        let mut clients = self.clients.lock();
        let timestamps = clients.entry(key.to_string()).or_default();

        while let Some(t) = timestamps.front() {
            if now.duration_since(*t) > window {
                timestamps.pop_front();
            } else {
                break;
            }
        }

        if timestamps.len() >= self.max_requests as usize {
            return false;
        }

        timestamps.push_back(now);
        true
    }
}

/// Rate limiting middleware for API routes.
///
/// Uses client IP address as the rate limit key.
/// Limit: 60 requests per minute by default.
pub async fn rate_limit_middleware(
    State(_state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Response {
    // Use real connection IP
    let client_ip = addr.ip().to_string();

    // Use a global static rate limiter
    use std::sync::LazyLock;
    static RATE_LIMITER: LazyLock<RateLimiter> =
        LazyLock::new(|| RateLimiter::new(60, 300)); // 300 requests per 60 seconds

    if !RATE_LIMITER.check(&client_ip) {
        let body = serde_json::json!({
            "error": "Too many requests. Please slow down."
        })
        .to_string();
        return Response::builder()
            .status(StatusCode::TOO_MANY_REQUESTS)
            .header(axum::http::header::CONTENT_TYPE, "application/json")
            .header("Retry-After", "60")
            .body(Body::from(body))
            .unwrap();
    }

    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_allow_first() {
        let limiter = RateLimiter::new(10, 3);
        assert!(limiter.check("client-1"));
    }

    #[test]
    fn test_rate_limiter_allow_within_limit() {
        let limiter = RateLimiter::new(10, 3);
        assert!(limiter.check("client-1"));
        assert!(limiter.check("client-1"));
        assert!(limiter.check("client-1"));
    }

    #[test]
    fn test_rate_limiter_block_after_limit() {
        let limiter = RateLimiter::new(10, 3);
        assert!(limiter.check("client-1"));
        assert!(limiter.check("client-1"));
        assert!(limiter.check("client-1"));
        assert!(!limiter.check("client-1")); // 4th request blocked
    }

    #[test]
    fn test_rate_limiter_different_clients() {
        let limiter = RateLimiter::new(10, 2);
        assert!(limiter.check("client-a"));
        assert!(limiter.check("client-a"));
        assert!(!limiter.check("client-a")); // blocked
        assert!(limiter.check("client-b")); // different key, allowed
        assert!(limiter.check("client-b"));
    }

    #[test]
    fn test_rate_limiter_token_bucket_refill() {
        let limiter = RateLimiter::new(1, 1); // 1 request per 1 second
        assert!(limiter.check("client-1"));
        assert!(!limiter.check("client-1")); // blocked

        // Wait for refill
        std::thread::sleep(std::time::Duration::from_millis(1100));
        assert!(limiter.check("client-1")); // allowed again
    }
}
