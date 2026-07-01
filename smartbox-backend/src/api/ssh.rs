use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::ssh::client::ConnectRequest;
use crate::ssh::SshSession;

/// Execute a command on an SSH connection (POST /api/ssh/exec)
pub async fn exec_command(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let command = body
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if connection_id.is_empty() || command.is_empty() {
        return ApiResponse::error(400, "Missing connectionId or command");
    }

    // Look up the connection
    let conn_entry = state.connections.get(connection_id);
    let conn = match conn_entry {
        Some(c) => c,
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    let session = match &conn.session {
        Some(s) => s.clone(),
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    // Execute command
    match session.exec(command).await {
        Ok((stdout, stderr, exit_code)) => ApiResponse::success(serde_json::json!({
            "stdout": stdout,
            "stderr": stderr,
            "exitCode": exit_code
        })),
        Err(e) => ApiResponse::error(500, &format!("SSH exec error: {}", e)),
    }
}

/// Connect to an SSH server (POST /api/ssh/connect)
pub async fn connect_ssh(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectRequest>,
) -> ApiResponse<serde_json::Value> {
    let connection_id = uuid::Uuid::new_v4().to_string();
    let host = body.host;
    let port = body.port.unwrap_or(22);
    let username = body.username;

    let session = SshSession::new(connection_id.clone(), host.clone(), port, username.clone());

    // Try password auth first, then key auth
    if let Some(password) = &body.password {
        if !password.is_empty() {
            match session.connect_password(password).await {
                Ok(()) => {
                    let mut conn = crate::ssh::client::SshConnection::new(
                        connection_id.clone(),
                        host,
                        port,
                        username,
                        "password".into(),
                    );
                    conn.set_session(Arc::new(session));
                    state.connections.insert(connection_id.clone(), conn);
                    return ApiResponse::success(serde_json::json!({
                        "connectionId": connection_id,
                        "connected": true
                    }));
                }
                Err(e) => {
                    return ApiResponse::error(401, &format!("SSH connect error: {}", e));
                }
            }
        }
    }

    // Try private key auth
    if let Some(key) = &body.private_key {
        if !key.is_empty() {
            match session.connect_key(key, body.sudo_password.as_deref()).await {
                Ok(()) => {
                    let mut conn = crate::ssh::client::SshConnection::new(
                        connection_id.clone(),
                        host,
                        port,
                        username,
                        "publickey".into(),
                    );
                    conn.set_session(Arc::new(session));
                    state.connections.insert(connection_id.clone(), conn);
                    return ApiResponse::success(serde_json::json!({
                        "connectionId": connection_id,
                        "connected": true
                    }));
                }
                Err(e) => {
                    return ApiResponse::error(401, &format!("SSH connect error: {}", e));
                }
            }
        }
    }

    ApiResponse::error(400, "No authentication method provided")
}

/// Disconnect SSH (POST /api/ssh/disconnect)
pub async fn disconnect_ssh(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if connection_id.is_empty() {
        return ApiResponse::error(400, "Missing connectionId");
    }

    if let Some((_, conn)) = state.connections.remove(connection_id) {
        if let Some(session) = conn.session {
            session.disconnect().await;
        }
        ApiResponse::success_msg("Disconnected")
    } else {
        ApiResponse::error(404, "Connection not found")
    }
}
