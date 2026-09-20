use axum::{body::Body, extract::Request, middleware::Next, response::Response};
use std::time::Instant;
use tracing::info;

/// Middleware that logs all HTTP requests with duration.
/// Sensitive query parameters (password, token, key) are masked.
pub async fn request_logger(req: Request<Body>, next: Next) -> Response {
    let start = Instant::now();
    let method = req.method().clone();
    let uri = req.uri().clone();
    let request_id = req.extensions().get::<String>().cloned().unwrap_or_default();

    let response = next.run(req).await;
    let duration = start.elapsed();
    let status = response.status();

    info!(
        method = %method,
        request_id = %request_id,
        path = %uri.path(),
        status = %status,
        duration_ms = %duration.as_millis(),
        "HTTP request"
    );

    response
}
