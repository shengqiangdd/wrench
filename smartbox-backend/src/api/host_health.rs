//! Host Health Dashboard — real-time system health checks across all connected hosts.
//!
//! Runs health-check commands via SSH exec on each connected host and returns
//! structured JSON with CPU load, memory, disk, uptime, and process count.
//!
//! Endpoints:
//!   GET  /api/hosts/health      — Health check for all connected hosts
//!   POST /api/hosts/diagnose    — AI-powered diagnosis for a specific host

use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::response::ApiResponse;
use crate::ssh::executor;

/// Health check results for a single host.
#[derive(Debug, serde::Serialize)]
pub struct HostHealth {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub error: Option<String>,
    pub cpu_load: Option<f64>,
    pub cpu_load_5: Option<f64>,
    pub cpu_load_15: Option<f64>,
    pub cpu_cores: Option<u32>,
    pub mem_total_mb: Option<u64>,
    pub mem_used_mb: Option<u64>,
    pub mem_percent: Option<f64>,
    pub disk_total: Option<String>,
    pub disk_used: Option<String>,
    pub disk_percent: Option<String>,
    pub uptime: Option<String>,
    pub processes: Option<u32>,
}

/// Get health status for all connected hosts (GET /api/hosts/health)
pub async fn get_all_health(State(state): State<Arc<AppState>>) -> Result<ApiResponse<Vec<HostHealth>>, AppError> {
    let connection_ids: Vec<String> = state.connections.iter().map(|entry| entry.key().clone()).collect();

    if connection_ids.is_empty() {
        return Ok(ApiResponse::success(Vec::new()));
    }

    let mut results = Vec::new();
    for id in &connection_ids {
        let conn = match state.connections.get(id) {
            Some(c) => c,
            None => continue,
        };
        let host = conn.host.clone();
        let port = conn.port;
        let username = conn.username.clone();
        let connected = conn.is_connected();
        drop(conn); // Release DashMap Ref before async

        if !connected {
            results.push(HostHealth {
                id: id.clone(),
                host,
                port,
                username,
                connected: false,
                error: Some("Not connected".into()),
                cpu_load: None,
                cpu_load_5: None,
                cpu_load_15: None,
                cpu_cores: None,
                mem_total_mb: None,
                mem_used_mb: None,
                mem_percent: None,
                disk_total: None,
                disk_used: None,
                disk_percent: None,
                uptime: None,
                processes: None,
            });
            continue;
        }

        match check_host_health(&state, id).await {
            Ok(health) => results.push(HostHealth {
                id: id.clone(),
                host,
                port,
                username,
                connected: true,
                error: None,
                cpu_load: health.cpu_load,
                cpu_load_5: health.cpu_load_5,
                cpu_load_15: health.cpu_load_15,
                cpu_cores: health.cpu_cores,
                mem_total_mb: health.mem_total_mb,
                mem_used_mb: health.mem_used_mb,
                mem_percent: health.mem_percent,
                disk_total: health.disk_total,
                disk_used: health.disk_used,
                disk_percent: health.disk_percent,
                uptime: health.uptime,
                processes: health.processes,
            }),
            Err(e) => results.push(HostHealth {
                id: id.clone(),
                host,
                port,
                username,
                connected: true,
                error: Some(e),
                cpu_load: None,
                cpu_load_5: None,
                cpu_load_15: None,
                cpu_cores: None,
                mem_total_mb: None,
                mem_used_mb: None,
                mem_percent: None,
                disk_total: None,
                disk_used: None,
                disk_percent: None,
                uptime: None,
                processes: None,
            }),
        }
    }

    // Auto-analyze health results and create alerts for anomalies
    auto_alert_health_anomalies(&state, &results);

    Ok(ApiResponse::success(results))
}

