use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{HostCreatedResponse, HostEntry};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use futures_util::future::join_all;

/// List all hosts (GET /api/hosts)
pub async fn list_hosts(State(state): State<Arc<AppState>>) -> ApiResponse<Vec<HostEntry>> {
    // 先收集基础信息
    let host_snapshots: Vec<(String, String, u16, String, Option<Arc<crate::ssh::SshSession>>)> =
        state
            .connections
            .iter()
            .map(|entry| {
                let conn = entry.value();
                (
                    conn.connection_id.clone(),
                    conn.host.clone(),
                    conn.port,
                    conn.username.clone(),
                    conn.session.clone(),
                )
            })
            .collect();

    // 并行检查连接状态
    let futures: Vec<_> = host_snapshots
        .into_iter()
        .map(|(id, host, port, username, session)| async move {
            let connected = match &session {
                Some(s) => s.is_connected().await,
                None => false,
            };
            HostEntry {
                id,
                host,
                port,
                username,
                connected,
            }
        })
        .collect();

    let hosts = join_all(futures).await;
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
