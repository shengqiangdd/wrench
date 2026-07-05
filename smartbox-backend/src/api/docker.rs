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
    pub id: String,
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
}

/// Docker compose action request
#[derive(Debug, Deserialize)]
pub struct ComposeActionRequest {
    #[serde(alias = "connectionId")]
    pub connection_id: String,
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

    let (stdout, stderr, _exit_code) = session
        .exec(&command)
        .await
        .map_err(|e| format!("Docker exec failed: {}", e))?;

    if !stderr.is_empty() && stdout.is_empty() {
        return Err(stderr);
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
    let all_flag = if req.all.unwrap_or(false) { "-a" } else { "" };
    match docker_exec(&state, &req.connection_id, &[all_flag, "ps", "--format", "json", "--no-trunc"]).await {
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

/// POST /api/docker/compose
pub async fn compose_list(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComposeRequest>,
) -> ApiResponse<DockerExecResponse> {
    match docker_exec(&state, &req.connection_id, &["compose", "ls", "--format", "json"]).await {
        Ok(data) => ApiResponse::success(DockerExecResponse { data }),
        Err(e) => ApiResponse::error(-1, &e),
    }
}

/// POST /api/docker/compose/action
pub async fn compose_action(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ComposeActionRequest>,
) -> ApiResponse<DockerExecResponse> {
    let project_dir = std::path::Path::new(&req.path)
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let project_dir_str = project_dir.to_string_lossy();

    let action_cmd: &str = &req.action;

    let mut args: Vec<&str> = vec!["compose", "-f", &req.path, "-p", &project_dir_str, action_cmd];
    if let Some(service) = &req.service {
        args.push(service);
    }
    if req.action == "up" {
        args.push("-d");
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
