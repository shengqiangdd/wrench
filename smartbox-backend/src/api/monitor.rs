use axum::{extract::State};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Get system metrics (GET /api/metrics)
pub async fn get_metrics(State(_state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({
        "hosts": [],
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}
