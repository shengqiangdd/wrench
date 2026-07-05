use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{GrepResponse, LogSource, LogTailResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available log sources (GET /api/log-sources)
pub async fn list_sources(State(_state): State<Arc<AppState>>) -> ApiResponse<Vec<LogSource>> {
    let mut sources: Vec<LogSource> = Vec::new();

    // Detect common log directories
    // We check which log files exist via SSH
    let common_logs = [
        ("/var/log/syslog", "System Log (syslog)"),
        ("/var/log/messages", "System Log (messages)"),
        ("/var/log/auth.log", "Authentication Log"),
        ("/var/log/kern.log", "Kernel Log"),
        ("/var/log/dmesg", "Kernel Boot Messages"),
        ("/var/log/nginx/access.log", "Nginx Access Log"),
        ("/var/log/nginx/error.log", "Nginx Error Log"),
        ("/var/log/apache2/access.log", "Apache Access Log"),
        ("/var/log/apache2/error.log", "Apache Error Log"),
        ("/var/log/mysql/error.log", "MySQL Error Log"),
        ("/var/log/postgresql/postgresql.log", "PostgreSQL Log"),
        ("/var/log/docker.log", "Docker Daemon Log"),
        ("/var/log/journal", "System Journal"),
    ];

    // Check which common log files exist locally
    for (path, label) in &common_logs {
        if std::path::Path::new(path).exists() {
            sources.push(LogSource { path: path.to_string(), label: label.to_string() });
        }
    }

    // Always include syslog if sources is empty (fallback)
    if sources.is_empty() {
        sources.push(LogSource { path: "/var/log/syslog".into(), label: "System Log (syslog)".into() });
    }

    ApiResponse::success(sources)
}

/// Tail log file via SSH (POST /api/logs/tail)
pub async fn tail_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<LogTailResponse> {
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("/var/log/syslog");
    let lines = body.get("lines").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    // Get SSH connection — use first connected host or fall back to local
    let entry = state.connections.iter().next();
    let content = match entry {
        Some(e) => {
            let session = e.value().session.as_ref();
            match session {
                Some(s) => {
                    let cmd = format!("tail -n {} \"{}\" 2>/dev/null || echo 'File not found: {}'", lines, path, path);
                    match tokio::time::timeout(std::time::Duration::from_secs(15), s.exec(&cmd)).await {
                        Ok(Ok((stdout, _, _))) => Some(stdout),
                        _ => None,
                    }
                }
                None => None,
            }
        }
        None => {
            // Local fallback
            std::fs::read_to_string(path).ok()
        }
    };

    let content = content.unwrap_or_else(|| format!("Unable to read: {}", path));
    ApiResponse::success(LogTailResponse {
        content: Some(content.clone()),
        path: path.to_string(),
        lines: content.lines().count(),
        total_lines: content.lines().count(),
    })
}

/// Grep log file via SSH (POST /api/logs/grep)
pub async fn grep_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<GrepResponse> {
    let pattern = body.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("/var/log/syslog");

    if pattern.is_empty() {
        return ApiResponse::error(-1, "pattern required");
    }

    // Get SSH connection — use first connected host or fall back to local
    let entry = state.connections.iter().next();
    let content = match entry {
        Some(e) => {
            let session = e.value().session.as_ref();
            match session {
                Some(s) => {
                    let cmd = format!(
                        "grep -i '{}' \"{}\" 2>/dev/null | tail -200 || echo 'No matches or file not found'",
                        pattern, path
                    );
                    match tokio::time::timeout(std::time::Duration::from_secs(15), s.exec(&cmd)).await {
                        Ok(Ok((stdout, _, _))) => Some(stdout),
                        _ => None,
                    }
                }
                None => None,
            }
        }
        None => {
            // Local fallback
            std::process::Command::new("grep")
                .args(["-i", pattern, path])
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        }
    };

    let content = content.unwrap_or_else(|| format!("Unable to grep: {}", path));
    ApiResponse::success(GrepResponse { content, pattern: pattern.to_string(), path: path.to_string() })
}
