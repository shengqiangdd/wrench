use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List all hosts (GET /api/hosts)
pub async fn list_hosts(State(state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    let hosts: Vec<_> = state
        .connections
        .iter()
        .map(|entry| {
            let conn = entry.value();
            serde_json::json!({
                "id": conn.connection_id,
                "host": conn.host,
                "port": conn.port,
                "username": conn.username,
                "connected": conn.is_connected(),
            })
        })
        .collect();

    ApiResponse::success(serde_json::Value::Array(hosts))
}

/// Add a new host (POST /api/hosts)
pub async fn add_host(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "host": body.get("host").and_then(|v| v.as_str()).unwrap_or(""),
    }))
}

/// Delete a host (DELETE /api/hosts/{id})
pub async fn delete_host(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<serde_json::Value> {
    state.connections.remove(&id);
    ApiResponse::success_msg("Host deleted")
}
