use axum::{extract::State};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// List available scripts (GET /api/scripts)
pub async fn list_scripts(State(_state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    let scripts = serde_json::json!([
        {"id": "cpu_info", "name": "CPU Info", "command": "cat /proc/cpuinfo | head -20", "group": "system"},
        {"id": "mem_info", "name": "Memory Info", "command": "free -h", "group": "system"},
        {"id": "disk_usage", "name": "Disk Usage", "command": "df -h", "group": "system"},
        {"id": "net_stat", "name": "Network Stats", "command": "ss -tuln", "group": "network"},
        {"id": "process_list", "name": "Process List", "command": "ps aux --sort=-%mem | head -20", "group": "system"},
        {"id": "docker_ps", "name": "Docker PS", "command": "docker ps -a", "group": "docker"},
        {"id": "uptime", "name": "Uptime & Load", "command": "uptime", "group": "system"},
    ]);
    ApiResponse::success(scripts)
}
