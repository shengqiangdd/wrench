use axum::{
    Json,
    extract::{Extension, State},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::api_types::{
    DockerComposeListResponse, DockerComposeProject, DockerComposeService, DockerContainerInfo, DockerContainerStats,
    DockerDiagnoseResponse, DockerExecResponse, DockerPsResponse, DockerStatsResponse,
};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::space::SpaceCtx;
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
    #[serde(default, rename = "requestId")]
    pub request_id: Option<String>,
}

/// Docker exec request — run command in a container
#[derive(Debug, Deserialize)]
pub struct DockerExecRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
    pub id: String,
    pub command: String,
    pub shell: Option<String>,
    #[serde(default, rename = "requestId")]
    pub request_id: Option<String>,
}

// ─── Helper: execute docker command via SSH ───

// Compose actions are user-facing API responses. Bound both streams so an
// accidental `logs` invocation cannot grow backend memory without limit.
const DOCKER_API_MAX_STDOUT_BYTES: usize = 2 * 1024 * 1024;
const DOCKER_API_MAX_STDERR_BYTES: usize = 64 * 1024;

struct DockerExecOutput {
    stdout: String,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

/// Legacy `docker-compose` already is the Compose command, unlike the v2
/// plugin form (`docker compose`). Remove only that v2 prefix on fallback.
fn legacy_compose_args<'a>(docker_args: &'a [&'a str]) -> &'a [&'a str] {
    docker_args.get(1..).unwrap_or_default()
}

async fn docker_exec(
    state: &Arc<AppState>,
    space_id: &str,
    connection_id: &str,
    docker_args: &[&str],
) -> Result<String, String> {
    docker_exec_limited(
        state,
        space_id,
        connection_id,
        docker_args,
        DOCKER_API_MAX_STDOUT_BYTES,
        DOCKER_API_MAX_STDERR_BYTES,
        None,
    )
    .await
    .map(|output| {
        let mut stdout = output.stdout;
        if output.stdout_truncated {
            stdout.push_str("\n[output truncated at API limit]");
        }
        stdout
    })
}

async fn docker_exec_limited(
    state: &Arc<AppState>,
    space_id: &str,
    connection_id: &str,
    docker_args: &[&str],
    max_stdout_bytes: usize,
    max_stderr_bytes: usize,
    cancel: Option<tokio_util::sync::CancellationToken>,
) -> Result<DockerExecOutput, String> {
    let (host, username, session) = {
        let entry = state.connection_in(space_id, connection_id);
        match entry {
            Some(c) => (c.host.clone(), c.username.clone(), c.session.clone()),
            None => return Err("SSH session not found or not connected".to_string()),
        }
    };

    let session = session.ok_or_else(|| "SSH session not found or not connected".to_string())?;

    // Build the docker command with proper shell escaping
    let command = {
        // Compose/BuildKit 的动态进度会通过 CSI 光标回移整块重绘，在移动端
        // PTY 高度不足时被写入 scrollback，造成大量重复行和额外网络 I/O。
        // 使用环境变量比拼接 --progress 更兼容不同 Docker Compose 版本。
        let mut s = if docker_args.first() == Some(&"compose")
            || docker_args.first() == Some(&"build")
            || docker_args.first() == Some(&"buildx")
        {
            String::from("COMPOSE_PROGRESS=plain BUILDKIT_PROGRESS=plain DOCKER_CLI_HINTS=false docker")
        } else {
            String::from("docker")
        };
        for arg in docker_args {
            s.push(' ');
            s.push_str(&escape_sh_arg(arg));
        }
        s
    };

    let output = if let Some(cancel) = cancel.clone() {
        session
            .exec_limited_cancellable(&command, max_stdout_bytes, max_stderr_bytes, cancel)
            .await
    } else {
        session.exec_limited(&command, max_stdout_bytes, max_stderr_bytes).await
    }
    .map_err(|e| format!("Docker exec failed: {}", e))?;
    let stdout = output.stdout;
    let stderr = output.stderr;
    let stdout_truncated = output.stdout_truncated;
    let stderr_truncated = output.stderr_truncated;
    let exit_code = output.exit_code;

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
        let fallback_cmd = {
            let mut s =
                String::from("COMPOSE_PROGRESS=plain BUILDKIT_PROGRESS=plain DOCKER_CLI_HINTS=false docker-compose");
            for arg in legacy_compose_args(docker_args) {
                s.push(' ');
                s.push_str(&escape_sh_arg(arg));
            }
            s
        };
        tracing::info!("Trying fallback: '{}'", fallback_cmd);
        let fallback = if let Some(cancel) = cancel.clone() {
            if cancel.is_cancelled() {
                return Err("Docker exec cancelled".to_string());
            }
            session
                .exec_limited_cancellable(&fallback_cmd, max_stdout_bytes, max_stderr_bytes, cancel)
                .await
        } else {
            session
                .exec_limited(&fallback_cmd, max_stdout_bytes, max_stderr_bytes)
                .await
        };
        if let Ok(output2) = fallback {
            if output2.exit_code == 0 {
                tracing::info!("Fallback succeeded, stdout_len={}", output2.stdout.len());
                return Ok(DockerExecOutput {
                    stdout: output2.stdout,
                    stdout_truncated: output2.stdout_truncated,
                    stderr_truncated: output2.stderr_truncated,
                });
            }
            tracing::warn!(
                "Fallback also failed: exit_code={} stderr={}",
                output2.exit_code,
                output2.stderr.chars().take(300).collect::<String>()
            );
        }
    }

    if exit_code != 0 {
        // 命令失败：优先返回 stderr，其次 stdout，最后通用错误
        let (msg, stream, truncated) = if !stderr.is_empty() {
            (stderr.trim().to_string(), "stderr", stderr_truncated)
        } else if !stdout.is_empty() {
            (stdout.trim().to_string(), "stdout", stdout_truncated)
        } else {
            (format!("docker command exited with code {}", exit_code), "", false)
        };
        let msg = if truncated {
            format!("{msg}\n[{stream} output truncated at API limit]")
        } else {
            msg
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
            space_id,
        );
    }

    Ok(DockerExecOutput { stdout, stdout_truncated, stderr_truncated })
}

// ─── Handlers ───

/// POST /api/docker/ps
pub async fn docker_ps(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<PsRequest>,
) -> ApiResponse<DockerPsResponse> {
    let mut args = vec!["ps", "--format", "json", "--no-trunc"];
    if req.all.unwrap_or(false) {
        args.push("-a");
    }
    match docker_exec(&state, &space.id, &req.connection_id, &args).await {
        Ok(data) => {
            let containers = parse_docker_ps(&data);
            ApiResponse::success(DockerPsResponse { containers })
        }
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// Parse `docker ps --format json` output into structured data
fn parse_docker_ps(output: &str) -> Vec<DockerContainerInfo> {
    output
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(DockerContainerInfo {
                id: extract_json_str(&v, &["ID"]),
                name: extract_json_str(&v, &["Names"]),
                image: extract_json_str(&v, &["Image"]),
                state: extract_json_str(&v, &["State"]),
                status: extract_json_str(&v, &["Status"]),
                ports: extract_json_str(&v, &["Ports"]),
                created: extract_json_str(&v, &["CreatedAt"]),
                command: extract_json_str(&v, &["Command"]),
                running_for: extract_json_str(&v, &["RunningFor"]),
                labels: extract_json_str(&v, &["Labels"]),
                mounts: extract_json_str(&v, &["Mounts"]),
                networks: extract_json_str(&v, &["Networks"]),
                size: extract_json_str(&v, &["Size"]),
            })
        })
        .collect()
}

/// Parse `docker stats --no-stream --format json` output into structured data
fn parse_docker_stats(output: &str) -> Vec<DockerContainerStats> {
    output
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(DockerContainerStats {
                id: extract_json_str(&v, &["Container"]),
                name: extract_json_str(&v, &["Name"]),
                cpu_percent: extract_json_str(&v, &["CPUPerc"]),
                mem_usage: extract_json_str(&v, &["MemUsage"]),
                mem_percent: extract_json_str(&v, &["MemPerc"]),
                net_io: extract_json_str(&v, &["NetIO"]),
                block_io: extract_json_str(&v, &["BlockIO"]),
                pids: extract_json_str(&v, &["PIDs"]),
            })
        })
        .collect()
}

