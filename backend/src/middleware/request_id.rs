//! Request correlation IDs for API, WebSocket, and static responses.

use axum::body::Body;
use axum::http::{HeaderValue, Request, header::HeaderName};
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

const REQUEST_ID: HeaderName = HeaderName::from_static("x-request-id");

/// Propagate a bounded caller-provided ID or generate one for this request.
///
/// The value is intentionally only returned in the response header; request
/// bodies, credentials, and command text are never logged by this middleware.
pub async fn request_id_middleware(mut request: Request<Body>, next: Next) -> Response {
    let request_id = request
        .headers()
        .get(&REQUEST_ID)
        .and_then(|value| value.to_str().ok())
        .filter(|value| is_safe_request_id(value))
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    request.extensions_mut().insert(request_id.clone());
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID, value);
    }
    response
}

fn is_safe_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

#[cfg(test)]
mod tests {
    use super::is_safe_request_id;

    #[test]
    fn accepts_bounded_trace_ids() {
        assert!(is_safe_request_id("trace-123_abc"));
        assert!(!is_safe_request_id(""));
        assert!(!is_safe_request_id("trace value"));
        assert!(!is_safe_request_id(&"x".repeat(129)));
    }
}
