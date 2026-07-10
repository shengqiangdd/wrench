use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::{GrepResponse, LogScanResult, LogSource, LogTailResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

fn get_session(state: &Arc<AppState>, connection_id: &str) -> Option<Arc<crate::ssh::SshSession>> {
    if !connection_id.is_empty() {
        if let Some(c) = state.connections.get(connection_id) {
            return c.session.clone();
        }
    }
    // fallback: 第一个有 session 的连接
    for entry in state.connections.iter() {
        if entry.value().session.is_some() {
            return entry.value().session.clone();
        }
    }
    None
}

fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Scan log files on remote host (POST /api/logs/scan)
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

    let session = match get_session(&state, connection_id) {
        Some(s) => s,
        None => {
            // 无连接时全部标记不存在
            let results: Vec<LogScanResult> = paths.into_iter()
                .map(|p| LogScanResult { path: p, size: String::new(), exists: false })
                .collect();
            return ApiResponse::success(results);
        }
    };

    // 两条简单命令：1) find 发现 .log 文件（排除压缩/轮转）  2) 检查预定义路径
    // find 发现 .log 文件和编号轮转文件（如 boot.log.3），排除压缩文件和二进制文件
    let find_cmd = concat!(
        "find /var/log -maxdepth 3 -type f \\( -name '*.log' -o -name '*.log.[0-9]' -o -name '*.log.[0-9][0-9]' \\) ",
        "! -name '*.gz' ! -name '*.bz2' ! -name '*.xz' ! -name '*.zst' ! -name '*.Z' ! -name '*.zip' ",
        "! -name 'btmp*' ! -name 'wtmp*' ! -name 'lastlog' ! -name 'faillog' ",
        "2>/dev/null | head -50"
    );

    let mut results: Vec<LogScanResult> = Vec::new();

    // 1. 先用 find 发现真实文件
    let mut found_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if let Ok(Ok((stdout, _, _))) = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        session.exec(find_cmd),
    ).await {
        for line in stdout.lines() {
            let path = line.trim().to_string();
            if !path.is_empty() && path.starts_with('/') {
                found_map.insert(path, String::new());
            }
        }
    }

    // 2. 用一条命令批量获取所有已发现文件的大小
    if !found_map.is_empty() {
        let size_cmd = found_map.keys()
            .map(|p| {
                let ep = sq(p);
                format!("du -sh {ep} 2>/dev/null")
            })
            .collect::<Vec<_>>()
            .join("; ");
        if let Ok(Ok((stdout, _, _))) = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            session.exec(&size_cmd),
        ).await {
            for line in stdout.lines() {
                // "4.0K    /var/log/foo.log"
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    let size = parts[0].trim().to_string();
                    let path = parts[1].trim().to_string();
                    if let Some(v) = found_map.get_mut(&path) {
                        *v = size;
                    }
                }
            }
        }
    }

    // 3. 也检查前端传来的预定义路径（可能 find 没覆盖到的，如 dmesg, btmp, wtmp）
    let check_paths: Vec<String> = paths.iter()
        .filter(|p| !found_map.contains_key(p.as_str()))
        .cloned()
        .collect();
    if !check_paths.is_empty() {
        let check_cmd = check_paths.iter()
            .map(|p| {
                let ep = sq(p);
                format!("[ -e {ep} ] && du -sh {ep} 2>/dev/null || true")
            })
            .collect::<Vec<_>>()
            .join("; ");
        if let Ok(Ok((stdout, _, _))) = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            session.exec(&check_cmd),
        ).await {
            for line in stdout.lines() {
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                if parts.len() == 2 {
                    let size = parts[0].trim().to_string();
                    let path = parts[1].trim().to_string();
                    if !size.is_empty() {
                        found_map.insert(path, size);
                    }
                }
            }
        }
    }

    // 4. 构建结果：前端传来的路径标记 exists
    for path in &paths {
        if let Some(size) = found_map.get(path) {
            results.push(LogScanResult { path: path.clone(), size: size.clone(), exists: true });
        } else {
            results.push(LogScanResult { path: path.clone(), size: String::new(), exists: false });
        }
    }

    // 5. 追加 find 发现的额外文件
    for (found_path, size) in &found_map {
        if !paths.iter().any(|p| p == found_path) {
            results.push(LogScanResult { path: found_path.clone(), size: size.clone(), exists: true });
        }
    }

    ApiResponse::success(results)
}

