use axum::http::HeaderValue;
use tower_http::cors::CorsLayer;

/// Create CORS layer from allowed origins list.
///
/// If `origins` is empty, defaults to localhost/127.0.0.1 only (secure default).
/// Set `cors_origins: ["*"]` explicitly in config to allow all origins (dev mode).
pub fn create_cors_layer(origins: &[String]) -> CorsLayer {
    // Explicit wildcard — allow all origins (intentional dev mode)
    if origins.len() == 1 && origins[0] == "*" {
        tracing::warn!("[cors] Wildcard '*' configured — allowing ALL origins. Restrict in production.");
        return CorsLayer::permissive();
    }

    if origins.is_empty() {
        // Secure default: only allow localhost variants
        let allowed: Vec<HeaderValue> = [
            "http://localhost",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ]
        .iter()
        .filter_map(|o| o.parse::<HeaderValue>().ok())
        .collect();
        tracing::debug!("[cors] No origins configured — defaulting to localhost only");
        CorsLayer::new().allow_origin(allowed)
    } else {
        let origins: Vec<HeaderValue> = origins.iter().filter_map(|o| o.parse::<HeaderValue>().ok()).collect();
        CorsLayer::new().allow_origin(origins)
    }
}
