use std::path::PathBuf;

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::Serialize;

use crate::config::AppConfig;
use crate::db::Database;
use crate::ssh::SshConnection;
use crate::utils::jwt::JwtService;

/// Shared application state accessible from all handlers.
pub struct AppState {
    pub config: AppConfig,
    pub db: Option<Database>,
    pub connections: DashMap<String, SshConnection>,
    pub docker_clients: DashMap<String, bollard::Docker>,
    pub alerts: RwLock<Vec<AlertEntry>>,
    pub audit_logs: RwLock<Vec<AuditEntry>>,
    pub ws_tokens: DashMap<String, WsTokenInfo>,
    pub jwt_service: RwLock<Option<JwtService>>,
    pub marketplace_cache: RwLock<Option<Vec<crate::models::PluginManifest>>>,
    pub active_logtails: DashMap<String, tokio::sync::oneshot::Sender<()>>,
    /// 门（door）运行时状态：门户口令与令牌版本。
    pub auth: RwLock<AuthRuntime>,
    /// 首次设置口令用的一次性令牌（仅在门户口令未设置时有效）。
    pub setup_token: String,
    /// 服务器启动时间，用于计算 uptime
    pub start_time: std::time::Instant,
}

/// 门的运行时状态。
///
/// 口令来源优先级（高 → 低）：
/// 1. 数据库 `app_settings.door_password_hash`（网页里自设/改过口令）
/// 2. 环境变量 `WRENCH_AUTH_PASSWORD`（legacy 部署，二进制启动时写入）
/// 3. 都没有 → setup 模式：受保护接口一律 503，只放行 `/api/auth/status` 与 `/api/auth/setup`
pub struct AuthRuntime {
    /// PBKDF2 哈希串；`None` 表示数据库里还没设过口令
    pub door_hash: Option<String>,
    /// legacy 环境变量口令（明文，仅来自部署侧）
    pub env_password: Option<String>,
    /// 令牌版本：改口令即 +1，所有旧令牌立即失效（数据不丢，空间与口令解耦）
    pub token_version: u32,
}

impl AuthRuntime {
    /// 是否已经配置了口令（DB 或环境变量）。
    pub fn configured(&self) -> bool {
        self.door_hash.is_some() || self.env_password.is_some()
    }

    /// 口令来源，用于前端提示与日志。
    pub fn source(&self) -> &'static str {
        if self.door_hash.is_some() {
            "database"
        } else if self.env_password.is_some() {
            "env"
        } else {
            "none"
        }
    }

    /// 校验门户口令（恒定时间比较摘要）。
    pub fn verify(&self, candidate: &str) -> bool {
        if let Some(hash) = self.door_hash.as_deref() {
            return crate::utils::crypto::verify_door_hash(candidate, hash);
        }
        match self.env_password.as_deref() {
            Some(expected) => crate::utils::crypto::verify_password(candidate, expected),
            None => false,
        }
    }
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
    /// 归属空间（内存缓存也按空间隔离，避免跨空间泄露）
    #[serde(default)]
    pub space_id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub action: String,
    pub detail: serde_json::Value,
    pub ip: String,
    /// 归属空间；空串表示全局事件（登录、设置口令等门外事件）
    #[serde(default)]
    pub space_id: String,
}

/// 为升级前的历史数据准备一次性认领码。
///
/// 只有当存在「不属于任何空间」的历史行时才会执行：
/// * 若 `legacy` 空间已存在且认领码仍在库里 → 再次打印（方便运维在日志里找回）。
/// * 否则新建 `legacy` 空间、写入随机认领码，并在启动日志里打印一次。
///
/// 认领发生在 `POST /api/space/attach`：粘贴认领码即把历史行划归自己的空间。
async fn ensure_legacy_space(db: &Database) -> anyhow::Result<()> {
    let orphans = db.count_orphan_rows().await?;
    if orphans == 0 {
        return Ok(());
    }

    if db.find_space_by_id(crate::space::LEGACY_SPACE_ID).await?.is_some() {
        if let Some(code) = db.get_setting("legacy_claim_code").await?
            && !code.is_empty()
        {
            eprintln!("[space] {orphans} 行历史数据仍未被认领；认领码（网页「用空间码进入」）：{code}");
        }
        return Ok(());
    }

    let code = crate::space::generate_code();
    let now = chrono::Utc::now().to_rfc3339();
    db.create_space(crate::space::LEGACY_SPACE_ID, &crate::space::hash_code(&code), &now)
        .await?;
    db.set_setting("legacy_claim_code", &code).await?;

    // 这条日志是历史数据唯一的取回入口：认领后认领码即失效（从库中清除）。
    // 用 `eprintln!` 保证在任何 RUST_LOG 设置下都能看到。
    eprintln!("[space] 检测到 {orphans} 行升级前的历史数据（主机/Vault/调度/审计）");
    eprintln!("[space] 一次性认领码：{code}");
    eprintln!("[space] 在网页里点「用空间码进入」粘贴该码即可把这些数据收到自己名下");
    Ok(())
}

