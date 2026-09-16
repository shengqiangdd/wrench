use axum::{
    Json,
    extract::{Extension, State},
};
use std::collections::HashSet;
use std::sync::Arc;

use crate::api_types::{HostCreatedResponse, HostEntry};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::space::SpaceCtx;
use crate::ssh::SshSession;
use futures_util::future::join_all;

/// (id, host, port, username, session)
type HostSnapshot = (String, String, u16, String, Option<Arc<SshSession>>);

/// List all hosts (GET /api/hosts)
pub async fn list_hosts(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> ApiResponse<Vec<HostEntry>> {
    // 先收集基础信息（只列本空间的活连接，别人的主机信息不外泄）
    let host_snapshots: Vec<HostSnapshot> = state
        .connections_in(&space.id)
        .into_iter()
        .map(|conn| {
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
    let mut seen_hostnames: HashSet<String> = HashSet::new();
    let futures: Vec<_> = host_snapshots
        .into_iter()
        .filter(|(_, host, _, _, _)| seen_hostnames.insert(host.clone()))
        .map(|(id, host, port, username, session)| async move {
            let connected = match &session {
                Some(s) => s.is_connected().await,
                None => false,
            };
            HostEntry { id, host, port, username, connected }
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
    Extension(space): Extension<SpaceCtx>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<()> {
    // 只允许断开本空间的连接（跨空间的 id 视为不存在）
    state.remove_connection_in(&space.id, &id);
    ApiResponse::success_msg("Host deleted")
}
