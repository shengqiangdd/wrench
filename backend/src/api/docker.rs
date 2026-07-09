use axum::{extract::State, Json};
use serde::Deserialize;
use std::sync::Arc;

use crate::api_types::DockerExecResponse;
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::utils::escape_sh_arg;

/// Common request: just connectionId
#[derive(Debug, Deserialize)]
pub struct ConnRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
}

/// Docker ps request
#[derive(Debug, Deserialize)]
pub struct PsRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub all: Option<bool>,
}

/// Docker container action request
#[derive(Debug, Deserialize)]
pub struct ActionRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
}

/// Docker rmi request
#[derive(Debug, Deserialize)]
pub struct RmiRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
    pub force: Option<bool>,
}

/// Docker pull/push request
#[derive(Debug, Deserialize)]
pub struct ImageRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub image: String,
}

/// Docker tag request
#[derive(Debug, Deserialize)]
pub struct TagRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    #[serde(alias = "source")]
    pub id: String,
    #[serde(alias = "target")]
    pub tag: String,
}

/// Docker history request
#[derive(Debug, Deserialize)]
pub struct HistoryRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
}

/// Docker logs request
#[derive(Debug, Deserialize)]
pub struct LogsRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
    pub tail: Option<u32>,
}

/// Docker inspect request
#[derive(Debug, Deserialize)]
pub struct InspectRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
}

/// Docker stats request
#[derive(Debug, Deserialize)]
pub struct StatsRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
}

/// Docker compose request
#[derive(Debug, Deserialize)]
pub struct ComposeRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    #[serde(alias = "filePath")]
    pub file_path: Option<String>,
}

/// Docker compose action request
#[derive(Debug, Deserialize)]
pub struct ComposeActionRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    #[serde(alias = "filePath")]
    pub path: String,
    pub action: String,
    pub service: Option<String>,
}

/// Docker exec request — run command in a container
#[derive(Debug, Deserialize)]
pub struct DockerExecRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
    pub command: String,
    pub shell: Option<String>,
}

// ─── Helper: execute docker command via SSH ───

async fn docker_exec(state: &Arc<AppState>, connection_id: &str, docker_args: &[&str]) -> Result<String, String> {
    let (host, username, session) = {
        let entry = state.connections.get(connection_id);
        match entry {
            Some(c) => (c.host.clone(), c.username.clone(), c.session.clone()),
            None => return Err("SSH session not found or not connected".to_string()),
        }
    };

    let session = session.ok_or_else(|| "SSH session not found or not connected".to_string())?;

    // Build the docker command with proper shell escaping
    let command = {
        let mut s = String::from("docker");
        for arg in docker_args {
            s.push(' ');
            s.push_str(&escape_sh_arg(arg));
        }
        s
    };

    let (stdout, stderr, exit_code) = session
        .exec(&command)
        .await
        .map_err(|e| format!("Docker exec failed: {}", e))?;

    // Log docker command execution for debugging
    tracing::info!(
        "Docker exec: command='{}' exit_code={} stdout_len={} stderr_len={}",
        command,
        exit_code,
        stdout.len(),
        stderr.len()
    );

    // If docker command fails, try docker-compose fallback for compose subcommands
    if exit_code != 0 && !docker_args.is_empty() && docker_args[0] == "compose" {
        let mut fallback_args = Vec::with_capacity(docker_args.len());
        fallback_args.push("compose");
        for arg in &docker_args[1..] {
            fallback_args.push(arg);
        }
        let fallback_cmd = {
            let mut s = String::from("docker-compose");
            for arg in &fallback_args {
                s.push(' ');
                s.push_str(&escape_sh_arg(arg));
            }
            s
        };
        tracing::info!("Trying fallback: '{}'", fallback_cmd);
        if let Ok((out2, err2, code2)) = session.exec(&fallback_cmd).await {
            if code2 == 0 {
                tracing::info!("Fallback succeeded, stdout_len={}", out2.len());
                return Ok(out2);
            }
            tracing::warn!("Fallback also failed: exit_code={} stderr={}", code2, err2.chars().take(300).collect::<String>());
        }
    }

    if exit_code != 0 {
        // 命令失败：优先返回 stderr，其次 stdout，最后通用错误
        let msg = if !stderr.is_empty() {
            stderr.trim().to_string()
        } else if !stdout.is_empty() {
            stdout.trim().to_string()
        } else {
            format!("docker command exited with code {}", exit_code)
        };
        return Err(msg);
    }

    // Audit log mutating docker operations
    let action_id = docker_args.first().copied().unwrap_or("");
    let is_readonly = matches!(action_id, "ps" | "images" | "history" | "stats" | "inspect")
        || (action_id == "compose" && docker_args.get(1).copied() == Some("ls"));
    if !is_readonly {
        let ip = "0.0.0.0".to_string();
        state.add_audit_log(
            &format!("docker_{}", action_id.replace('-', "_")),
            serde_json::json!({
                "connection_id": connection_id,
                "host": host,
                "username": username,
                "args": docker_args,
                "cmd": command,
            }),
            &ip,
        );
    }

    Ok(stdout)
}

// ─── Handlers ───

