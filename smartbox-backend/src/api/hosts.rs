use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{HostCreatedResponse, HostEntry};
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List all hosts (GET /api/hosts)
pub async fn list_hosts(State(state): State<Arc<AppState>>) -> ApiResponse<Vec<HostEntry>> {
    let hosts: Vec<HostEntry> = state
        .connections
        .iter()
        .map(|entry| {
            let conn = entry.value();
            HostEntry {
                id: conn.connection_id.clone(),
                host: conn.host.clone(),
                port: conn.port,
                username: conn.username.clone(),
                connected: conn.is_connected(),
            }
        })
        .collect();

    ApiResponse::success(hosts)
}

/// Add a new host (POST /api/hosts)
pub async fn add_host(
    State(_state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<HostCreatedResponse> {
    let id = uuid::Uuid::new_v4().to_string();
    let host = body.get("host").and_then(|v| v.as_str()).unwrap_or("").to_string();
    ApiResponse::success(HostCreatedResponse { id, host })
}

/// Delete a host (DELETE /api/hosts/{id})
pub async fn delete_host(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<()> {
    state.connections.remove(&id);
    ApiResponse::success_msg("Host deleted")
}
