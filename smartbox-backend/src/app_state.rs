use std::path::PathBuf;

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::Serialize;

use crate::config::AppConfig;
use crate::ssh::SshConnection;

/// Shared application state accessible from all handlers.
pub struct AppState {
    pub config: AppConfig,

    /// SSH connections: connection_id -> SshConnection
    pub connections: DashMap<String, SshConnection>,

    /// Docker clients cached by host: host -> bollard::Docker
    pub docker_clients: DashMap<String, bollard::Docker>,

    /// Alerts store (in-memory, max 500)
    pub alerts: RwLock<Vec<AlertEntry>>,

    /// Audit logs (in-memory ring buffer)
    pub audit_logs: RwLock<Vec<AuditEntry>>,

    /// WS token store for one-time tokens
    pub ws_tokens: DashMap<String, WsTokenInfo>,

    /// Plugin marketplace cache
    pub marketplace_cache: RwLock<Option<Vec<crate::models::PluginManifest>>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AlertEntry {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub host: String,
    pub metric: String,
    pub message: String,
    pub value: f64,
    pub threshold: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub action: String,
    pub detail: serde_json::Value,
    pub ip: String,
}

#[derive(Clone, Debug)]
pub struct WsTokenInfo {
    pub token: String,
    pub ip: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
}

impl AppState {
    pub async fn new(config: AppConfig) -> anyhow::Result<Self> {
        Ok(Self {
            connections: DashMap::new(),
            docker_clients: DashMap::new(),
            alerts: RwLock::new(Vec::with_capacity(500)),
            audit_logs: RwLock::new(Vec::with_capacity(1000)),
            ws_tokens: DashMap::new(),
            marketplace_cache: RwLock::new(None),
            config,
        })
    }

    /// Ensure a plugin directory path is safe (no path traversal)
    pub fn safe_plugin_path(&self, plugin_id: &str) -> Option<PathBuf> {
        let sanitized: String = plugin_id
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
            .collect();

        if sanitized.is_empty() || sanitized != plugin_id {
            return None;
        }

        let target = self.config.plugins_dir.join(&sanitized);
        // Ensure resolved path starts with plugins_dir
        if target.starts_with(&self.config.plugins_dir) {
            Some(target)
        } else {
            None
        }
    }

    /// Add audit log entry
    pub fn add_audit_log(&self, action: &str, detail: serde_json::Value, ip: &str) {
        let mut logs = self.audit_logs.write();
        logs.push(AuditEntry {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: action.to_string(),
            detail,
            ip: ip.to_string(),
        });
        if logs.len() > 1000 {
            logs.remove(0);
        }
    }

    /// Add alert entry
    pub fn add_alert(&self, alert: AlertEntry) {
        let mut alerts = self.alerts.write();
        alerts.push(alert);
        if alerts.len() > 500 {
            alerts.remove(0);
        }
    }
}
