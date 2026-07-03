use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::utils::jwt::{Claims, JwtService};

/// Issue a JWT token for API and WebSocket authentication.
///
/// This replaces the old one-time token endpoint and provides a token
/// that is valid for 24 hours, reducing the need for frequent refreshes.
pub async fn issue_jwt_token(
    State(state): State<Arc<AppState>>,
    Json(_body): Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, ApiResponse<serde_json::Value>> {
    let secret = state.config.jwt_secret.clone();
    let jwt_service = JwtService::from_secret(&secret)
        .map_err(|e| ApiResponse::error(500, &format!("JWT configuration error: {}", e)))?;

    // Create a claims object with client fingerprint
    let claims = Claims::new("client".into(), "api+ws", 86400);
    let token = jwt_service.sign(&claims)
        .map_err(|e| ApiResponse::error(500, &format!("Failed to sign JWT: {}", e)))?;

    state.add_audit_log("jwt_issued", serde_json::json!({"scope": "api+ws"}), "client");

    Ok(ApiResponse::success(serde_json::json!({
        "token": token,
        "tokenType": "Bearer",
        "expiresIn": 86400
    })))
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