/// Parse `docker compose ls --format json` output into structured data
fn parse_compose_ls(output: &str) -> Vec<DockerComposeProject> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return vec![];
    }
    let items: Vec<serde_json::Value> = if trimmed.starts_with('[') {
        serde_json::from_str(trimmed).unwrap_or_default()
    } else {
        trimmed
            .lines()
            .filter(|l| !l.is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    };
    items
        .into_iter()
        .map(|v| DockerComposeProject {
            id: extract_json_str(&v, &["ID"]),
            name: extract_json_str(&v, &["Name"]),
            status: extract_json_str(&v, &["Status"]),
            config_files: extract_json_str(&v, &["ConfigFiles"]),
        })
        .collect()
}

/// Parse `docker compose ps --format json` output into structured data
fn parse_compose_ps(output: &str) -> Vec<DockerComposeService> {
    output
        .trim()
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            Some(DockerComposeService {
                name: extract_json_str(&v, &["Name", "Service"]),
                image: extract_json_str(&v, &["Image"]),
                state: extract_json_str(&v, &["State", "state"]),
                status: extract_json_str(&v, &["Status", "status"]),
                ports: extract_json_str(&v, &["Publishers", "Ports"]),
                command: extract_json_str(&v, &["Command"]),
            })
        })
        .collect()
}

