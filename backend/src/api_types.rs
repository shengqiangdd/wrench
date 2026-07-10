//! Typed API response structures.
//!
//! Replaces `ApiResponse<serde_json::Value>` with concrete response types
//! for compile-time API contract validation and better serialization perf.

use serde::{Deserialize, Serialize};

// ─── Health ───

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub uptime: u64,
    pub version: &'static str,
    pub connections: ConnectionsInfo,
}

#[derive(Serialize)]
pub struct ConnectionsInfo {
    pub active: usize,
}

// ─── Auth / Token ───

#[derive(Serialize)]
pub struct TokenResponse {
    pub token: String,
    #[serde(rename = "tokenType")]
    pub token_type: String,
    #[serde(rename = "expiresIn")]
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct AuditLogsResponse {
    pub total: usize,
    pub logs: Vec<crate::app_state::AuditEntry>,
}

// ─── Hosts ───

#[derive(Serialize)]
pub struct HostEntry {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

#[derive(Serialize)]
pub struct HostCreatedResponse {
    pub id: String,
    pub host: String,
}

// ─── Alerts ───

#[derive(Serialize)]
pub struct AlertsResponse {
    pub total: usize,
    pub alerts: Vec<crate::app_state::AlertEntry>,
}

// ─── Monitor ───

#[derive(Serialize)]
pub struct MetricsResponse {
    pub hosts: Vec<serde_json::Value>,
    pub timestamp: u64,
}

// ─── Scripts ───

#[derive(Serialize)]
pub struct ScriptEntry {
    pub id: String,
    pub name: String,
    pub command: String,
    pub group: String,
}

// ─── Logs ───

#[derive(Serialize)]
pub struct LogSource {
    pub path: String,
    pub label: String,
}

/// 单个日志文件的扫描结果
#[derive(Serialize)]
pub struct LogScanResult {
    pub path: String,
    pub size: String,
    pub exists: bool,
}

#[derive(Serialize)]
pub struct LogTailResponse {
    pub content: Option<String>,
    pub path: String,
    pub lines: usize,
    pub total_lines: usize,
}

#[derive(Serialize)]
pub struct GrepResponse {
    pub content: String,
    pub pattern: String,
    pub path: String,
}

// ─── AI ───

#[derive(Serialize)]
pub struct AiConfigResponse {
    pub enabled: bool,
    pub provider: String,
    pub models: Vec<String>,
    /// Masked API key hint (e.g. "sk-...xxxx") so frontend knows one is set
    #[serde(rename = "apiKeyHint", skip_serializing_if = "Option::is_none")]
    pub api_key_hint: Option<String>,
}

#[derive(Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub provider: String,
}

/// A single model item returned from model-listing endpoints
#[derive(Serialize)]
pub struct ModelListItem {
    pub value: String,
    pub label: String,
    pub free: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Wrapper for /api/ai/fetch-* endpoints
#[derive(Serialize)]
pub struct ModelsListResponse {
    pub models: Vec<ModelListItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── Connection (saved SSH connection config) ───

#[derive(Serialize)]
pub struct SavedConnectionEntry {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub group: String,
    pub created_at: String,
}

// ─── Plugins ───

#[derive(Serialize)]
pub struct PluginInstallResponse {
    pub success: bool,
    #[serde(rename = "pluginId")]
    pub plugin_id: String,
    pub message: String,
}

// ─── Docker ───

#[derive(Serialize)]
pub struct DockerExecResponse {
    pub data: String,
}

/// Structured container info from `docker ps --format json`
#[derive(Serialize)]
pub struct DockerContainerInfo {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Names")]
    pub name: String,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Ports")]
    pub ports: String,
    #[serde(rename = "CreatedAt")]
    pub created: String,
    #[serde(rename = "Command")]
    pub command: String,
}

/// Structured container stats from `docker stats --no-stream --format json`
#[derive(Serialize)]
pub struct DockerContainerStats {
    #[serde(rename = "Container")]
    pub id: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "CPUPerc")]
    pub cpu_percent: String,
    #[serde(rename = "MemUsage")]
    pub mem_usage: String,
    #[serde(rename = "MemPerc")]
    pub mem_percent: String,
    #[serde(rename = "NetIO")]
    pub net_io: String,
    #[serde(rename = "BlockIO")]
    pub block_io: String,
    #[serde(rename = "PIDs")]
    pub pids: String,
}

/// Structured compose project info
#[derive(Serialize)]
pub struct DockerComposeProject {
    #[serde(rename = "ID")]
    pub id: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "ConfigFiles")]
    pub config_files: String,
}

