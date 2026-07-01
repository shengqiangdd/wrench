use axum::{extract::State, Json};
use std::sync::Arc;
use uuid::Uuid;

use crate::app_state::{AppState, WsTokenInfo};
use crate::response::ApiResponse;

/// Issue a one-time WebSocket token (POST /api/ws-token)
pub async fn issue_ws_token(
    State(state): State<Arc<AppState>>,
    Json(_body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let token = Uuid::new_v4().to_string();
    let expires_at = chrono::Utc::now() + chrono::Duration::minutes(5);

    state.ws_tokens.insert(
        token.clone(),
        WsTokenInfo {
            token: token.clone(),
            ip: "client".into(),
            expires_at,
        },
    );

    state.add_audit_log("ws_token_issued", serde_json::json!({}), "client");

    ApiResponse::success(serde_json::json!({
        "token": token,
        "expiresIn": 300
    }))
}

/// Get audit logs (GET /api/audit-logs)
pub async fn get_audit_logs(
    State(state): State<Arc<AppState>>,
) -> ApiResponse<serde_json::Value> {
    let logs = state.audit_logs.read();
    let total = logs.len();
    let slice: Vec<_> = logs.iter().rev().take(200).cloned().collect();

    ApiResponse::success(serde_json::json!({
        "total": total,
        "logs": slice
    }))
}
