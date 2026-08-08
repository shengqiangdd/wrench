use axum::extract::State;
use std::sync::Arc;

use crate::api_types::ScriptEntry;
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available scripts (GET /api/scripts)
pub async fn list_scripts(State(_state): State<Arc<AppState>>) -> ApiResponse<Vec<ScriptEntry>> {
    ApiResponse::success(vec![
        ScriptEntry {
            id: "disk-usage".into(),
            name: "Disk Usage".into(),
            command: "df -h".into(),
            group: "System".into(),
        },
        ScriptEntry {
            id: "memory".into(),
            name: "Memory Info".into(),
            command: "free -m".into(),
            group: "System".into(),
        },
        ScriptEntry {
            id: "cpu-info".into(),
            name: "CPU Info".into(),
            command: "lscpu".into(),
            group: "System".into(),
        },
        ScriptEntry {
            id: "process-List".into(),
            name: "Process List".into(),
            command: "ps aux --sort=-%mem | head -30".into(),
            group: "Process".into(),
        },
        ScriptEntry {
            id: "network".into(),
            name: "Network Connections".into(),
            command: "ss -tuln".into(),
            group: "Network".into(),
        },
        ScriptEntry {
            id: "docker-ps".into(),
            name: "Docker Containers".into(),
            command: "docker ps -a".into(),
            group: "Docker".into(),
        },
        ScriptEntry {
            id: "uptime".into(),
            name: "System Uptime".into(),
            command: "uptime".into(),
            group: "System".into(),
        },
        ScriptEntry {
            id: "kernel".into(),
            name: "Kernel Version".into(),
            command: "uname -a".into(),
            group: "System".into(),
        },
    ])
}
