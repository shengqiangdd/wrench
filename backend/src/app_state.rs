use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use crate::config::AppConfig;
use crate::db::Database;
use crate::ssh::SshConnection;
use crate::utils::jwt::JwtService;

/// 并发闸门触顶的是哪一档。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaScope {
    /// 全实例上限（不随身份变化）
    Global,
    /// 单空间上限（公平性）
    Space,
}

/// 并发闸门的触顶信息，用来给访客一句能读懂的话。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionQuota {
    pub scope: QuotaScope,
    pub max: usize,
    pub current: usize,
}

impl SessionQuota {
    /// 面向使用者的原因说明（中英混排场景下带英文关键字，便于排查）。
    pub fn message(&self) -> String {
        match self.scope {
            QuotaScope::Global => format!(
                "实例同时保活的 SSH 连接已达上限（{} / {}）—— 请先关闭不用的终端再试 (max sessions reached)",
                self.current, self.max
            ),
            QuotaScope::Space => format!(
                "本空间同时保活的 SSH 连接已达上限（{} / {}）—— 请先关闭不用的终端再试 (space session limit)",
                self.current, self.max
            ),
        }
    }

    /// 审计用的短标签。
    pub fn audit_scope(&self) -> &'static str {
        match self.scope {
            QuotaScope::Global => "global",
            QuotaScope::Space => "space",
        }
    }
}

/// 并发闸门的纯判定（把计数与判定分开，便于直接测边界）。
///
/// `max_*` 为 `0` 表示该档不限；全局档优先于单空间档（先撞到哪个报哪个）。
pub(crate) fn quota_from_counts(
    global: usize,
    in_space: usize,
    max_global: usize,
    max_space: usize,
) -> Option<SessionQuota> {
    if max_global != 0 && global >= max_global {
        return Some(SessionQuota { scope: QuotaScope::Global, max: max_global, current: global });
    }
    if max_space != 0 && in_space >= max_space {
        return Some(SessionQuota { scope: QuotaScope::Space, max: max_space, current: in_space });
    }
    None
}

/// Shared application state accessible from all handlers.
/// Low-cardinality counters for in-flight exec operations.
#[derive(Default)]
pub struct ExecMetrics {
    pub started: AtomicU64,
    pub completed: AtomicU64,
    pub cancelled: AtomicU64,
}

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
    /// In-flight exec operations, isolated by space and request id.
    pub exec_cancellations: DashMap<String, CancellationToken>,
    pub exec_metrics: Arc<ExecMetrics>,
    /// 门（door）运行时状态：门户口令与令牌版本。
    pub auth: RwLock<AuthRuntime>,
    /// 当前打开的 WebSocket 连接数（用于 `WRENCH_MAX_WS_CONNECTIONS` 闸门）。
    ///
    /// 用原子计数而不是 DashMap：这条路径每次握手都要走，读改写必须是 O(1) 且不持锁。
    /// 名额由 [`WsSlot`] 的 `Drop` 归还 —— 连接任务正常结束、报错退出、甚至 panic
    /// 展开时都会归还，不需要在每个返回点手写递减。
    pub ws_connections: Arc<AtomicUsize>,
    /// 服务器启动时间，用于计算 uptime
    pub start_time: std::time::Instant,
}

/// WebSocket 连接名额（RAII）。
///
/// 持有它代表「本连接占了一个名额」，丢弃即归还。字段故意不公开：外部只能通过
/// [`AppState::try_open_ws`] 拿到它，避免有人凭空造一个把计数减成负数。
pub struct WsSlot {
    counter: Arc<AtomicUsize>,
}

impl Drop for WsSlot {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::AcqRel);
    }
}

