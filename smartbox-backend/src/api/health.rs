use axum::{extract::State};
use serde_json::json;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Enhanced health check (GET /api/health)
pub async fn health_check(
    State(state): State<Arc<AppState>>,
) -> ApiResponse<serde_json::Value> {
    let conn_count = state.connections.len();
    let body = json!({
        "status": "ok",
        "uptime": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        "version": env!("CARGO_PKG_VERSION"),
        "connections": { "active": conn_count },
    });
    ApiResponse::success(body)
}
