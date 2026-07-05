use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::{collections::VecDeque, sync::Arc, time::Instant};

use crate::app_state::AppState;

/// Simple in-memory sliding-window rate limiter.
///
/// Tracks request timestamps per IP address. If the number of requests
/// in the window exceeds the limit, returns 429 Too Many Requests.
pub struct RateLimiter {
    window_secs: u64,
    max_requests: u32,
    clients: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    pub fn new(window_secs: u64, max_requests: u32) -> Self {
        Self { window_secs, max_requests, clients: Mutex::new(HashMap::new()) }
    }

    /// Check if a request from `key` is allowed.
    /// Returns `true` if allowed, `false` if rate-limited.
    pub fn check(&self, key: &str) -> bool {
        let now = Instant::now();
        let window = std::time::Duration::from_secs(self.window_secs);
        let mut clients = self.clients.lock();

        let timestamps = clients.entry(key.to_string()).or_default();

        // Remove old timestamps outside the window
        while let Some(t) = timestamps.front() {
            if now.duration_since(*t) > window {
                timestamps.pop_front();
            } else {
                break;
            }
        }

        if timestamps.len() >= self.max_requests as usize {
            return false; // Rate limited
        }

        timestamps.push_back(now);
        true
    }
}

/// Rate limiting middleware for API routes.
///
/// Uses client IP address as the rate limit key.
/// Limit: 60 requests per minute by default.
pub async fn rate_limit_middleware(State(_state): State<Arc<AppState>>, req: Request<Body>, next: Next) -> Response {
    // Get client IP from headers or connection info
    let client_ip = req
        .headers()
        .get("X-Forwarded-For")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .split(',')
        .next()
        .unwrap_or("unknown")
        .trim();

    // Use a global static rate limiter
    use std::sync::LazyLock;
    static RATE_LIMITER: LazyLock<RateLimiter> = LazyLock::new(|| {
        RateLimiter::new(60, 60) // 60 requests per 60 seconds
    });

    if !RATE_LIMITER.check(client_ip) {
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
    fn test_rate_limiter_sliding_window() {
        let limiter = RateLimiter::new(1, 1); // 1 request per 1 second
        assert!(limiter.check("client-1"));
        assert!(!limiter.check("client-1")); // blocked within window

        // Wait for window to expire
        std::thread::sleep(std::time::Duration::from_millis(1100));
        assert!(limiter.check("client-1")); // allowed again
    }

    #[test]
    fn test_rate_limiter_zero_window() {
        let limiter = RateLimiter::new(0, 5);
        // With 0 second window, all requests are immediately outside the window
        // so all should be allowed (up to max_requests)
        for _ in 0..10 {
            assert!(limiter.check("client-1"));
        }
    }
}
