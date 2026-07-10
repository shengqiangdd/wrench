use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{GrepResponse, LogSource, LogTailResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available log sources (POST /api/logs/list-sources)
pub async fn list_sources(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<Vec<LogSource>> {
    let connection_id = body.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");

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
    ];

    // 通过 SSH 检查远程主机上哪些日志文件存在
    let session = if !connection_id.is_empty() {
        state.connections.get(connection_id).and_then(|c| c.session.clone())
    } else {
        state.connections.iter().next().and_then(|e| e.value().session.clone())
    };

    let mut sources: Vec<LogSource> = Vec::new();

    if let Some(s) = session {
        // 用一条命令检查所有文件是否存在
        let checks: Vec<String> = common_logs.iter()
            .map(|(path, _)| format!("[ -f {} ] && echo {} || true", path, path))
            .collect();
        let cmd = checks.join("; ");
        if let Ok((stdout, _, _)) = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            s.exec(&cmd),
        ).await.unwrap_or(Ok((String::new(), String::new(), 0))) {
            let existing: Vec<&str> = stdout.lines()
                .filter(|l| l.starts_with('/') && !l.contains("File not found"))
                .collect();
            for log_path in existing {
                for (p, label) in &common_logs {
                    if *p == log_path {
                        sources.push(LogSource { path: log_path.to_string(), label: label.to_string() });
                        break;
                    }
                }
            }
        }
    } else {
        // 本地 fallback
        for (path, label) in &common_logs {
            if std::path::Path::new(path).exists() {
                sources.push(LogSource { path: path.to_string(), label: label.to_string() });
            }
        }
    }

    // 始终包含 syslog 作为兜底
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
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // 按 connectionId 查找指定主机的 SSH 连接
    let session = if !connection_id.is_empty() {
        state.connections.get(connection_id).and_then(|c| c.session.clone())
    } else {
        state.connections.iter().next().and_then(|e| e.value().session.clone())
    };

    let content = match session {
        Some(s) => {
            let cmd = format!("tail -n {} \"{}\" 2>/dev/null || echo 'File not found: {}'", lines, path, path);
            match tokio::time::timeout(std::time::Duration::from_secs(15), s.exec(&cmd)).await {
                Ok(Ok((stdout, _, _))) => Some(stdout),
                _ => None,
            }
        }
        None => None,
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
    let connection_id = body
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if pattern.is_empty() {
        return ApiResponse::error(-1, "pattern required");
    }

    // 按 connectionId 查找指定主机的 SSH 连接
    let session = if !connection_id.is_empty() {
        state.connections.get(connection_id).and_then(|c| c.session.clone())
    } else {
        state.connections.iter().next().and_then(|e| e.value().session.clone())
    };

    let content = match session {
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
    };

    let content = content.unwrap_or_else(|| format!("Unable to grep: {}", path));
    ApiResponse::success(GrepResponse { content, pattern: pattern.to_string(), path: path.to_string() })
}
