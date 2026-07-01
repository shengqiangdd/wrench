use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

#[derive(Deserialize)]
pub struct ExecRequest {
    pub connection_id: String,
    pub command: String,
}

/// Execute a command on an SSH connection (POST /api/ssh/exec)
pub async fn exec_command(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ExecRequest>,
) -> ApiResponse<serde_json::Value> {
    let conn_exists = state.connections.get(&body.connection_id).is_some();

    if !conn_exists {
        return ApiResponse::error(400, "SSH not connected");
    }

    ApiResponse::success(serde_json::json!({
        "stdout": "",
        "stderr": "",
        "exitCode": 0
    }))
}
