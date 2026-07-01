use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available log sources (POST /api/logs/list-sources)
pub async fn list_sources(
    State(_state): State<Arc<AppState>>,
) -> ApiResponse<serde_json::Value> {
    let sources = serde_json::json!([
        { "path": "/var/log/syslog", "label": "Syslog" },
        { "path": "/var/log/messages", "label": "Messages" },
        { "path": "/var/log/auth.log", "label": "Auth Log" },
        { "path": "/var/log/kern.log", "label": "Kernel Log" },
        { "path": "/var/log/nginx/access.log", "label": "Nginx Access" },
        { "path": "/var/log/nginx/error.log", "label": "Nginx Error" },
    ]);
    ApiResponse::success(sources)
}

/// Tail a log file (POST /api/logs/tail)
pub async fn tail_log(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let lines = body.get("lines").and_then(|v| v.as_u64()).unwrap_or(200);
    ApiResponse::success(serde_json::json!({
        "content": "",
        "path": path,
        "lines": lines
    }))
}

/// Grep a log file (POST /api/logs/grep)
pub async fn grep_log(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let pattern = body.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
    ApiResponse::success(serde_json::json!({
        "content": "",
        "pattern": pattern
    }))
}