#[derive(Clone, Debug)]
pub struct WsTokenInfo {
    pub token: String,
    pub ip: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    /// 该 WS 令牌被绑定到的空间（签发时确定），避免 WS 越权访问他人主机
    pub space_id: String,
}

impl AppState {
    pub async fn new(config: AppConfig) -> anyhow::Result<Self> {
        // Initialize SQLite database
        let db = if let Some(db_path) = &config.database_url {
            match Database::open(std::path::Path::new(db_path)).await {
                Ok(d) => {
                    tracing::info!("SQLite persistence enabled: {}", db_path);
                    Some(d)
                }
                Err(e) => {
                    tracing::warn!(
                        "Failed to open SQLite database ({}), running in memory-only mode: {}",
                        db_path,
                        e
                    );
                    None
                }
            }
        } else {
            None
        };

        // 审计/告警不再做全局预加载：读取路径按空间查库，
        // 内存里的这两个 Vec 仅作为「本进程刚发生的事件」缓冲（也带 space_id）。
        let audit_logs: Vec<AuditEntry> = vec![];
        let alerts: Vec<AlertEntry> = vec![];

        // 门户口令：数据库（网页自设）优先，其次环境变量（legacy 部署）
        let mut auth = AuthRuntime { door_hash: None, env_password: config.auth_password.clone(), token_version: 0 };
        if let Some(ref database) = db {
            match database.get_setting("door_password_hash").await {
                Ok(hash) => auth.door_hash = hash,
                Err(err) => tracing::warn!("Failed to read door password hash: {err}"),
            }
            match database.get_setting("token_version").await {
                Ok(Some(v)) => auth.token_version = v.parse().unwrap_or(0),
                Ok(None) => {
                    // 库里没记过版本号：legacy 环境变量口令用口令指纹当版本，
                    // 这样部署者改 `WRENCH_AUTH_PASSWORD` 同样能吊销所有旧令牌。
                    if let Some(ref pw) = auth.env_password {
                        auth.token_version = crate::utils::crypto::env_password_version(pw);
                    }
                }
                Err(err) => tracing::warn!("Failed to read token version: {err}"),
            }
        }

        // 升级前的历史数据（`space_id = ''`）：建立 `legacy` 空间并生成一次性认领码。
        // 认领码只打到启动日志里，认领后即从数据库清除 —— 部署者据此把老数据带进自己的空间。
        if let Some(ref database) = db
            && let Err(err) = ensure_legacy_space(database).await
        {
            tracing::warn!("[space] legacy data handover not prepared: {err}");
        }

        // 首次设置口令用的一次性令牌：环境变量优先，否则随机生成并打到启动日志
        //
        // 用 `eprintln!` 而不是 `tracing`：这条日志必须在任何日志级别设置下都可见，
        // 它是「首次设置」唯一的入口（生产上 RUST_LOG 配错一次就会永久锁死部署）。
        let setup_token = match std::env::var("WRENCH_SETUP_TOKEN") {
            Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
            _ => crate::space::generate_code(),
        };
        let door_configured = auth.door_hash.is_some() || auth.env_password.is_some();
        if door_configured {
            eprintln!("🔐 入口口令已配置（数据库哈希或环境变量），无需首次设置令牌。");
        } else {
            eprintln!("🔑 首次设置令牌（在网页「首次设置」里填入，设置口令后即失效）：{setup_token}");
        }

        Ok(Self {
            connections: DashMap::new(),
            docker_clients: DashMap::new(),
            alerts: RwLock::new(alerts),
            audit_logs: RwLock::new(audit_logs),
            ws_tokens: DashMap::new(),
            marketplace_cache: RwLock::new(None),
            active_logtails: DashMap::new(),
            auth: RwLock::new(auth),
            setup_token,
            db,
            jwt_service: RwLock::new(JwtService::from_secret(&config.jwt_secret).ok()),
            config,
            start_time: std::time::Instant::now(),
        })
    }