/// Check health results for anomalies and auto-create alerts.
fn auto_alert_health_anomalies(state: &AppState, results: &[HostHealth]) {
    use crate::app_state::AlertEntry;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();

    for h in results {
        if !h.connected {
            continue;
        }

        // CPU load anomaly (load > core count * 0.8 = high load)
        if let (Some(load), Some(cores)) = (h.cpu_load, h.cpu_cores) {
            let ratio = load / cores as f64;
            if ratio > 1.0 && cores > 0 {
                state.add_alert(AlertEntry {
                    id: format!("cpu-{}-{}", h.id, chrono::Utc::now().timestamp()),
                    timestamp: now.clone(),
                    level: "warning".into(),
                    host: h.host.clone(),
                    metric: "cpu_load".into(),
                    message: format!("CPU load {:.2} exceeds core count {} (ratio: {:.2})", load, cores, ratio),
                    value: ratio,
                    threshold: 1.0,
                });
            }
        }

        // Memory anomaly (> 90%)
        if let Some(mem_pct) = h.mem_percent {
            if mem_pct > 90.0 {
                state.add_alert(AlertEntry {
                    id: format!("mem-{}-{}", h.id, chrono::Utc::now().timestamp()),
                    timestamp: now.clone(),
                    level: if mem_pct > 95.0 {
                        "critical".into()
                    } else {
                        "warning".into()
                    },
                    host: h.host.clone(),
                    metric: "memory".into(),
                    message: format!(
                        "Memory usage {:.1}% ({} MB / {} MB)",
                        mem_pct,
                        h.mem_used_mb.unwrap_or(0),
                        h.mem_total_mb.unwrap_or(0)
                    ),
                    value: mem_pct,
                    threshold: 90.0,
                });
            }
        }

        // Disk anomaly (> 85%)
        if let Some(ref disk_pct_str) = h.disk_percent {
            let disk_pct = disk_pct_str.trim_end_matches('%').parse::<f64>().unwrap_or(0.0);
            if disk_pct > 85.0 {
                state.add_alert(AlertEntry {
                    id: format!("disk-{}-{}", h.id, chrono::Utc::now().timestamp()),
                    timestamp: now.clone(),
                    level: if disk_pct > 95.0 {
                        "critical".into()
                    } else {
                        "warning".into()
                    },
                    host: h.host.clone(),
                    metric: "disk".into(),
                    message: format!(
                        "Disk usage {} (used {}/ total {})",
                        disk_pct_str,
                        h.disk_used.as_deref().unwrap_or("?"),
                        h.disk_total.as_deref().unwrap_or("?")
                    ),
                    value: disk_pct,
                    threshold: 85.0,
                });
            }
        }
    }
}

/// AI-powered diagnosis for a specific host (POST /api/hosts/diagnose)
pub async fn diagnose_host(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<crate::api_types::DiagnoseResponse>, AppError> {
    let host_id = body
        .get("hostId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Missing hostId".into()))?;

    // Check host exists and is connected
    let _conn = state
        .connections
        .get(host_id)
        .ok_or_else(|| AppError::NotFound("Host not found".into()))?;

    // Run health check
    let health = check_host_health(&state, host_id)
        .await
        .map_err(|e| AppError::Internal(format!("Health check failed: {}", e)))?;

    // Build diagnosis prompt for AI
    let mut diagnosis_lines = Vec::new();
    diagnosis_lines.push("System Health Report for host".to_string());
    if let Some(load) = health.cpu_load {
        diagnosis_lines.push(format!(
            "- CPU Load (1min): {:.2} (cores: {})",
            load,
            health.cpu_cores.unwrap_or(1)
        ));
    }
    if let Some(mem_pct) = health.mem_percent {
        diagnosis_lines.push(format!(
            "- Memory: {:.1}% used ({}/{} MB)",
            mem_pct,
            health.mem_used_mb.unwrap_or(0),
            health.mem_total_mb.unwrap_or(0)
        ));
    }
    if let Some(disk_pct) = &health.disk_percent {
        diagnosis_lines.push(format!(
            "- Disk: {} used ({} / {})",
            disk_pct,
            health.disk_used.as_deref().unwrap_or("?"),
            health.disk_total.as_deref().unwrap_or("?")
        ));
    }
    if let Some(procs) = health.processes {
        diagnosis_lines.push(format!("- Processes: {}", procs));
    }
    if let Some(uptime) = &health.uptime {
        diagnosis_lines.push(format!("- Uptime: {}", uptime));
    }

    let health_text = diagnosis_lines.join("\n");

    // Try to get AI diagnosis via the AI config
    let api_key = state.config.openrouter_api_key.clone().unwrap_or_default();
    let ai_diagnosis = if !api_key.is_empty() {
        match get_ai_diagnosis(&api_key, &health_text).await {
            Ok(diag) => diag,
            Err(e) => format!("AI diagnosis unavailable: {}", e),
        }
    } else {
        String::new()
    };

    let health_value = serde_json::to_value(&health).unwrap_or_default();

    Ok(ApiResponse::success(crate::api_types::DiagnoseResponse {
        health: health_value,
        raw_report: health_text,
        ai_diagnosis,
    }))
}