/// Helper: extract a string from a JSON value by trying multiple field names
fn extract_json_str(v: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(val) = v.get(*key) {
            match val {
                serde_json::Value::String(s) => return s.clone(),
                serde_json::Value::Null => continue,
                other => return other.to_string(),
            }
        }
    }
    String::new()
}

/// POST /api/docker/images
pub async fn docker_images(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ConnRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &space.id,
        &req.connection_id,
        &["images", "--format", "json", "--no-trunc"],
    )
    .await
    {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/start
pub async fn start_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_start",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
        &space.id,
    );
    match docker_exec(&state, &space.id, &req.connection_id, &["start", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/stop
pub async fn stop_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_stop",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
        &space.id,
    );
    match docker_exec(&state, &space.id, &req.connection_id, &["stop", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/restart
pub async fn restart_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    state.add_audit_log(
        "docker_restart",
        serde_json::json!({
            "connectionId": req.connection_id, "containerId": req.id
        }),
        "api",
        &space.id,
    );
    match docker_exec(&state, &space.id, &req.connection_id, &["restart", &req.id]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/logs
pub async fn container_logs(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<LogsRequest>,
) -> ApiResponse<DockerExecResponse> {
    let tail_flag = format!("--tail={}", req.tail.unwrap_or(100));
    match docker_exec(
        &state,
        &space.id,
        &req.connection_id,
        &["logs", &tail_flag, "--timestamps", &req.id],
    )
    .await
    {
        Ok(data) => ApiResponse::success(DockerExecResponse { data: clean_ansi_output(&data) }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/inspect
pub async fn inspect_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<InspectRequest>,
) -> ApiResponse<crate::api_types::DockerInspectResponse> {
    match docker_exec(&state, &space.id, &req.connection_id, &["inspect", &req.id]).await {
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
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<RmiRequest>,
) -> ApiResponse<DockerExecResponse> {
    let mut args = vec!["rmi"];
    if req.force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&req.id);
    match docker_exec(&state, &space.id, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/rm — Remove Docker container
pub async fn remove_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<RmiRequest>,
) -> ApiResponse<DockerExecResponse> {
    let mut args = vec!["rm"];
    if req.force.unwrap_or(false) {
        args.push("-f");
    }
    args.push(&req.id);
    match docker_exec(&state, &space.id, &req.connection_id, &args).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/exec — Run a one-shot command inside a container
pub async fn exec_container(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
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
    let cancel = match req.request_id.as_deref() {
        Some(id) => match state.register_exec(&space.id, id) {
            Some(token) => Some(token),
            None => return ApiResponse::error(409, "exec requestId is already running"),
        },
        None => None,
    };
    let result = docker_exec_limited(
        &state,
        &space.id,
        &req.connection_id,
        &args_ref,
        DOCKER_API_MAX_STDOUT_BYTES,
        DOCKER_API_MAX_STDERR_BYTES,
        cancel,
    )
    .await;
    if let Some(id) = req.request_id.as_deref() {
        state.finish_exec(&space.id, id);
    }
    match result {
        Ok(data) => ApiResponse::success(crate::api_types::DockerExecResultResponse {
            data: clean_ansi_output(&data.stdout),
            exit_code: 0,
        }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/pull
pub async fn pull_image(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ImageRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &space.id, &req.connection_id, &["pull", &req.image]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/push
pub async fn push_image(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ImageRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &space.id, &req.connection_id, &["push", &req.image]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/tag
pub async fn tag_image(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<TagRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &space.id, &req.connection_id, &["tag", &req.id, &req.tag]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/prune
pub async fn prune_images(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ConnRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &space.id, &req.connection_id, &["image", "prune", "-a", "-f"]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/history
pub async fn image_history(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<HistoryRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &space.id,
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
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<StatsRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(
        &state,
        &space.id,
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
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<BatchStatsRequest>,
) -> ApiResponse<DockerStatsResponse> {
    match docker_exec(
        &state,
        &space.id,
        &req.connection_id,
        &["stats", "--no-stream", "--format", "json"],
    )
    .await
    {
        Ok(data) => {
            let stats = parse_docker_stats(&data);
            ApiResponse::success(DockerStatsResponse { stats })
        }
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/compose
pub async fn compose_list(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ComposeRequest>,
) -> ApiResponse<DockerComposeListResponse> {
    // 如果有 filePath，直接返回该文件
    if let Some(file_path) = &req.file_path {
        let path = std::path::Path::new(file_path);
        let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown");
        return ApiResponse::success(DockerComposeListResponse {
            projects: vec![DockerComposeProject {
                id: String::new(),
                name: name.to_string(),
                status: String::new(),
                config_files: file_path.clone(),
            }],
        });
    }

    match docker_exec(&state, &space.id, &req.connection_id, &["compose", "ls", "--format", "json"]).await {
        Ok(data) => {
            let projects = parse_compose_ls(&data);
            ApiResponse::success(DockerComposeListResponse { projects })
        }
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// Response for compose actions that return raw text output
#[derive(Serialize)]
pub struct DockerComposeRawResponse {
    pub output: String,
}

/// Strip ANSI escape codes and normalize terminal line endings for clean API output.
fn clean_ansi_output(s: &str) -> String {
    // Compose may emit CSI/OSC even with plain progress requested. Keep this a
    // single pass: the old regex + replace/split/join pipeline scanned and
    // allocated the whole output several times for every compose action.
    const ESC: char = '\x1b';
    const BEL: char = '\x07';
    #[derive(Clone, Copy)]
    enum State {
        Normal,
        Escape,
        Csi {
            input_start: usize,
            output_start: usize,
            intermediate: bool,
        },
        Osc,
        OscEscape,
    }

    let mut output = String::with_capacity(s.len());
    let mut state = State::Normal;
    let mut sequence_start = 0;
    let mut output_start = 0;
    let mut pending_cr = false;

    for (index, character) in s.char_indices() {
        if pending_cr {
            if character == '\n' {
                output.push('\n');
                pending_cr = false;
                continue;
            }
            if let Some(line_start) = output.rfind('\n') {
                output.truncate(line_start + 1);
            } else {
                output.clear();
            }
            pending_cr = false;
        }
        match state {
            State::Normal => match character {
                ESC => {
                    sequence_start = index;
                    output_start = output.len();
                    state = State::Escape;
                }
                '\r' => {
                    // Defer CR until the next byte so CRLF remains a newline.
                    pending_cr = true;
                }
                _ => output.push(character),
            },
            State::Escape => match character {
                '[' => state = State::Csi { input_start: sequence_start, output_start, intermediate: false },
                ']' => state = State::Osc,
                _ => {
                    // Preserve unknown ESC sequences and process this character normally.
                    output.push_str(&s[sequence_start..index]);
                    state = State::Normal;
                    if character == '\r' {
                        pending_cr = true;
                    } else if character == ESC {
                        sequence_start = index;
                        output_start = output.len();
                        state = State::Escape;
                    } else {
                        output.push(character);
                    }
                }
            },
            State::Csi { input_start, output_start: csi_output_start, intermediate } => {
                let code = character as u32;
                if (0x30..=0x3f).contains(&code) {
                    // CSI parameter bytes.
                } else if (0x20..=0x2f).contains(&code) && !intermediate {
                    state = State::Csi { input_start, output_start: csi_output_start, intermediate: true };
                } else if (0x40..=0x7e).contains(&code) {
                    state = State::Normal;
                    output.truncate(csi_output_start);
                } else {
                    // The regex only removed syntactically valid CSI. Restore
                    // malformed/incomplete input and process this byte normally.
                    output.push_str(&s[input_start..index]);
                    state = State::Normal;
                    if character == '\r' {
                        pending_cr = true;
                    } else if character == ESC {
                        sequence_start = index;
                        output_start = output.len();
                        state = State::Escape;
                    } else {
                        output.push(character);
                    }
                }
            }
            State::Osc => match character {
                BEL => {
                    state = State::Normal;
                    output.truncate(output_start);
                }
                ESC => state = State::OscEscape,
                _ => {}
            },
            State::OscEscape => {
                if character == '\\' {
                    state = State::Normal;
                    output.truncate(output_start);
                } else {
                    // An ESC inside OSC cancels that string unless followed by ST.
                    output.push_str(&s[sequence_start..index]);
                    state = State::Normal;
                    if character == ESC {
                        sequence_start = index;
                        output_start = output.len();
                        state = State::Escape;
                    } else {
                        output.push(character);
                    }
                }
            }
        }
    }

    if pending_cr {
        if let Some(line_start) = output.rfind('\n') {
            output.truncate(line_start + 1);
        } else {
            output.clear();
        }
    }

    // Incomplete sequences were not removed by the old regex pipeline.
    if !matches!(state, State::Normal) {
        output.push_str(&s[sequence_start..]);
    }
    output
}

/// Clean Compose status output while retaining real output.
fn clean_compose_action_output(s: &str) -> String {
    // clean_ansi_output already collapses CR-delimited redraw frames. Keep
    // newline-delimited duplicates: two identical status/log lines may be
    // genuine output and cannot be distinguished safely after the fact.
    clean_ansi_output(s)
}

/// POST /api/docker/compose/action
pub async fn compose_action(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ComposeActionRequest>,
) -> Result<axum::Json<serde_json::Value>, axum::Json<serde_json::Value>> {
    let action_cmd: &str = &req.action;

    // Build args: docker compose -f <path> <action> [options] [service]
    let mut args: Vec<&str> = vec!["compose", "-f", &req.path, action_cmd];
    if req.action == "up" {
        args.push("-d");
    }
    if req.action == "ps" {
        args.push("--format");
        args.push("json");
    }
    if req.action == "logs" {
        args.push("--tail=200");
    }
    // Compose expects action options before positional service names. This is
    // accepted by some versions in the reverse order, but not all of them.
    if let Some(service) = &req.service {
        args.push(service);
    }

    let cancel = match req.request_id.as_deref() {
        Some(id) => match state.register_exec(&space.id, id) {
            Some(token) => Some(token),
            None => {
                return Ok(axum::Json(serde_json::json!({
                    "success": false,
                    "error": "exec requestId is already running"
                })));
            }
        },
        None => None,
    };
    let result = docker_exec_limited(
        &state,
        &space.id,
        &req.connection_id,
        &args,
        DOCKER_API_MAX_STDOUT_BYTES,
        DOCKER_API_MAX_STDERR_BYTES,
        cancel,
    )
    .await;
    if let Some(id) = req.request_id.as_deref() {
        state.finish_exec(&space.id, id);
    }
    match result {
        Ok(result) => {
            let data = result.stdout;
            let truncated = result.stdout_truncated || result.stderr_truncated;
            if action_cmd == "ps" {
                if result.stdout_truncated {
                    return Ok(axum::Json(serde_json::json!({
                        "success": false,
                        "error": "Compose service list exceeded the API output limit; narrow the project or service selection and retry"
                    })));
                }
                let services = parse_compose_ps(&data);
                Ok(axum::Json(serde_json::json!({
                    "success": true,
                    "data": { "services": services }
                })))
            } else {
                // Logs retain repeated lines; status/progress output gets terminal-aware
                // cleanup so Compose redraws do not become duplicate API/UI lines.
                let output = if action_cmd == "logs" {
                    clean_ansi_output(&data)
                } else {
                    clean_compose_action_output(&data)
                };
                Ok(axum::Json(serde_json::json!({
                    "success": true,
                    "data": { "output": output, "truncated": truncated }
                })))
            }
        }
        Err(e) => Ok(axum::Json(serde_json::json!({
            "success": false,
            "error": e
        }))),
    }
}

/// POST /api/docker/diagnose — Test Docker connectivity and environment
pub async fn docker_diagnose(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(req): Json<ConnRequest>,
) -> ApiResponse<DockerDiagnoseResponse> {
    let conn_id = &req.connection_id;

    // Test docker version
    let docker_version = docker_exec(&state, &space.id, conn_id, &["--version"])
        .await
        .unwrap_or_else(|e| format!("ERROR: {}", e));

    // Test docker ps
    let raw_ps = docker_exec(&state, &space.id, conn_id, &["ps", "--format", "json", "-a"])
        .await
        .unwrap_or_else(|e| format!("ERROR: {}", e));
    let containers = parse_docker_ps(&raw_ps);
    let running = containers.iter().filter(|c| c.state == "running").count();

    // Test docker stats
    let raw_stats = docker_exec(&state, &space.id, conn_id, &["stats", "--no-stream", "--format", "json"])
        .await
        .unwrap_or_else(|e| format!("ERROR: {}", e));

    // Test docker images
    let raw_images = docker_exec(&state, &space.id, conn_id, &["images", "--format", "json"])
        .await
        .unwrap_or_else(|_| String::new());
    let images_count = raw_images.trim().lines().filter(|l| !l.is_empty()).count();

    // Test docker compose
    let compose_result = docker_exec(&state, &space.id, conn_id, &["compose", "ls", "--format", "json"]).await;
    let (compose_available, raw_compose_ls, projects_count) = match compose_result {
        Ok(data) if !data.trim().is_empty() && !data.contains("ERROR") => {
            let projects = parse_compose_ls(&data);
            let count = projects.len();
            (true, data, count)
        }
        Ok(data) => (false, data, 0),
        Err(e) => (false, format!("ERROR: {}", e), 0),
    };

    ApiResponse::success(DockerDiagnoseResponse {
        docker_version: docker_version.trim().to_string(),
        compose_available,
        containers_running: running as u32,
        containers_total: containers.len() as u32,
        images_count: images_count as u32,
        projects_count: projects_count as u32,
        raw_ps,
        raw_stats,
        raw_compose_ls,
    })
}

#[cfg(test)]
mod tests {
    use super::{clean_ansi_output, clean_compose_action_output, legacy_compose_args};

    #[test]
    fn legacy_compose_fallback_drops_only_the_v2_compose_prefix() {
        let args = ["compose", "-f", "/srv/app/compose.yml", "up", "-d"];

        assert_eq!(legacy_compose_args(&args), ["-f", "/srv/app/compose.yml", "up", "-d"]);
    }

    #[test]
    fn clean_ansi_output_keeps_last_carriage_return_frame() {
        let output = "Pulling 1/3\rPulling 2/3\rPulling 3/3\n\x1b[?25lDone\x1b[0m\n";

        assert_eq!(clean_ansi_output(output), "Pulling 3/3\nDone\n");
    }

    #[test]
    fn clean_ansi_output_preserves_log_whitespace() {
        let output = "  leading\nmessage\ntrailing  \n\n";

        assert_eq!(clean_ansi_output(output), output);
    }

    #[test]
    fn compose_action_output_preserves_adjacent_duplicate_lines() {
        let output = "[+] Running 2/2\n\u{2714} Container api Started\n\u{2714} Container api Started\n\nDone\nDone\n";

        assert_eq!(clean_compose_action_output(output), output);
    }

    #[test]
    fn compose_action_output_does_not_collapse_non_adjacent_repeated_lines() {
        let output = "Container api Started\nContainer worker Started\nContainer api Started";

        assert_eq!(clean_compose_action_output(output), output);
    }

    #[test]
    fn clean_ansi_output_handles_escape_and_carriage_return_split_at_input_boundary() {
        let first = "Pulling 1/2\rPulling 2/2\n\x1b[?25";
        let second = "lDone\x1b[0m\r\n";

        // docker_exec concatenates chunks before this whole-output cleaner is
        // called; cleaning the concatenated value must not leave chunk debris.
        assert_eq!(clean_ansi_output(&format!("{first}{second}")), "Pulling 2/2\nDone\n");
    }

    #[test]
    fn clean_ansi_output_keeps_incomplete_and_unknown_escape_sequences() {
        let output = "before\x1b[12\nafter\x1bX\rfinal";

        assert_eq!(clean_ansi_output(output), "before\x1b[12\nfinal");
    }
}
