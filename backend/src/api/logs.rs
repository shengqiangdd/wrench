use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{GrepResponse, LogScanResult, LogSource, LogTailResponse};
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
            // 先尝试直接读取，失败则用 sudo
            let escaped_path = path.replace('\'', "'\\''");
            let cmd = format!(
                "tail -n {lines} '{path}' 2>/dev/null || sudo -n tail -n {lines} '{path}' 2>/dev/null || sudo tail -n {lines} '{path}' 2>&1 || echo 'Unable to read: {path}'",
                lines = lines, path = escaped_path
            );
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
            let escaped_pattern = pattern.replace('\'', "'\\''");
            let escaped_path = path.replace('\'', "'\\''");
            // 先尝试直接 grep，失败则用 sudo
            let cmd = format!(
                "grep -i '{pat}' '{path}' 2>/dev/null | tail -200 || sudo -n grep -i '{pat}' '{path}' 2>/dev/null | tail -200 || sudo grep -i '{pat}' '{path}' 2>&1 | tail -200 || echo 'No matches or file not found'",
                pat = escaped_pattern, path = escaped_path
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

/// Scan log files on remote host (POST /api/logs/scan)
/// 接收一组路径，通过 SSH 检查哪些存在并返回大小
pub async fn scan_log_sources(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<Vec<LogScanResult>> {
    let connection_id = body.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");
    let paths: Vec<String> = body
        .get("paths")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if paths.is_empty() {
        return ApiResponse::success(Vec::new());
    }

    // 获取 SSH session
    let session = if !connection_id.is_empty() {
        state.connections.get(connection_id).and_then(|c| c.session.clone())
    } else {
        state.connections.iter().next().and_then(|e| e.value().session.clone())
    };

    let mut results: Vec<LogScanResult> = Vec::new();

    if let Some(s) = session {
        // 用一条命令检查所有文件：存在则输出 "path\tsize"，否则输出空
        // 支持 sudo：先尝试直接访问，失败则用 sudo
        let checks: Vec<String> = paths.iter()
            .map(|p| {
                let ep = p.replace('\'', "'\\''");
                format!(
                    "sz=''; \
                     if [ -r '{p}' ]; then sz=$(du -sh '{p}' 2>/dev/null | cut -f1); \
                     elif sudo -n [ -r '{p}' ] 2>/dev/null; then sz=$(sudo -n du -sh '{p}' 2>/dev/null | cut -f1); \
                     elif command -v sudo >/dev/null 2>&1; then sz=$(echo | sudo -S du -sh '{p}' 2>/dev/null | cut -f1); fi; \
                     [ -n \"$sz\" ] && printf '{p}\\t%s\\n' \"$sz\"",
                    p = ep
                )
            })
            .collect();
        let cmd = checks.join("; ");

        if let Ok((stdout, _, _)) = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            s.exec(&cmd),
        ).await.unwrap_or(Ok((String::new(), String::new(), 0))) {
            // 解析输出
            let found: std::collections::HashMap<String, String> = stdout.lines()
                .filter_map(|line| {
                    let parts: Vec<&str> = line.split('\t').collect();
                    if parts.len() >= 2 {
                        Some((parts[0].to_string(), parts[1].to_string()))
                    } else {
                        None
                    }
                })
                .collect();

            for path in &paths {
                if let Some(size) = found.get(path) {
                    results.push(LogScanResult { path: path.clone(), size: size.clone(), exists: true });
                } else {
                    results.push(LogScanResult { path: path.clone(), size: String::new(), exists: false });
                }
            }
        } else {
            // 超时或错误，全部标记为不存在
            for path in &paths {
                results.push(LogScanResult { path: path.clone(), size: String::new(), exists: false });
            }
        }
    } else {
        // 本地 fallback
        for path in &paths {
            if let Ok(meta) = std::fs::metadata(path) {
                let size = if meta.len() >= 1_073_741_824 {
                    format!("{:.1}G", meta.len() as f64 / 1_073_741_824.0)
                } else if meta.len() >= 1_048_576 {
                    format!("{:.1}M", meta.len() as f64 / 1_048_576.0)
                } else if meta.len() >= 1024 {
                    format!("{:.1}K", meta.len() as f64 / 1024.0)
                } else {
                    format!("{}B", meta.len())
                };
                results.push(LogScanResult { path: path.clone(), size, exists: true });
            } else {
                results.push(LogScanResult { path: path.clone(), size: String::new(), exists: false });
            }
        }
    }

    ApiResponse::success(results)
}