/// POST /api/docker/ps
pub async fn docker_ps(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PsRequest>,
) -> ApiResponse<DockerExecResponse> {
    let mut args = vec!["ps", "--format", "json", "--no-trunc"];
    if req.all.unwrap_or(false) {
        args.push("-a");
    }
    match docker_exec(&state, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/images
pub async fn docker_images(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ConnRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["images", "--format", "json", "--no-trunc"]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/start
pub async fn start_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_start",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
    );
    match docker_exec(&state, &req.connection_id, &["start", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/stop
pub async fn stop_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_stop",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
    );
    match docker_exec(&state, &req.connection_id, &["stop", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/restart
pub async fn restart_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_restart",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
    );
    match docker_exec(&state, &req.connection_id, &["restart", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/logs
pub async fn container_logs(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LogsRequest>,
) -> ApiResponse<DockerExecResponse> {
    let tail_flag = format!("--tail={}", req.tail.unwrap_or(100));
    match docker_exec(&state, &req.connection_id, &["logs", &tail_flag, "--timestamps", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/inspect
pub async fn inspect_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<InspectRequest>,
) -> ApiResponse<crate::api_types::DockerInspectResponse> {
    match docker_exec(&state, &req.connection_id, &["inspect", &req.id]).await {
        Ok(data) => {
            let parsed: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::json!([data]));
            ApiResponse::success(crate::api_types::DockerInspectResponse { data: parsed })
        }
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/rmi
pub async fn remove_image(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RmiRequest>,
) -> ApiResponse<DockerExecResponse> {
    let mut args = vec!["rmi"];
    if req.force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&req.id);
    match docker_exec(&state, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/rm — Remove Docker container
pub async fn remove_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RmiRequest>,
) -> ApiResponse<DockerExecResponse> {
    let mut args = vec!["rm"];
    if req.force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&req.id);
    match docker_exec(&state, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/exec — Run a one-shot command inside a container
pub async fn exec_container(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DockerExecRequest>,
) -> ApiResponse<crate::api_types::DockerExecResultResponse> {
    let args: Vec<String> = if let Some(shell) = &req.shell {
        vec![
            "exec".into(),
            "-it".into(),
            req.id.clone(),
            shell.clone(),
            "-c".into(),
            req.command.clone(),
        ]
    } else {
        vec!["exec".into(), req.id.clone(), req.command.clone()]
    };
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match docker_exec(&state, &req.connection_id, &args_ref).await {
        Ok(data) => ApiResponse::success(crate::api_types::DockerExecResultResponse { data, exit_code: 0 }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/pull
pub async fn pull_image(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImageRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["pull", &req.image]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/push
pub async fn push_image(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImageRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["push", &req.image]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/tag
pub async fn tag_image(
    State(state): State<Arc<AppState>>,
    Json(req): Json<TagRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["tag", &req.id, &req.tag]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/prune
pub async fn prune_images(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ConnRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["image", "prune", "-f"]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/history
pub async fn image_history(
    State(state): State<Arc<AppState>>,
    Json(req): Json<HistoryRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &req.connection_id,
        &["history", &req.id, "--format", "json", "--no-trunc"],
    )
    .await
    {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/stats
pub async fn container_stats(
    State(state): State<Arc<AppState>>,
    Json(req): Json<StatsRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &req.connection_id,
        &["stats", &req.id, "--no-stream", "--format", "json"],
    )
    .await
    {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// Docker batch stats request (no per-container id, gets all)
#[derive(Debug, Deserialize)]
pub struct BatchStatsRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
}

/// POST /api/docker/stats/all — Get stats for all running containers at once
pub async fn container_stats_all(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BatchStatsRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &req.connection_id,
        &["stats", "--no-stream", "--format", "json"],
    )
    .await
    {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/compose
pub async fn compose_list(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComposeRequest>,
) -> ApiResponse<serde_json::Value> {
    // 如果有 filePath，直接返回该文件
    if let Some(file_path) = &req.file_path {
        let path = std::path::Path::new(file_path);
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");
        return ApiResponse::success(serde_json::json!({
            "projects": [{
                "path": file_path,
                "name": name,
                "status": "",
                "id": "",
            }]
        }));
    }

    match docker_exec(&state, &req.connection_id, &["compose", "ls", "--format", "json"]).await {
        Ok(data) => {
            // docker compose ls --format json 输出一个 JSON 数组
            // 格式: [{"ID":"xxx","Name":"project","Status":"Running(2)","ConfigFiles":"/path/to/docker-compose.yml"}]
            let trimmed = data.trim();
            if trimmed.is_empty() {
                return ApiResponse::success(serde_json::json!({ "projects": [] }));
            }

            // 尝试整体解析为 JSON 数组
            let items: Vec<serde_json::Value> = if trimmed.starts_with('[') {
                serde_json::from_str(trimmed).unwrap_or_default()
            } else {
                // fallback: 逐行解析（兼容旧版本）
                trimmed
                    .lines()
                    .filter(|line| !line.is_empty())
                    .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
                    .collect()
            };

            let projects: Vec<serde_json::Value> = items
                .iter()
                .map(|item| {
                    let config_files = item.get("ConfigFiles").and_then(|v| v.as_str()).unwrap_or("");
                    let name = item.get("Name").and_then(|v| v.as_str()).unwrap_or("");
                    let status = item.get("Status").and_then(|v| v.as_str()).unwrap_or("");
                    let id = item.get("ID").and_then(|v| v.as_str()).unwrap_or("");
                    serde_json::json!({
                        "path": config_files,
                        "name": name,
                        "status": status,
                        "id": id,
                    })
                })
                .collect();
            ApiResponse::success(serde_json::json!({ "projects": projects }))
        }
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/compose/action
pub async fn compose_action(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComposeActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    let action_cmd: &str = &req.action;

    // Build args: docker compose -f <path> <action>
    let mut args: Vec<&str> = vec!["compose", "-f", &req.path, action_cmd];
    if let Some(service) = &req.service {
        args.push(service);
    }
    if req.action == "up" {
        args.push("-d");
    }
    if req.action == "ps" {
        args.push("--format");
        args.push("json");
    }
    if req.action == "logs" {
        args.push("--tail=200");
        args.push("--timestamps");
    }

    match docker_exec(&state, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}
