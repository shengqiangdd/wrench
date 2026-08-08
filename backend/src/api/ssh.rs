use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{SshConnectResponse, SshDisconnectRequest, SshExecRequest, SshExecResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::ssh::client::{ConnectRequest, SshConnection};
use crate::ssh::SshSession;

/// Get SSH test configuration from environment variables (GET /api/ssh/test-config)
pub async fn test_config() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "host": std::env::var("ssh_test_host").unwrap_or_default(),
        "user": std::env::var("ssh_test_user").unwrap_or_default(),
        "password": std::env::var("ssh_test_password").unwrap_or_default(),
    }))
}

/// Execute a command on an SSH connection (POST /api/ssh/exec)
pub async fn exec_command(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SshExecRequest>,
) -> ApiResponse<SshExecResponse> {
    let connection_id = &body.connection_id;
    let command = &body.command;

    if connection_id.is_empty() || command.is_empty() {
        return ApiResponse::error(400, "Missing connectionId or command");
    }

    // Look up the connection
    let conn = match state.connections.get(connection_id) {
        Some(c) => c,
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    let session = match &conn.session {
        Some(s) => s.clone(),
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    // Drop the read guard before awaiting (session is Arc)
    drop(conn);

    // Execute command
    match session.exec(command).await {
        Ok((stdout, stderr, exit_code)) => {
            // Audit log the command execution
            let detail = serde_json::json!({
                "action": "ssh_exec",
                "command": command,
                "exit_code": exit_code,
                "stdout_len": stdout.len(),
                "stderr_len": stderr.len(),
            });
            let ip = "0.0.0.0".to_string();
            state.add_audit_log("ssh_exec", detail, &ip);

            ApiResponse::success(SshExecResponse { stdout, stderr, exit_code: exit_code as i32 })
        }
        Err(e) => ApiResponse::error(500, &format!("SSH exec error: {}", e)),
    }
}

/// Connect to an SSH server (POST /api/ssh/connect)
pub async fn connect_ssh(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectRequest>,
) -> ApiResponse<SshConnectResponse> {
    let connection_id = uuid::Uuid::new_v4().to_string();
    let host = body.host;
    let port = body.port.unwrap_or(22);
    let username = body.username;

    // Configuration for known_hosts verification
    let known_hosts_path = body.known_hosts_path.clone();
    let strict_mode = body.strict_mode.unwrap_or(false);

    let session = SshSession::new(
        connection_id.clone(),
        host.clone(),
        port,
        username.clone(),
        known_hosts_path,
        strict_mode,
    );

    // Try password auth first, then key auth
    if let Some(password) = &body.password {
        if !password.is_empty() {
            match session.connect_password(password, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false)).await {
                Ok(()) => {
                    save_connection(&state, &connection_id, &host, port, &username, session, body.sudo_password.clone()).await;
                    return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
                }
                Err(e) => {
                    tracing::error!("Password auth failed for {}@{}:{}: {}", username, host, port, e);
                }
            }
        }
    }

    // Try key auth
    if let Some(private_key) = &body.private_key {
        if !private_key.is_empty() && session.connect_key(private_key, None, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false)).await.is_ok() {
            save_connection(&state, &connection_id, &host, port, &username, session, body.sudo_password.clone()).await;
            return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
        }
    }

    ApiResponse::error(401, "SSH authentication failed")
}

/// Disconnect from an SSH server (POST /api/ssh/disconnect)
pub async fn disconnect_ssh(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SshDisconnectRequest>,
) -> ApiResponse<String> {
    let connection_id = &body.connection_id;

    let (_key, mut conn) = match state.connections.remove(connection_id) {
        Some(c) => c,
        None => return ApiResponse::error(404, "SSH connection not found"),
    };

    if let Some(session) = conn.session.take() {
        let _ = session.disconnect().await;
    }

    // Audit log
    let detail = serde_json::json!({
        "action": "ssh_disconnect",
        "host": conn.host,
        "port": conn.port,
        "username": conn.username,
    });
    let ip = "0.0.0.0".to_string();
    state.add_audit_log("ssh_disconnect", detail, &ip);

    ApiResponse::success_msg("Disconnected")
}

async fn save_connection(
    state: &AppState,
    connection_id: &str,
    host: &str,
    port: u16,
    username: &str,
    session: SshSession,
    sudo_password: Option<String>,
) {
    let entry = SshConnection {
        connection_id: connection_id.to_string(),
        host: host.to_string(),
        port,
        username: username.to_string(),
        auth_method: "password".to_string(),
        session: Some(Arc::new(session)),
        sudo_password,
    };

    state.connections.insert(connection_id.to_string(), entry);
}

/// Ensure an active SSH connection exists for the given host/port/username.
///
/// If a connection with matching host+port+username is already connected, returns its ID.
/// Otherwise creates a new one via password or key auth.
/// This lets Docker/Logs/Monitor pages connect without going through the SSH page.
pub async fn ensure_connection(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectRequest>,
) -> ApiResponse<SshConnectResponse> {
    let host = body.host.clone();
    let port = body.port.unwrap_or(22);
    let username = body.username.clone();

    // Check for existing active connection with same host+port+username
    for entry in state.connections.iter() {
        let conn = entry.value();
        if conn.host == host && conn.port == port && conn.username == username {
            if let Some(session) = &conn.session {
                if session.is_connected().await {
                    return ApiResponse::success(SshConnectResponse {
                        connection_id: conn.connection_id.clone(),
                        host: conn.host.clone(),
                        port: conn.port,
                        username: conn.username.clone(),
                    });
                }
            }
        }
    }

    // No existing connection — create new one (reuse connect_ssh logic)
    let connection_id = uuid::Uuid::new_v4().to_string();
    
    // Configuration for known_hosts verification
    let known_hosts_path = body.known_hosts_path.clone();
    let strict_mode = body.strict_mode.unwrap_or(false);

    let session = SshSession::new(
        connection_id.clone(),
        host.clone(),
        port,
        username.clone(),
        known_hosts_path,
        strict_mode,
    );

    // Try password auth first, then key auth
    if let Some(password) = &body.password {
        if !password.is_empty() {
            match session.connect_password(password, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false)).await {
                Ok(()) => {
                    save_connection(&state, &connection_id, &host, port, &username, session, body.sudo_password.clone()).await;
                    return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
                }
                Err(e) => {
                    tracing::error!("ensure_connection: Password auth failed for {}@{}:{}: {}", username, host, port, e);
                }
            }
        }
    }

    if let Some(private_key) = &body.private_key {
        if !private_key.is_empty() && session.connect_key(private_key, None, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false)).await.is_ok() {
            save_connection(&state, &connection_id, &host, port, &username, session, body.sudo_password.clone()).await;
            return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
        }
    }

    ApiResponse::error(401, "SSH authentication failed")
}
