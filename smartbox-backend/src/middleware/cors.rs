use axum::http::HeaderValue;
use tower_http::cors::CorsLayer;

/// Create CORS layer from allowed origins list.
/// If empty, acts permissively (development mode).
pub fn create_cors_layer(origins: &[String]) -> CorsLayer {
    if origins.is_empty() {
        CorsLayer::permissive()
    } else {
        let origins: Vec<HeaderValue> = origins
            .iter()
            .filter_map(|o| o.parse::<HeaderValue>().ok())
            .collect();
        CorsLayer::new().allow_origin(origins)
    }
}