    /// 切换门户口令（DB 托管）并让所有旧令牌失效。
    ///
    /// 与「空间」完全解耦：改口令只影响登录会话，任何人的空间数据都不受影响。
    /// 接收的始终是**已哈希**的口令，明文不进入本函数（更不会进日志）。
    pub async fn set_door_password_hash(&self, hashed: String) -> anyhow::Result<()> {
        let next_version = {
            let mut auth = self.auth.write();
            auth.door_hash = Some(hashed.clone());
            auth.token_version = auth.token_version.wrapping_add(1);
            auth.token_version
        };
        if let Some(ref db) = self.db {
            db.set_setting("door_password_hash", &hashed).await?;
            db.set_setting("token_version", &next_version.to_string()).await?;
        }
        tracing::info!("[auth] door password updated; all old tokens revoked (token_version={next_version})");
        Ok(())
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

    /// 取本空间的活连接（跨空间的 `connection_id` 一律视为不存在）。
    pub fn connection_in(&self, space_id: &str, connection_id: &str) -> Option<SshConnection> {
        let entry = self.connections.get(connection_id)?;
        if entry.space_id != space_id {
            tracing::warn!(
                "[space] blocked cross-space connection access: space={} tried id={} (owner={})",
                space_id,
                connection_id,
                entry.space_id
            );
            return None;
        }
        Some(entry.value().clone())
    }

    /// 列出本空间的活连接。
    pub fn connections_in(&self, space_id: &str) -> Vec<SshConnection> {
        self.connections
            .iter()
            .filter(|e| e.value().space_id == space_id)
            .map(|e| e.value().clone())
            .collect()
    }

    /// 删除本空间的活连接（不是自己的连接不动）。
    pub fn remove_connection_in(&self, space_id: &str, connection_id: &str) -> Option<SshConnection> {
        let owned = self
            .connections
            .get(connection_id)
            .map(|e| e.value().space_id == space_id)
            .unwrap_or(false);
        if !owned {
            tracing::warn!(
                "[space] blocked cross-space connection removal: space={} tried id={}",
                space_id,
                connection_id
            );
            return None;
        }
        self.connections.remove(connection_id).map(|(_, v)| v)
    }

    /// Add audit log entry.
    ///
    /// Writes to the in-memory buffer synchronously, and also persists
    /// to SQLite asynchronously if a database is configured.
    ///
    /// `space_id` 为空串表示「门外」事件（登录、口令设置等，不属于任何空间）。
    pub fn add_audit_log(&self, action: &str, detail: serde_json::Value, ip: &str, space_id: &str) {
        let timestamp = chrono::Local::now().to_rfc3339();

        // Memory write (instant, always works)
        let mut logs = self.audit_logs.write();
        let entry = AuditEntry {
            timestamp: timestamp.clone(),
            action: action.to_string(),
            detail: detail.clone(),
            ip: ip.to_string(),
            space_id: space_id.to_string(),
        };
        logs.push(entry);
        if logs.len() > 1000 {
            logs.remove(0);
        }
        drop(logs);

        // DB write (fire-and-forget async, non-blocking)
        if let Some(ref db) = self.db {
            let db = db.clone();
            let act = action.to_string();
            let addr = ip.to_string();
            let detail_str = detail.to_string();
            let space = space_id.to_string();
            tokio::spawn(async move {
                if let Err(e) = db.insert_audit_log(&timestamp, &act, &detail_str, &addr, &space).await {
                    tracing::warn!("Failed to persist audit log: {}", e);
                }
            });
        }
    }

    /// 读取某个空间的审计记录（DB 为准；无库时退回内存缓冲）。
    pub async fn audit_logs_for(&self, space_id: &str, limit: usize) -> Vec<AuditEntry> {
        if let Some(ref db) = self.db
            && let Ok(rows) = db.load_recent_audit_logs(limit, space_id).await
        {
            return rows;
        }
        let logs = self.audit_logs.read();
        logs.iter().filter(|e| e.space_id == space_id).cloned().collect()
    }

    /// 读取某个空间的告警（DB 为准；无库时退回内存缓冲）。
    pub async fn alerts_for(&self, space_id: &str, limit: usize) -> Vec<AlertEntry> {
        if let Some(ref db) = self.db
            && let Ok(rows) = db.load_alerts(limit, space_id).await
        {
            return rows;
        }
        let alerts = self.alerts.read();
        alerts.iter().filter(|e| e.space_id == space_id).cloned().collect()
    }

    /// Add alert entry.
    ///
    /// Writes to the in-memory buffer synchronously, and also persists
    /// to SQLite asynchronously if a database is configured.
    pub fn add_alert(&self, alert: AlertEntry) {
        // Memory write (instant, always works)
        let mut alerts = self.alerts.write();
        alerts.push(alert.clone());
        if alerts.len() > 500 {
            alerts.remove(0);
        }
        drop(alerts);

        // DB write (fire-and-forget async, non-blocking)
        if let Some(ref db) = self.db {
            let db = db.clone();
            let level = alert.level.clone();
            let metric = alert.metric.clone();
            let host = alert.host.clone();
            let message = alert.message.clone();
            // 告警只能触发它所属空间的通道，避免跨空间把别人的告警发出去
            let space_id = alert.space_id.clone();
            tokio::spawn(async move {
                if let Err(e) = db.insert_alert(&alert, &space_id).await {
                    tracing::warn!("Failed to persist alert: {}", e);
                }

                // Dispatch notifications for critical & warning alerts
                if (level == "critical" || level == "warning")
                    && let Ok(channels) = db.list_notification_channels(&space_id).await
                {
                    let alert_level = crate::notify::AlertLevel::parse_level(&level);
                    for ch in channels {
                        if !ch.enabled {
                            continue;
                        }
                        let _ = crate::notify::dispatch_alert(&ch, &alert_level, &metric, &host, &message).await;
                    }
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;

    fn test_config() -> AppConfig {
        AppConfig {
            host: "0.0.0.0".into(),
            port: 3001,
            frontend_dist: PathBuf::from("./frontend/dist"),
            plugins_dir: PathBuf::from("/tmp/wrench/plugins"),
            cors_origins: vec!["*".into()],
            openrouter_api_key: None,
            jwt_secret: "test-jwt-secret".into(),
            vault_key: None,
            database_url: None, // memory-only mode for tests
            log_level: "warn".into(),
            auth_password: Some("test-password".into()),
        }
    }

    #[test]
    fn test_new_state_creates_empty_fields() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();
        assert!(state.db.is_none());
        assert!(state.connections.is_empty());
        assert!(state.docker_clients.is_empty());
        assert!(state.alerts.read().is_empty());
        assert!(state.audit_logs.read().is_empty());
        assert!(state.ws_tokens.is_empty());
        assert!(state.marketplace_cache.read().is_none());
        assert!(state.active_logtails.is_empty());
    }

    #[test]
    fn test_safe_plugin_path_accepts_valid() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();
        let path = state.safe_plugin_path("my-plugin_1.0");
        assert!(path.is_some());
        assert!(path.unwrap().ends_with("my-plugin_1.0"));
    }

    #[test]
    fn test_safe_plugin_path_rejects_path_traversal() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();
        assert!(state.safe_plugin_path("../../../etc/passwd").is_none());
        assert!(state.safe_plugin_path("../hack").is_none());
        assert!(state.safe_plugin_path("plugin/../../etc").is_none());
    }

    #[test]
    fn test_safe_plugin_path_rejects_empty() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();
        assert!(state.safe_plugin_path("").is_none());
    }

    #[test]
    fn test_safe_plugin_path_rejects_special_chars() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();
        assert!(state.safe_plugin_path("plugin;rm -rf /").is_none());
        assert!(state.safe_plugin_path("plugin|cat /etc/passwd").is_none());
    }

    #[test]
    fn test_add_audit_log_in_memory() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        state.add_audit_log("ssh_connect", serde_json::json!({"host": "192.168.1.1"}), "10.0.0.1", "space-a");
        let logs = state.audit_logs.read();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].action, "ssh_connect");
    }

    #[test]
    fn test_audit_log_trims_excess() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        for i in 0..1100 {
            state.add_audit_log("test_action", serde_json::json!({"i": i}), "127.0.0.1", "space-a");
        }

        let logs = state.audit_logs.read();
        assert!(logs.len() <= 1000);
    }

    #[test]
    fn test_ws_token_store() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        state.ws_tokens.insert(
            "abc".into(),
            WsTokenInfo {
                token: "abc".into(),
                ip: "10.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
                space_id: "space-a".into(),
            },
        );

        assert!(state.ws_tokens.contains_key("abc"));
        assert!(!state.ws_tokens.contains_key("nonexistent"));
    }

    #[test]
    fn test_add_alert_and_trim() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        for i in 0..600 {
            state.add_alert(AlertEntry {
                id: format!("alert-{}", i),
                timestamp: chrono::Utc::now().to_rfc3339(),
                level: "info".into(),
                host: "localhost".into(),
                metric: "cpu".into(),
                message: format!("alert {}", i),
                value: i as f64,
                threshold: 100.0,
                space_id: "space-a".into(),
            });
        }

        let alerts = state.alerts.read();
        assert!(alerts.len() <= 500);
    }
}