/// Structured compose service info from `docker compose ps --format json`
#[derive(Serialize)]
pub struct DockerComposeService {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Image")]
    pub image: String,
    #[serde(rename = "State")]
    pub state: String,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Publishers")]
    pub ports: String,
    #[serde(rename = "Command")]
    pub command: String,
}

/// Response for `docker ps`
#[derive(Serialize)]
pub struct DockerPsResponse {
    pub containers: Vec<DockerContainerInfo>,
}

/// Response for `docker stats`
#[derive(Serialize)]
pub struct DockerStatsResponse {
    pub stats: Vec<DockerContainerStats>,
}

/// Response for `docker compose ls`
#[derive(Serialize)]
pub struct DockerComposeListResponse {
    pub projects: Vec<DockerComposeProject>,
}

/// Response for `docker compose ps`
#[derive(Serialize)]
pub struct DockerComposePsResponse {
    pub services: Vec<DockerComposeService>,
}

/// Response for `docker diagnose`
#[derive(Serialize)]
pub struct DockerDiagnoseResponse {
    pub docker_version: String,
    pub compose_available: bool,
    pub containers_running: u32,
    pub containers_total: u32,
    pub images_count: u32,
    pub projects_count: u32,
    pub raw_ps: String,
    pub raw_stats: String,
    pub raw_compose_ls: String,
}

/// Docker inspect returns a parsed JSON value as data
#[derive(Serialize)]
pub struct DockerInspectResponse {
    pub data: serde_json::Value,
}

/// Docker exec returns data + exit code
#[derive(Serialize)]
pub struct DockerExecResultResponse {
    pub data: String,
    #[serde(rename = "exitCode")]
    pub exit_code: u32,
}

// ─── Host Health ───

#[derive(Serialize)]
pub struct HostHealthCheckResponse {
    pub hosts: Vec<serde_json::Value>,
}

/// Response from AI diagnosis endpoint
#[derive(Serialize)]
pub struct DiagnoseResponse {
    pub health: serde_json::Value,
    #[serde(rename = "rawReport")]
    pub raw_report: String,
    #[serde(rename = "aiDiagnosis")]
    pub ai_diagnosis: String,
}

// ─── SSH ───

/// Request body for SSH exec
#[derive(Deserialize)]
pub struct SshExecRequest {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub command: String,
}

/// Response body for SSH exec
#[derive(Serialize)]
pub struct SshExecResponse {
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

/// Response body for SSH connect (inside ApiResponse)
#[derive(Serialize)]
pub struct SshConnectResponse {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

/// Request body for SSH disconnect
#[derive(Deserialize)]
pub struct SshDisconnectRequest {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
}

// ─── Notifications ───

/// Single notification channel entry
#[derive(Serialize)]
pub struct NotificationChannelEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub name: String,
    pub config: serde_json::Value,
    pub enabled: bool,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// List notification channels response
#[derive(Serialize)]
pub struct NotificationChannelsResponse {
    pub total: usize,
    pub channels: Vec<NotificationChannelEntry>,
}

// ─── Vault ───

/// Single vault secret entry (full detail with decrypted value)
#[derive(Serialize)]
pub struct VaultEntryDetail {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub value: String,
    pub tags: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

/// List vault entries response
#[derive(Serialize)]
pub struct VaultListResponse {
    pub total: usize,
    pub entries: Vec<VaultEntryDetail>,
}

/// Vault types response
#[derive(Serialize)]
pub struct VaultTypeInfo {
    pub id: String,
    pub label: String,
    pub icon: String,
}

#[derive(Serialize)]
pub struct VaultTypesResponse {
    pub types: Vec<VaultTypeInfo>,
}
