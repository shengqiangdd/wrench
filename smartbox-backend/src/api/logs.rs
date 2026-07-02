use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available log sources (POST /api/logs/list-sources)
pub async fn list_sources(
    State(_state): State<Arc<AppState>>,
) -> ApiResponse<serde_json::Value> {
    let sources = serde_json::json!([
        { "path": "/var/log/syslog", "label": "Syslog" },
        { "path": "/var/log/messages", "label": "Messages" },
        { "path": "/var/log/auth.log", "label": "Auth Log" },
        { "path": "/var/log/kern.log", "label": "Kernel Log" },
        { "path": "/var/log/nginx/access.log", "label": "Nginx Access" },
        { "path": "/var/log/nginx/error.log", "label": "Nginx Error" },
    ]);
    ApiResponse::success(sources)
}

/// Tail a log file via SSH (POST /api/logs/tail)
pub async fn tail_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let path = body
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let lines = body
        .get("lines")
        .and_then(|v| v.as_u64())
        .map(|v| v.max(10).min(5000))
        .unwrap_or(200);

    if connection_id.is_empty() || path.is_empty() {
        return ApiResponse::error(
            -1,
            "Missing connectionId or path",
        );
    }

    // Look up SSH session
    let session = {
        let entry = state.connections.get(connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            return ApiResponse::error(-1, "SSH session not found or not connected");
        }
    };

    // Run tail command via SSH
    let escaped_path = path.replace('\'', "'\\''");
    let cmd = format!("tail -n {} '{}' 2>&1", lines, escaped_path);

    match session.exec(&cmd).await {
        Ok((stdout, stderr, _exit_code)) => {
            let content = if stderr.is_empty() { stdout } else { format!("{}\n{}", stderr, stdout) };
            ApiResponse::success(serde_json::json!({
                "content": content,
                "path": path,
                "lines": lines,
            }))
        }
        Err(e) => {
            ApiResponse::error(-1, &format!("SSH exec failed: {}", e))
        }
    }
}

/// Grep a log file via SSH (POST /api/logs/grep)
pub async fn grep_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let path = body
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let pattern = body
        .get("pattern")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let context = body
        .get("context")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(10);
    let ignore_case = body
        .get("ignoreCase")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if connection_id.is_empty() || path.is_empty() || pattern.is_empty() {
        return ApiResponse::error(-1, "Missing connectionId, path, or pattern");
    }

    // Look up SSH session
    let session = {
        let entry = state.connections.get(connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            return ApiResponse::error(-1, "SSH session not found or not connected");
        }
    };

    // Build grep command
    let escaped_path = path.replace('\'', "'\\''");
    let escaped_pattern = pattern.replace('\'', "'\\''");
    let ic = if ignore_case { "-i" } else { "" };
    let cmd = if context > 0 {
        format!(
            "grep {} -C {} '{}' '{}' 2>&1 | tail -c 1048576",
            ic, context, escaped_pattern, escaped_path
        )
    } else {
        format!(
            "grep {} '{}' '{}' 2>&1 | tail -c 1048576",
            ic, escaped_pattern, escaped_path
        )
    };

    match session.exec(&cmd).await {
        Ok((stdout, stderr, _exit_code)) => {
            let content = if stderr.is_empty() { stdout } else { format!("{}\n{}", stderr, stdout) };
            ApiResponse::success(serde_json::json!({
                "content": content,
                "pattern": pattern,
                "path": path,
            }))
        }
        Err(e) => {
            ApiResponse::error(-1, &format!("SSH exec failed: {}", e))
        }
    }
}
