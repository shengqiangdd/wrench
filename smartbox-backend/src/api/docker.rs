use axum::{extract::State};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List Docker containers (GET /api/docker/containers)
pub async fn list_containers(State(_state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!([]))
}

/// Start a container (POST /api/docker/containers/{id}/start)
pub async fn start_container(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({ "id": id, "action": "start", "status": "ok" }))
}

/// Stop a container (POST /api/docker/containers/{id}/stop)
pub async fn stop_container(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({ "id": id, "action": "stop", "status": "ok" }))
}

/// Restart a container (POST /api/docker/containers/{id}/restart)
pub async fn restart_container(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({ "id": id, "action": "restart", "status": "ok" }))
}

/// Get container logs (GET /api/docker/containers/{id}/logs)
pub async fn container_logs(
    State(_state): State<Arc<AppState>>,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({ "id": id, "logs": "" }))
}

/// Docker PS (GET /api/docker/ps)
pub async fn docker_ps(State(_state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!([]))
}