/// 门的运行时状态。
///
/// 口令来源优先级（高 → 低）：
/// 1. 数据库 `app_settings.door_password_hash`（网页里改过口令）
/// 2. 环境变量 `WRENCH_AUTH_PASSWORD` / 口令文件（部署侧提供）
/// 3. 都没有 → 门开着但没有口令 → 受保护接口一律 503（fail-closed）
///
/// 门的开关是 [`crate::config::AppConfig::require_auth`]：`off` 时完全不校验令牌
/// （访客零输入直进），此时本结构只用来签发 WS 令牌的版本号。
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

        // 门的开关状态：设门但没口令 → fail-closed（503），日志里说清怎么配；
        // 不设门 → 明确告警，因为这意味着「任何能访问本地址的人都能把这里当跳板」。
        //
        // 用 `eprintln!` 而不是 `tracing`：这两条必须在任何日志级别下都可见。
        if !config.require_auth {
            eprintln!("⚠️  入口口令已关闭（WRENCH_REQUIRE_AUTH=off）：访客零输入直进。");
            eprintln!("   任何能访问本服务地址的人都能把它当 SSH 客户端使用 —— 机器能力请靠出口白名单");
            eprintln!("   （WRENCH_EGRESS_ALLOW）收敛；每个浏览器仍有自己的私有空间（数据互不可见）。");
        } else if auth.configured() {
            eprintln!("🔐 入口口令已启用（来源：{}），未登录访客需先输入口令。", auth.source());
        } else {
            eprintln!("⛔ 没有可用的入口口令：受保护接口将一律返回 503（fail-closed）。");
            eprintln!("   部署侧设置 WRENCH_AUTH_PASSWORD（或 WRENCH_AUTH_PASSWORD_FILE）后重启即可；");
            eprintln!("   若本实例不需要口令门，设置 WRENCH_REQUIRE_AUTH=off 让访客零输入直进。");
        }

        Ok(Self {
            connections: DashMap::new(),
            docker_clients: DashMap::new(),
            alerts: RwLock::new(alerts),
            audit_logs: RwLock::new(audit_logs),
            ws_tokens: DashMap::new(),
            marketplace_cache: RwLock::new(None),
            active_logtails: DashMap::new(),
            exec_cancellations: DashMap::new(),
            exec_metrics: Arc::new(ExecMetrics::default()),
            auth: RwLock::new(auth),
            ws_connections: Arc::new(AtomicUsize::new(0)),
            db,
            jwt_service: RwLock::new(JwtService::from_secret(&config.jwt_secret).ok()),
            config,
            start_time: std::time::Instant::now(),
        })
    }

    pub fn exec_operation_key(space_id: &str, request_id: &str) -> String {
        format!("{space_id}\u{001f}{request_id}")
    }

    /// Register an operation only when the caller supplied a non-empty id.
    /// Re-registering the same id is rejected so an old operation cannot
    /// accidentally finish and remove a newer one.
    pub fn register_exec(&self, space_id: &str, request_id: &str) -> Option<CancellationToken> {
        if request_id.trim().is_empty() {
            return None;
        }
        let key = Self::exec_operation_key(space_id, request_id);
        if self.exec_cancellations.contains_key(&key) {
            return None;
        }
        let token = CancellationToken::new();
        self.exec_cancellations.insert(key, token.clone());
        self.exec_metrics.started.fetch_add(1, Ordering::Relaxed);
        Some(token)
    }

    pub fn cancel_exec(&self, space_id: &str, request_id: &str) -> bool {
        let key = Self::exec_operation_key(space_id, request_id);
        self.exec_cancellations
            .get(&key)
            .map(|entry| {
                let token = entry.value();
                let was_cancelled = token.is_cancelled();
                token.cancel();
                if !was_cancelled {
                    self.exec_metrics.cancelled.fetch_add(1, Ordering::Relaxed);
                }
                true
            })
            .unwrap_or(false)
    }

    pub fn finish_exec(&self, space_id: &str, request_id: &str) {
        let key = Self::exec_operation_key(space_id, request_id);
        if self.exec_cancellations.remove(&key).is_some() {
            self.exec_metrics.completed.fetch_add(1, Ordering::Relaxed);
        }
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
    ///
    /// fail-closed 两条：① 调用方自己的空间为空 → 什么都不给；② 连接注册时
    /// 没有归属（`space_id` 为空）→ 对任何调用方都不可见。第 ② 条是
    /// 「文件管理连不上」那个 bug 的兜底：WS 路径一旦漏打空间，这些会话会变成
    /// 谁都看不见的孤儿，而不是变成谁都能用的公共资源。
    pub fn connection_in(&self, space_id: &str, connection_id: &str) -> Option<SshConnection> {
        if space_id.is_empty() {
            return None;
        }
        let entry = self.connections.get(connection_id)?;
        if entry.space_id.is_empty() || entry.space_id != space_id {
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
        if space_id.is_empty() {
            return Vec::new();
        }
        self.connections
            .iter()
            .filter(|e| e.value().space_id == space_id)
            .map(|e| e.value().clone())
            .collect()
    }

    /// 并发闸门：新建 SSH 连接前调用。返回 `Some(触顶档位)` 表示**已经到顶，应当拒绝**。
    ///
    /// 两档闸门（都由 `AppConfig` 配置，`0` = 该档不限）：
    /// * **全局**（`WRENCH_MAX_SESSIONS`，默认 32）—— 不随身份变化，门关着时换空间码
    ///   也绕不过去，是「数量」这层唯一的兜底；
    /// * **单空间**（`WRENCH_MAX_SESSIONS_PER_SPACE`，默认 8）—— 公平性，防止一个访客
    ///   把整机额度占满。
    ///
    /// 计数口径：注册表里**会话已建立**（`session.is_some()`）的连接。只连上但没开出
    /// 会话的条目不算数（它们不占 PTY / 上行通道）；反过来说，已经死掉但还没被 5 分钟
    /// 那轮清理收走的会话仍然占额度 —— 这只会挡住**自己**的空间（配额是按空间算的），
    /// 不会让别人连不上，属于可接受的保守。
    pub fn session_quota_reached(&self, space_id: &str) -> Option<SessionQuota> {
        let max_global = self.config.max_sessions;
        let max_space = self.config.max_sessions_per_space;
        let mut global = 0usize;
        let mut in_space = 0usize;
        for entry in self.connections.iter() {
            if entry.value().session.is_none() {
                continue;
            }
            global += 1;
            if !space_id.is_empty() && entry.value().space_id == space_id {
                in_space += 1;
            }
        }
        quota_from_counts(global, in_space, max_global, max_space)
    }

    /// WebSocket 闸门：升级握手前调用。返回 `None` 表示**已达上限，应当拒绝这次升级**。
    ///
    /// 上限是 `WRENCH_MAX_WS_CONNECTIONS`（默认 128，`0` = 不限）。它与 SSH 会话闸门
    /// 互补而不重复：会话闸门数的是「已经建好 SSH 会话」的连接，这一层数的是**所有**
    /// 打开的 WS 连接 —— 包括「握手成功但一直不发 connect 消息」的那种。少了这一层，
    /// 公网实例上只要反复握手就能把 fd / 任务 / 缓冲堆到进程撑不住。
    ///
    /// 返回的 [`WsSlot`] 必须活到连接结束（放进 `on_upgrade` 的 future 里），
    /// 由它的 `Drop` 归还名额。返回 `None` 时调用方应回 503 —— 故意不做「等等再试」的
    /// 排队：排队本身也要占资源，而且会让攻击者用慢连接把队列变成新的耗尽目标。
    pub fn try_open_ws(&self) -> Option<WsSlot> {
        let current = self.ws_connections.fetch_add(1, Ordering::AcqRel) + 1;
        let max = self.config.max_ws_connections;
        if max != 0 && current > max {
            // 先把刚加上的减回去，再拒绝 —— 计数必须只反映真实存在的连接。
            self.ws_connections.fetch_sub(1, Ordering::AcqRel);
            tracing::warn!(
                target: "wrench_backend",
                "WebSocket 并发闸门拒绝升级：已达上限（{} / {}）",
                current - 1,
                max
            );
            return None;
        }
        Some(WsSlot { counter: self.ws_connections.clone() })
    }

    /// 当前打开的 WebSocket 连接数（诊断 / 测试用）。
    pub fn ws_connection_count(&self) -> usize {
        self.ws_connections.load(Ordering::Acquire)
    }

    /// 删除本空间的活连接（不是自己的连接不动）。
    pub fn remove_connection_in(&self, space_id: &str, connection_id: &str) -> Option<SshConnection> {
        let owned = !space_id.is_empty()
            && self
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
            require_auth: true,
            max_sessions: crate::config::DEFAULT_MAX_SESSIONS,
            max_sessions_per_space: crate::config::DEFAULT_MAX_SESSIONS_PER_SPACE,
            max_ws_connections: crate::config::DEFAULT_MAX_WS_CONNECTIONS,
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

    /// 并发闸门：全局档 / 单空间档的边界，以及「0 = 不限」的语义。
    #[test]
    fn session_quota_edges() {
        // 两档都没到 → 放行
        assert!(quota_from_counts(3, 2, 32, 8).is_none());
        // 单空间到顶（8/8）→ 报空间档
        let q = quota_from_counts(9, 8, 32, 8).expect("空间档应触顶");
        assert_eq!(q.scope, QuotaScope::Space);
        assert_eq!((q.current, q.max), (8, 8));
        assert!(q.message().contains("8 / 8"));
        assert_eq!(q.audit_scope(), "space");
        // 全局到顶（32/32）→ 报全局档（优先于空间档）
        let q = quota_from_counts(32, 1, 32, 8).expect("全局档应触顶");
        assert_eq!(q.scope, QuotaScope::Global);
        assert_eq!((q.current, q.max), (32, 32));
        assert_eq!(q.audit_scope(), "global");
        // 刚好差一个 → 放行（上限是「可达」的：32 条允许 32 条）
        assert!(quota_from_counts(31, 7, 32, 8).is_none());
        // 0 = 不限
        assert!(quota_from_counts(9999, 9999, 0, 0).is_none());
        assert!(quota_from_counts(9999, 9999, 0, 8).is_some());
        assert!(quota_from_counts(9999, 9999, 32, 0).is_some());
        // 空间档在全局档关闭时照样生效
        let q = quota_from_counts(100, 8, 0, 8).expect("空间档应触顶");
        assert_eq!(q.scope, QuotaScope::Space);
    }

    /// 计数口径：只有「会话已建立」的连接才占额度（`session.is_none()` 不算）。
    #[test]
    fn session_quota_ignores_entries_without_session() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mut config = test_config();
        config.max_sessions = 1;
        config.max_sessions_per_space = 1;
        let state = rt.block_on(AppState::new(config)).unwrap();
        assert!(state.session_quota_reached("space-a").is_none());
        // 放一条「没开出会话」的空壳连接：不该占额度
        state.connections.insert(
            "c-empty".into(),
            crate::ssh::SshConnection::new(
                "c-empty".to_string(),
                "h".to_string(),
                22,
                "u".to_string(),
                "password".to_string(),
            )
            .with_space("space-a"),
        );
        assert!(state.session_quota_reached("space-a").is_none());
    }

    /// WS 并发闸门：到顶拒绝、名额归还、`0 = 不限`。
    #[test]
    fn ws_gate_enforces_limit_and_returns_slots() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mut config = test_config();
        config.max_ws_connections = 2;
        let state = rt.block_on(AppState::new(config)).unwrap();

        let a = state.try_open_ws().expect("第 1 条应放行");
        let b = state.try_open_ws().expect("第 2 条应放行（上限是可达的）");
        assert_eq!(state.ws_connection_count(), 2);
        assert!(state.try_open_ws().is_none(), "第 3 条应被拒");
        // 被拒不能把计数弄脏（否则一次拒绝会让计数永久偏高，最终谁都连不上）
        assert_eq!(state.ws_connection_count(), 2);

        // 归还一个名额 → 又能再开一条
        drop(a);
        assert_eq!(state.ws_connection_count(), 1);
        let c = state.try_open_ws().expect("归还后应放行");
        assert_eq!(state.ws_connection_count(), 2);
        drop(b);
        drop(c);
        assert_eq!(state.ws_connection_count(), 0, "全部归还后应回到 0");
    }

    /// `WRENCH_MAX_WS_CONNECTIONS=0` 表示不限：不拒绝，也不把计数减成负数。
    #[test]
    fn ws_gate_zero_means_unlimited() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let mut config = test_config();
        config.max_ws_connections = 0;
        let state = rt.block_on(AppState::new(config)).unwrap();
        let slots: Vec<_> = (0..64).map(|_| state.try_open_ws().expect("0 = 不限")).collect();
        assert_eq!(state.ws_connection_count(), 64);
        drop(slots);
        // 64 次归还后必须精确回到 0（多减一次就会下溢成 usize::MAX）
        assert_eq!(state.ws_connection_count(), 0);
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

    // ── 空间归属的连接注册表 ──
    //
    // 回归用例：文件管理（SFTP/Docker/日志）报「SSH not connected」的真因，是
    // WebSocket 终端路径把 SSH 会话注册成「未归属」（space_id 为空串），而
    // connection_in() 对未归属连接一律不可见。这些断言把那条契约钉住。

    fn register(state: &AppState, id: &str, space: Option<&str>) {
        let mut conn = SshConnection::new(id.into(), "10.0.0.1".into(), 22, "root".into(), "password".into());
        if let Some(s) = space {
            conn = conn.with_space(s);
        }
        state.connections.insert(id.into(), conn);
    }

    #[test]
    fn test_connection_in_is_space_scoped() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        register(&state, "c-a", Some("space-a"));
        register(&state, "orphan", None); // 未归属（旧 WS 路径的产物）

        assert!(state.connection_in("space-a", "c-a").is_some());
        // 跨空间一律视为不存在
        assert!(state.connection_in("space-b", "c-a").is_none());
        // 未归属的连接对任何空间都不可见（fail-closed，不能加"空串通吃"的后门）
        assert!(state.connection_in("space-a", "orphan").is_none());
        assert!(state.connection_in("", "orphan").is_none());
        // 不存在的 id
        assert!(state.connection_in("space-a", "nope").is_none());
    }

    #[test]
    fn test_connections_in_lists_only_own_space() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        register(&state, "c-a", Some("space-a"));
        register(&state, "c-b", Some("space-b"));
        register(&state, "orphan", None);

        let mut a: Vec<String> = state
            .connections_in("space-a")
            .into_iter()
            .map(|c| c.connection_id)
            .collect();
        a.sort();
        assert_eq!(a, vec!["c-a".to_string()]);
        assert_eq!(state.connections_in("space-b").len(), 1);
        assert!(state.connections_in("space-c").is_empty());
    }

    #[test]
    fn test_remove_connection_in_does_not_touch_other_spaces() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let state = rt.block_on(AppState::new(test_config())).unwrap();

        register(&state, "c-a", Some("space-a"));

        // 别人删不掉：返回 None 且连接仍在
        assert!(state.remove_connection_in("space-b", "c-a").is_none());
        assert!(state.connections.contains_key("c-a"));

        // 自己可以删
        assert!(state.remove_connection_in("space-a", "c-a").is_some());
        assert!(!state.connections.contains_key("c-a"));
    }
}