/// Tail log file via SSH (POST /api/logs/tail)
pub async fn tail_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<LogTailResponse> {
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("/var/log/syslog");
    let lines = body.get("lines").and_then(|v| v.as_u64()).unwrap_or(200) as usize;
    let connection_id = body.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");

    let content = match get_session(&state, connection_id) {
        Some(s) => {
            let p = sq(path);
            // -a 让 tail 把二进制文件当文本处理，避免 btmp 等出乱码
            let cmd = format!(
                "tail -a -n {lines} {p} 2>&1; __rc=$?; \
                 if [ $__rc -ne 0 ]; then sudo -n tail -a -n {lines} {p} 2>&1; __rc2=$?; \
                   if [ $__rc2 -ne 0 ]; then echo ''; echo '--- 读取失败（文件不存在或无权限） ---'; fi; \
                 fi",
                p = p, lines = lines
            );
            match tokio::time::timeout(std::time::Duration::from_secs(15), s.exec(&cmd)).await {
                Ok(Ok((stdout, _, _))) => {
                    let trimmed = stdout.trim();
                    if trimmed.ends_with("读取失败（文件不存在或无权限）") {
                        let body = trimmed.strip_suffix("--- 读取失败（文件不存在或无权限） ---").unwrap_or("").trim();
                        if body.is_empty() {
                            format!("无法读取: {path}\n\n可能原因：文件不存在或权限不足（无 sudo）")
                        } else {
                            format!("{body}\n\n--- 读取失败（文件不存在或无权限） ---")
                        }
                    } else {
                        stdout
                    }
                }
                _ => format!("连接超时: {path}"),
            }
        }
        None => "无 SSH 连接".to_string(),
    };

    let total = content.lines().count();
    ApiResponse::success(LogTailResponse {
        content: Some(content),
        path: path.to_string(),
        lines: total,
        total_lines: total,
    })
}

/// Grep log file via SSH (POST /api/logs/grep)
pub async fn grep_log(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<GrepResponse> {
    let pattern = body.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
    let path = body.get("path").and_then(|v| v.as_str()).unwrap_or("/var/log/syslog");
    let connection_id = body.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");

    if pattern.is_empty() {
        return ApiResponse::error(-1, "pattern required");
    }

    let content = match get_session(&state, connection_id) {
        Some(s) => {
            let pat = sq(pattern);
            let pth = sq(path);
            let cmd = format!(
                "grep -a -i {pat} {pth} 2>&1 | tail -200; __rc=$?; \
                 if [ $__rc -ne 0 ]; then sudo -n grep -a -i {pat} {pth} 2>&1 | tail -200; __rc2=$?; \
                   if [ $__rc2 -ne 0 ]; then echo '--- 搜索失败（文件不存在或无权限） ---'; fi; \
                 fi",
                pat = pat, pth = pth
            );
            match tokio::time::timeout(std::time::Duration::from_secs(15), s.exec(&cmd)).await {
                Ok(Ok((stdout, _, _))) => {
                    let trimmed = stdout.trim();
                    if trimmed == "--- 搜索失败（文件不存在或无权限） ---" {
                        format!("无法搜索: {path}\n\n可能原因：文件不存在或权限不足（无 sudo）")
                    } else {
                        stdout
                    }
                }
                _ => "搜索超时".to_string(),
            }
        }
        None => "无 SSH 连接".to_string(),
    };

    ApiResponse::success(GrepResponse { content, pattern: pattern.to_string(), path: path.to_string() })
}

/// List available log sources (POST /api/logs/list-sources)
pub async fn list_sources(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<Vec<LogSource>> {
    let connection_id = body.get("connectionId").and_then(|v| v.as_str()).unwrap_or("");

    let mut sources: Vec<LogSource> = Vec::new();

    if let Some(s) = get_session(&state, connection_id) {
        let cmd = concat!(
            "find /var/log -maxdepth 2 -type f \\( -name '*.log' -o -name '*.log.[0-9]' -o -name '*.log.[0-9][0-9]' \\) ",
            "! -name '*.gz' ! -name '*.bz2' ! -name '*.xz' ! -name '*.zst' ",
            "! -name 'btmp*' ! -name 'wtmp*' ! -name 'lastlog' ",
            "2>/dev/null | head -30"
        );
        if let Ok(Ok((stdout, _, _))) = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            s.exec(cmd),
        ).await {
            for line in stdout.lines() {
                let path = line.trim().to_string();
                if !path.is_empty() && path.starts_with('/') {
                    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
                    sources.push(LogSource { path, label: name });
                }
            }
        }
    }
    if sources.is_empty() {
        sources.push(LogSource { path: "/var/log/syslog".into(), label: "syslog".into() });
    }

    ApiResponse::success(sources)
}