/// Run health check commands on a single host via SSH.
async fn check_host_health(state: &AppState, host_id: &str) -> Result<HealthData, String> {
    let conn = state
        .connections
        .get(host_id)
        .ok_or_else(|| "Host not found".to_string())?;

    let session = conn
        .session
        .clone()
        .ok_or_else(|| "No active SSH session".to_string())?;

    // Collect data from multiple commands
    let load = executor::execute_command(&session, "cat /proc/loadavg | awk '{print $1, $2, $3}'").await?;
    let mem = executor::execute_command(&session, "free -m | awk 'NR==2{printf \"%d %d %.1f\", $2, $3, ($3/$2)*100}'")
        .await?;
    let disk = executor::execute_command(&session, "df -h / | awk 'NR==2{printf \"%s %s %s\", $2, $3, $5}'").await?;
    let uptime_cmd = executor::execute_command(
        &session,
        "uptime -p 2>/dev/null || uptime | sed 's/.*up //' | awk '{print $1, $2, $3, $4}'",
    )
    .await?;
    let procs = executor::execute_command(&session, "ps --no-headers -eo pid 2>/dev/null | wc -l").await?;
    let cores = executor::execute_command(&session, "nproc 2>/dev/null || echo 1").await?;

    let mut data = HealthData {
        cpu_load: None,
        cpu_load_5: None,
        cpu_load_15: None,
        cpu_cores: None,
        mem_total_mb: None,
        mem_used_mb: None,
        mem_percent: None,
        disk_total: None,
        disk_used: None,
        disk_percent: None,
        uptime: None,
        processes: None,
    };

    // Parse load
    if load.exit_code == 0 {
        let parts: Vec<&str> = load.stdout.split_whitespace().collect();
        if parts.len() >= 3 {
            data.cpu_load = parts[0].parse::<f64>().ok();
            data.cpu_load_5 = parts[1].parse::<f64>().ok();
            data.cpu_load_15 = parts[2].parse::<f64>().ok();
        }
    }

    // Parse memory
    if mem.exit_code == 0 {
        let parts: Vec<&str> = mem.stdout.split_whitespace().collect();
        if parts.len() >= 3 {
            data.mem_total_mb = parts[0].parse::<u64>().ok();
            data.mem_used_mb = parts[1].parse::<u64>().ok();
            data.mem_percent = parts[2].parse::<f64>().ok();
        }
    }

    // Parse disk
    if disk.exit_code == 0 {
        let parts: Vec<&str> = disk.stdout.split_whitespace().collect();
        if parts.len() >= 3 {
            data.disk_total = Some(parts[0].to_string());
            data.disk_used = Some(parts[1].to_string());
            data.disk_percent = Some(parts[2].to_string());
        }
    }

    // Parse uptime
    if uptime_cmd.exit_code == 0 {
        let trimmed = uptime_cmd.stdout.trim().to_string();
        if !trimmed.is_empty() {
            data.uptime = Some(trimmed);
        }
    }

    // Parse process count
    if procs.exit_code == 0 {
        data.processes = procs.stdout.trim().parse::<u32>().ok();
    }

    // Parse CPU cores
    if cores.exit_code == 0 {
        data.cpu_cores = cores.stdout.trim().parse::<u32>().ok();
    }

    Ok(data)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct HealthData {
    cpu_load: Option<f64>,
    cpu_load_5: Option<f64>,
    cpu_load_15: Option<f64>,
    cpu_cores: Option<u32>,
    mem_total_mb: Option<u64>,
    mem_used_mb: Option<u64>,
    mem_percent: Option<f64>,
    disk_total: Option<String>,
    disk_used: Option<String>,
    disk_percent: Option<String>,
    uptime: Option<String>,
    processes: Option<u32>,
}

/// Send health data to OpenRouter AI for diagnosis.
async fn get_ai_diagnosis(api_key: &str, health_report: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "google/gemini-2.0-flash-lite-preview-02-05:free",
            "messages": [
                {
                    "role": "system",
                    "content": "You are a Linux server health diagnosis expert. Analyze the following system health data and provide:\n1. A brief summary of system status (healthy / needs attention / critical)\n2. Top 1-3 issues to watch (if any)\n3. Recommended actions\nKeep your response concise, under 200 words, in Chinese."
                },
                {
                    "role": "user",
                    "content": health_report
                }
            ],
            "max_tokens": 1024,
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| format!("JSON parse error: {}", e))?;

    let content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("AI diagnosis unavailable")
        .to_string();

    Ok(content)
}
