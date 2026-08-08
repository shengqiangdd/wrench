//! Host Health Dashboard — real-time system health checks across all connected hosts.
//!
//! Runs a single combined SSH command per host to collect CPU, memory, disk,
//! network, processes, and IO data in one shot. Frontend only renders.

use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::response::ApiResponse;
use crate::ssh::executor;
use futures_util::future::join_all;

struct HostInfo {
    host: String,
    port: u16,
    username: String,
    session: Option<Arc<crate::ssh::SshSession>>,
}

/// Build a default offline HostHealth — shared by "not connected" and "error" branches.
fn make_offline_health(id: String, info: &HostInfo, error: Option<String>) -> HostHealth {
    HostHealth {
        id,
        host: info.host.clone(),
        port: info.port,
        username: info.username.clone(),
        connected: false,
        error,
        cpu_load: None,
        cpu_load_5: None,
        cpu_load_15: None,
        cpu_cores: None,
        mem_total_mb: None,
        mem_used_mb: None,
        mem_percent: None,
        uptime: None,
        processes: None,
        disks: Vec::new(),
        net_rx_bytes: 0,
        net_tx_bytes: 0,
        io_read_sectors: 0,
        io_write_sectors: 0,
        top_procs: Vec::new(),
    }
}

/// Health check results for a single host.
#[derive(Debug, serde::Serialize, Default)]
pub struct HostHealth {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub error: Option<String>,
    // 基础指标
    pub cpu_load: Option<f64>,
    pub cpu_load_5: Option<f64>,
    pub cpu_load_15: Option<f64>,
    pub cpu_cores: Option<u32>,
    pub mem_total_mb: Option<u64>,
    pub mem_used_mb: Option<u64>,
    pub mem_percent: Option<f64>,
    pub uptime: Option<String>,
    pub processes: Option<u32>,
    // 磁盘（所有真实分区）
    pub disks: Vec<DiskInfo>,
    // 累计字节（前端用于计算速率）
    pub net_rx_bytes: u64,
    pub net_tx_bytes: u64,
    pub io_read_sectors: u64,
    pub io_write_sectors: u64,
    // Top 进程
    pub top_procs: Vec<ProcInfo>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct DiskInfo {
    pub mount: String,
    pub total: String,
    pub used: String,
    pub percent: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct ProcInfo {
    pub pid: u32,
    pub user: String,
    pub cpu: f64,
    pub mem: f64,
    pub command: String,
}

/// Get health status for all connected hosts (GET /api/hosts/health)
pub async fn get_all_health(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<Vec<HostHealth>>, AppError> {
    // Deduplicate by (host, port, username) — multiple sessions to the same
    // host (e.g. multiple SSH terminal tabs) should only produce one health entry.
    // Prefer the entry that has a live session.
    let mut best: std::collections::HashMap<(String, u16, String), (String, HostInfo)> =
        std::collections::HashMap::new();
    for entry in state.connections.iter() {
        let conn = entry.value();
        let key = (conn.host.clone(), conn.port, conn.username.clone());
        let has_session = conn.session.is_some();
        let dominated = match best.get(&key) {
            Some((_, existing)) => !existing.session.is_some() && has_session,
            None => true,
        };
        if dominated {
            let info = HostInfo {
                host: conn.host.clone(),
                port: conn.port,
                username: conn.username.clone(),
                session: conn.session.clone(),
            };
            best.insert(key, (entry.key().clone(), info));
        }
    }

    let hosts: Vec<(String, HostInfo)> = best.into_values().collect();

    if hosts.is_empty() {
        return Ok(ApiResponse::success(Vec::new()));
    }

    // 并行检查连接状态
    let mut host_infos = Vec::with_capacity(hosts.len());
    let connect_futures: Vec<_> = hosts
        .into_iter()
        .map(|(id, info)| async move {
            let connected = match &info.session {
                Some(s) => s.is_connected().await,
                None => false,
            };
            (id, info, connected)
        })
        .collect();
    for result in join_all(connect_futures).await {
        host_infos.push(result);
    }

    // 并行采集所有主机数据
    let futures: Vec<_> = host_infos
        .into_iter()
        .map(|(id, info, connected)| {
            let state = Arc::clone(&state);
            async move {
                if !connected {
                    return make_offline_health(id, &info, Some("Not connected".into()));
                }
                match check_host_health(&state, &id).await {
                    Ok(data) => HostHealth {
                        id,
                        host: info.host,
                        port: info.port,
                        username: info.username,
                        connected: true,
                        error: None,
                        cpu_load: data.cpu_load,
                        cpu_load_5: data.cpu_load_5,
                        cpu_load_15: data.cpu_load_15,
                        cpu_cores: data.cpu_cores,
                        mem_total_mb: data.mem_total_mb,
                        mem_used_mb: data.mem_used_mb,
                        mem_percent: data.mem_percent,
                        uptime: data.uptime,
                        processes: data.processes,
                        disks: data.disks,
                        net_rx_bytes: data.net_rx_bytes,
                        net_tx_bytes: data.net_tx_bytes,
                        io_read_sectors: data.io_read_sectors,
                        io_write_sectors: data.io_write_sectors,
                        top_procs: data.top_procs,
                    },
                    Err(e) => make_offline_health(id, &info, Some(e)),
                }
            }
        })
        .collect();

    let results = join_all(futures).await;

    // 不自动清理离线连接 — 让用户手动管理
    // 之前自动删除导致主机从列表消失，无法重新连接

    auto_alert_health_anomalies(&state, &results);

    Ok(ApiResponse::success(results))
}

/// 自动告警
fn auto_alert_health_anomalies(state: &AppState, results: &[HostHealth]) {
    use crate::app_state::AlertEntry;
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string();

    for h in results {
        if !h.connected {
            continue;
        }

        if let (Some(load), Some(cores)) = (h.cpu_load, h.cpu_cores) {
            let ratio = load / cores as f64;
            if ratio > 1.0 && cores > 0 {
                state.add_alert(AlertEntry {
                    id: format!("cpu-{}-{}", h.id, chrono::Utc::now().timestamp()),
                    timestamp: now.clone(),
                    level: "warning".into(),
                    host: h.host.clone(),
                    metric: "cpu_load".into(),
                    message: format!("CPU load {:.2} exceeds core count {}", load, cores),
                    value: ratio,
                    threshold: 1.0,
                });
            }
        }

        if let Some(mem_pct) = h.mem_percent {
            if mem_pct > 90.0 {
                state.add_alert(AlertEntry {
                    id: format!("mem-{}-{}", h.id, chrono::Utc::now().timestamp()),
                    timestamp: now.clone(),
                    level: if mem_pct > 95.0 { "critical" } else { "warning" }.into(),
                    host: h.host.clone(),
                    metric: "memory".into(),
                    message: format!("Memory usage {:.1}%", mem_pct),
                    value: mem_pct,
                    threshold: 90.0,
                });
            }
        }

        for disk in &h.disks {
            let pct_val = disk.percent.trim_end_matches('%').parse::<f64>().unwrap_or(0.0);
            if pct_val > 85.0 {
                state.add_alert(AlertEntry {
                    id: format!(
                        "disk-{}-{}-{}",
                        h.id,
                        disk.mount.replace('/', "_"),
                        chrono::Utc::now().timestamp()
                    ),
                    timestamp: now.clone(),
                    level: if pct_val > 95.0 { "critical" } else { "warning" }.into(),
                    host: h.host.clone(),
                    metric: format!("disk:{}", disk.mount),
                    message: format!("Disk {} usage {} ({}/{})", disk.mount, disk.percent, disk.used, disk.total),
                    value: pct_val,
                    threshold: 85.0,
                });
            }
        }
    }
}

/// AI-powered diagnosis (POST /api/hosts/diagnose)
pub async fn diagnose_host(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<crate::api_types::DiagnoseResponse>, AppError> {
    let host_id = body
        .get("hostId")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Missing hostId".into()))?;

    let _conn = state
        .connections
        .get(host_id)
        .ok_or_else(|| AppError::NotFound("Host not found".into()))?;

    let health = check_host_health(&state, host_id)
        .await
        .map_err(|e| AppError::Internal(format!("Health check failed: {}", e)))?;

    let mut lines = Vec::new();
    lines.push("System Health Report".to_string());
    if let Some(load) = health.cpu_load {
        lines.push(format!(
            "- CPU Load: {:.2} / {:.2} / {:.2} (cores: {})",
            load,
            health.cpu_load_5.unwrap_or(0.0),
            health.cpu_load_15.unwrap_or(0.0),
            health.cpu_cores.unwrap_or(1)
        ));
    }
    if let Some(mem_pct) = health.mem_percent {
        lines.push(format!(
            "- Memory: {:.1}% used ({}/{} MB)",
            mem_pct,
            health.mem_used_mb.unwrap_or(0),
            health.mem_total_mb.unwrap_or(0)
        ));
    }
    for d in &health.disks {
        lines.push(format!(
            "- Disk {}: {} used ({}/{})",
            d.mount, d.percent, d.used, d.total
        ));
    }
    if let Some(procs) = health.processes {
        lines.push(format!("- Processes: {}", procs));
    }
    if let Some(ref uptime) = health.uptime {
        lines.push(format!("- Uptime: {}", uptime));
    }

    let health_text = lines.join("\n");
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
    Ok(ApiResponse::success(
        crate::api_types::DiagnoseResponse {
            health: health_value,
            raw_report: health_text,
            ai_diagnosis,
        },
    ))
}

// ─── 单条 SSH 命令采集全部数据 ───

async fn check_host_health(state: &AppState, host_id: &str) -> Result<HealthData, String> {
    let conn = state
        .connections
        .get(host_id)
        .ok_or_else(|| "Host not found".to_string())?;
    let session = conn
        .session
        .clone()
        .ok_or_else(|| -> String { "No active SSH session".into() })?;

    // 一条命令采集全部：load / mem / disk / uptime / procs / cores / net / io / top
    let cmd = concat!(
        "echo '===LOAD==='; ",
        "cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}'; ",
        "echo '===MEM==='; ",
        "free -m 2>/dev/null | awk 'NR==2{printf \"%d %d %.1f\", $2, $3, ($3/$2)*100}'; ",
        "echo '===DISK==='; ",
        "df -h -T 2>/dev/null | awk 'NR>1 && $2!~/(tmpfs|devtmpfs|squashfs|overlay|none|fuse|squash)/ && $6+0>0{printf \"%s %s %s %s\\n\", $7, $3, $4, $6}'; ",
        "echo '===UPTIME==='; ",
        "uptime -p 2>/dev/null || uptime | sed 's/.*up //' | awk '{print $1, $2, $3, $4}'; ",
        "echo '===PROCS==='; ",
        "ps --no-headers -eo pid 2>/dev/null | wc -l; ",
        "echo '===CORES==='; ",
        "nproc 2>/dev/null || echo 1; ",
        "echo '===NET==='; ",
        "cat /proc/net/dev 2>/dev/null | awk 'NR>2 && $1!~/(lo|veth|docker|br-|virbr|cni|flannel|calico)/{gsub(/:/, \"\", $1); rx+=$2; tx+=$10} END{printf \"%d %d\", rx, tx}'; ",
        "echo '===IO==='; ",
        "cat /proc/diskstats 2>/dev/null | awk '$3!~/(loop|ram|dm-)/ && ($3~/^(sd|vd|xvd|nvme[0-9]+n[0-9]+)$/){rs+=$6; ws+=$10} END{printf \"%d %d\", rs, ws}'; ",
        "echo '===TOP==='; ",
        "ps aux --sort=-%cpu 2>/dev/null | head -6 | tail -5 | awk '{printf \"%d %s %.1f %.1f \", $2, $1, $3, $4; for(i=11;i<=NF;i++) printf \"%s \", $i; print \"\"}'",
    );

    let result = executor::execute_command(&session, cmd)
        .await
        .map_err(|e| format!("SSH exec failed: {}", e))?;

    if result.exit_code != 0 && result.stdout.is_empty() {
        return Err(format!(
            "Command failed with exit code {}: {}",
            result.exit_code, result.stderr
        ));
    }

    let stdout = &result.stdout;
    let get = |name: &str| -> Option<String> {
        let marker = format!("==={}===", name);
        let start = stdout.find(&marker)?;
        let s = start + marker.len();
        let mut end = stdout.len();
        let markers = ["LOAD", "MEM", "DISK", "UPTIME", "PROCS", "CORES", "NET", "IO", "TOP"];
        for other in markers {
            if other == name {
                continue;
            }
            let m = format!("==={}===", other);
            if let Some(offset) = stdout[s..].find(m.as_str()) {
                let abs = s + offset;
                if abs < end {
                    end = abs;
                }
            }
        }
        Some(stdout[s..end].trim().to_string())
    };

    let mut data = HealthData::default();

    // Load
    if let Some(s) = get("LOAD") {
        let p: Vec<&str> = s.split_whitespace().collect();
        if p.len() >= 3 {
            data.cpu_load = p[0].parse().ok();
            data.cpu_load_5 = p[1].parse().ok();
            data.cpu_load_15 = p[2].parse().ok();
        }
    }

    // Memory
    if let Some(s) = get("MEM") {
        let p: Vec<&str> = s.split_whitespace().collect();
        if p.len() >= 3 {
            data.mem_total_mb = p[0].parse().ok();
            data.mem_used_mb = p[1].parse().ok();
            data.mem_percent = p[2].parse().ok();
        }
    }

    // Disks (all real partitions)
    if let Some(s) = get("DISK") {
        for line in s.lines() {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() >= 4 {
                data.disks.push(DiskInfo {
                    mount: p[0].to_string(),
                    total: p[1].to_string(),
                    used: p[2].to_string(),
                    percent: p[3].to_string(),
                });
            }
        }
    }

    // Uptime
    data.uptime = get("UPTIME").filter(|s| !s.is_empty());

    // Processes
    if let Some(s) = get("PROCS") {
        data.processes = s.trim().parse().ok();
    }

    // CPU cores
    if let Some(s) = get("CORES") {
        data.cpu_cores = s.trim().parse().ok();
    }

    // Network (cumulative bytes, need to compute speed externally)
    if let Some(s) = get("NET") {
        let p: Vec<&str> = s.split_whitespace().collect();
        if p.len() >= 2 {
            data.net_rx_bytes = p[0].parse().unwrap_or(0);
            data.net_tx_bytes = p[1].parse().unwrap_or(0);
        }
    }

    // Disk IO (cumulative sectors, need to compute speed externally)
    if let Some(s) = get("IO") {
        let p: Vec<&str> = s.split_whitespace().collect();
        if p.len() >= 2 {
            data.io_read_sectors = p[0].parse().unwrap_or(0);
            data.io_write_sectors = p[1].parse().unwrap_or(0);
        }
    }

    // Top processes
    if let Some(s) = get("TOP") {
        for line in s.lines() {
            let p: Vec<&str> = line.splitn(5, ' ').collect();
            if p.len() >= 5 {
                data.top_procs.push(ProcInfo {
                    pid: p[0].parse().unwrap_or(0),
                    user: p[1].to_string(),
                    cpu: p[2].parse().unwrap_or(0.0),
                    mem: p[3].parse().unwrap_or(0.0),
                    command: p[4].trim().chars().take(60).collect(),
                });
            }
        }
    }

    Ok(data)
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
struct HealthData {
    #[serde(default)]
    cpu_load: Option<f64>,
    #[serde(default)]
    cpu_load_5: Option<f64>,
    #[serde(default)]
    cpu_load_15: Option<f64>,
    #[serde(default)]
    cpu_cores: Option<u32>,
    #[serde(default)]
    mem_total_mb: Option<u64>,
    #[serde(default)]
    mem_used_mb: Option<u64>,
    #[serde(default)]
    mem_percent: Option<f64>,
    #[serde(default)]
    disks: Vec<DiskInfo>,
    #[serde(default)]
    uptime: Option<String>,
    #[serde(default)]
    processes: Option<u32>,
    // 累计值，用于前端计算速率
    #[serde(default)]
    net_rx_bytes: u64,
    #[serde(default)]
    net_tx_bytes: u64,
    #[serde(default)]
    io_read_sectors: u64,
    #[serde(default)]
    io_write_sectors: u64,
    #[serde(default)]
    top_procs: Vec<ProcInfo>,
}

async fn get_ai_diagnosis(api_key: &str, health_report: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "google/gemini-2.0-flash-lite-preview-02-05:free",
            "messages": [
                {"role": "system", "content": "You are a Linux server health expert. Analyze the health data and provide a brief diagnosis in Chinese, under 200 words."},
                {"role": "user", "content": health_report}
            ],
            "max_tokens": 1024,
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API returned status {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    Ok(body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("AI diagnosis unavailable")
        .to_string())
}
