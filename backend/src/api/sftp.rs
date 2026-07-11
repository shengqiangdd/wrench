use axum::{extract::State, Json};
use base64::Engine;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::ssh::SshSession;

/// Helper: get the SSH session for a connection ID, or return None.
/// The caller handles the error response, allowing audit logging.
fn get_session(state: &AppState, conn_id: &str) -> Option<(String, String, Arc<SshSession>)> {
    let entry = state.connections.get(conn_id)?;
    let host = entry.host.clone();
    let username = entry.username.clone();
    entry.session.as_ref().map(|s| (host, username, s.clone()))
}

/// Extract string field from JSON body with a default.
fn s(body: &serde_json::Value, key: &str) -> String {
    body[key].as_str().unwrap_or("").to_string()
}

/// Log an audit event for SFTP operations.
fn audit(state: &AppState, action: &str, connection_id: &str, host: &str, username: &str, detail: serde_json::Value) {
    let ip = "0.0.0.0".to_string();
    let full = serde_json::json!({
        "connection_id": connection_id,
        "host": host,
        "username": username,
        "detail": detail,
    });
    state.add_audit_log(action, full, &ip);
}

/// List directory via SFTP
pub async fn sftp_list_dir(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<Vec<crate::ssh::sftp::FileEntry>>> {
    let connection_id = s(&body, "connectionId");
    let path = s(&body, "path");

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::list_directory(&session, &path).await {
        Ok(entries) => {
            audit(
                &state,
                "sftp_list",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": path, "entries": entries.len()}),
            );
            Json(ApiResponse::success(entries))
        }
        Err(e) => Json(ApiResponse::error(2, &e)),
    }
}

/// Upload file via SFTP (base64-encoded data)
pub async fn sftp_upload(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<()>> {
    let connection_id = s(&body, "connectionId");
    let remote_path = s(&body, "path");
    let data = match body["data"].as_str() {
        Some(b64) => match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(d) => d,
            Err(e) => return Json(ApiResponse::error(3, &format!("Base64 decode failed: {}", e))),
        },
        None => return Json(ApiResponse::error(3, "Missing 'data' field (base64-encoded)")),
    };

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::upload_file(&session, &remote_path, data).await {
        Ok(_) => {
            audit(
                &state,
                "sftp_upload",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": remote_path}),
            );
            Json(ApiResponse::success(()))
        }
        Err(e) => Json(ApiResponse::error(4, &e)),
    }
}

/// Download file via SFTP (returns base64-encoded content)
pub async fn sftp_download(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<String>> {
    let connection_id = s(&body, "connectionId");
    let remote_path = s(&body, "path");

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::download_file(&session, &remote_path).await {
        Ok(data) => {
            audit(
                &state,
                "sftp_download",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": remote_path, "size": data.len()}),
            );
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            Json(ApiResponse::success(b64))
        }
        Err(e) => Json(ApiResponse::error(5, &e)),
    }
}

/// Delete file/directory via SFTP
pub async fn sftp_delete(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<()>> {
    let connection_id = s(&body, "connectionId");
    let path = s(&body, "path");
    let recursive = body["recursive"].as_bool().unwrap_or(false);

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::delete_file(&session, &path, recursive).await {
        Ok(_) => {
            audit(
                &state,
                "sftp_delete",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": path, "recursive": recursive}),
            );
            Json(ApiResponse::success(()))
        }
        Err(e) => Json(ApiResponse::error(6, &e)),
    }
}

/// Create directory via SFTP
pub async fn sftp_mkdir(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<()>> {
    let connection_id = s(&body, "connectionId");
    let path = s(&body, "path");

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::create_dir(&session, &path).await {
        Ok(_) => {
            audit(
                &state,
                "sftp_mkdir",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": path}),
            );
            Json(ApiResponse::success(()))
        }
        Err(e) => Json(ApiResponse::error(7, &e)),
    }
}

/// Rename/move file or directory via SFTP
pub async fn sftp_rename(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<()>> {
    let connection_id = s(&body, "connectionId");
    let from = s(&body, "from");
    let to = s(&body, "to");

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::rename(&session, &from, &to).await {
        Ok(_) => {
            audit(
                &state,
                "sftp_rename",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"from": from, "to": to}),
            );
            Json(ApiResponse::success(()))
        }
        Err(e) => Json(ApiResponse::error(8, &e)),
    }
}

/// Stat a file/directory via SFTP
pub async fn sftp_stat(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<crate::ssh::sftp::FileEntry>> {
    let connection_id = s(&body, "connectionId");
    let path = s(&body, "path");

    let (_host, _username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::stat(&session, &path).await {
        Ok(entry) => Json(ApiResponse::success(entry)),
        Err(e) => Json(ApiResponse::error(9, &e)),
    }
}

/// Set file permissions (chmod) via SFTP + SSH
pub async fn sftp_chmod(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Json<ApiResponse<()>> {
    let connection_id = s(&body, "connectionId");
    let path = s(&body, "path");
    let permissions = match body["permissions"].as_u64() {
        Some(p) => p as u32,
        None => return Json(ApiResponse::error(10, "Missing 'permissions' field (numeric octal, e.g. 493 for 0755)")),
    };

    let (host, username, session) = match get_session(&state, &connection_id) {
        Some(v) => v,
        None => return Json(ApiResponse::error(1, &format!("SSH not connected: {}", connection_id))),
    };

    match crate::ssh::sftp::chmod_via_ssh(&session, &path, permissions).await {
        Ok(_) => {
            audit(
                &state,
                "sftp_chmod",
                &connection_id,
                &host,
                &username,
                serde_json::json!({"path": path, "permissions": format!("{:o}", permissions)}),
            );
            Json(ApiResponse::success(()))
        }
        Err(e) => Json(ApiResponse::error(11, &e)),
    }
}
