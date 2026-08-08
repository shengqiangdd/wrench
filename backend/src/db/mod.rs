//! SQLite persistence layer.
//!
//! Wrench uses SQLite (via `rusqlite` with `bundled` feature) for
//! lightweight, zero-dependency persistence of audit logs and alerts.
//!
//! All database operations are dispatched via `tokio::task::spawn_blocking`
//! so they never block the async runtime.

use std::path::Path;
use std::sync::Arc;

use rusqlite::Connection;
use tokio::sync::Mutex;

use crate::app_state::{AlertEntry, AuditEntry};

/// Whitelist of known tables for `list_table_counts`.
/// Prevents dynamic SQL injection even though names currently come from sqlite_master.
const ALLOWED_TABLES: &[&str] = &[
    "audit_logs",
    "alerts",
    "vault_entries",
    "notification_channels",
    "ssh_connections",
    "scheduled_tasks",
    "task_execution_history",
];

/// Shared database handle.
#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// Open (or create) the SQLite database at `path`.
    ///
    /// Enables WAL mode for concurrent reads and sets a busy timeout.
    /// Runs any pending migrations.
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;

        // WAL mode: better concurrency, no readers block writers
        // synchronous=NORMAL: ~2x faster writes with WAL (still durable enough)
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA foreign_keys=ON;",
        )?;

        let db = Self { conn: Arc::new(Mutex::new(conn)) };

        db.migrate().await?;
        tracing::info!("SQLite database ready: {}", path.display());
        Ok(db)
    }

    /// Open an in-memory database (for testing).
    pub async fn open_in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA busy_timeout=5000;
             PRAGMA foreign_keys=ON;",
        )?;

        let db = Self { conn: Arc::new(Mutex::new(conn)) };

        db.migrate().await?;
        Ok(db)
    }

    // ─── Migrations ──────────────────────────────────────────────

    /// Run pending schema migrations.
    async fn migrate(&self) -> anyhow::Result<()> {
        self.exec(move |conn| {
            let version: i32 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .unwrap_or(0);

            if version < 1 {
                conn.execute_batch(SCHEMA_V1)?;
                conn.pragma_update(None, "user_version", 1)?;
                tracing::info!("DB migration V1 applied");
            }

            if version < 2 {
                conn.execute_batch(SCHEMA_V2)?;
                conn.pragma_update(None, "user_version", 2)?;
                tracing::info!("DB migration V2 applied (vault + notifications)");
            }

            if version < 3 {
                conn.execute_batch(SCHEMA_V3)?;
                conn.pragma_update(None, "user_version", 3)?;
                tracing::info!("DB migration V3 applied (ssh_connections)");
            }

            if version < 4 {
                conn.execute_batch(SCHEMA_V4)?;
                conn.pragma_update(None, "user_version", 4)?;
                tracing::info!("DB migration V4 applied (scheduler)");
            }

            if version < 5 {
                conn.execute_batch(SCHEMA_V5)?;
                conn.pragma_update(None, "user_version", 5)?;
                tracing::info!("DB migration V5 applied (vault plaintext index)");
            }

            Ok::<_, anyhow::Error>(())
        })
        .await
    }

    // ─── Audit Logs ──────────────────────────────────────────────

    /// Insert an audit log entry asynchronously.
    pub async fn insert_audit_log(&self, timestamp: &str, action: &str, detail: &str, ip: &str) -> anyhow::Result<i64> {
        let ts = timestamp.to_string();
        let act = action.to_string();
        let det = detail.to_string();
        let addr = ip.to_string();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO audit_logs (timestamp, action, detail, ip) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![ts, act, det, addr],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    /// Load recent audit logs (most recent first).
    pub async fn load_recent_audit_logs(&self, limit: usize) -> anyhow::Result<Vec<AuditEntry>> {
        let limit_i64 = limit as i64;

        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, timestamp, action, detail, ip
                 FROM audit_logs
                 ORDER BY id DESC
                 LIMIT ?1",
            )?;

            let rows = stmt.query_map(rusqlite::params![limit_i64], |row| {
                let _id: i64 = row.get(0)?;
                let timestamp: String = row.get(1)?;
                let action: String = row.get(2)?;
                let detail_str: String = row.get(3)?;
                let ip: String = row.get(4)?;

                let detail: serde_json::Value = serde_json::from_str(&detail_str).unwrap_or(serde_json::Value::Null);

                Ok(AuditEntry { timestamp, action, detail, ip })
            })?;

            let mut entries = Vec::new();
            for row in rows {
                entries.push(row?);
            }
            // Reverse so oldest-first (preserve chronological order in memory)
            entries.reverse();
            Ok(entries)
        })
        .await
    }

    // ─── Alerts ──────────────────────────────────────────────────

    /// Insert an alert entry asynchronously.
    pub async fn insert_alert(&self, alert: &AlertEntry) -> anyhow::Result<i64> {
        let id = alert.id.clone();
        let timestamp = alert.timestamp.clone();
        let level = alert.level.clone();
        let host = alert.host.clone();
        let metric = alert.metric.clone();
        let message = alert.message.clone();
        let value = alert.value;
        let threshold = alert.threshold;

        self.exec(move |conn| {
            conn.execute(
                "INSERT OR IGNORE INTO alerts (id, timestamp, level, host, metric, message, value, threshold)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![id, timestamp, level, host, metric, message, value, threshold],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    /// Load all alerts (most recent first).
    pub async fn load_alerts(&self, limit: usize) -> anyhow::Result<Vec<AlertEntry>> {
        let limit_i64 = limit as i64;

        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, timestamp, level, host, metric, message, value, threshold
                 FROM alerts
                 ORDER BY timestamp DESC
                 LIMIT ?1",
            )?;

            let rows = stmt.query_map(rusqlite::params![limit_i64], |row| {
                Ok(AlertEntry {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    level: row.get(2)?,
                    host: row.get(3)?,
                    metric: row.get(4)?,
                    message: row.get(5)?,
                    value: row.get(6)?,
                    threshold: row.get(7)?,
                })
            })?;

            let mut entries = Vec::new();
            for row in rows {
                entries.push(row?);
            }
            entries.reverse();
            Ok(entries)
        })
        .await
    }

    // ─── Vault ──────────────────────────────────────────────────

    /// List all vault entries (metadata only — no encrypted_value for perf).
    pub async fn list_vault_entries(&self) -> anyhow::Result<Vec<VaultEntry>> {
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, kind, name_plain, kind_plain, '', tags, created_at, updated_at
                 FROM vault_entries ORDER BY updated_at DESC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(VaultEntry {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    name_plain: row.get(3)?,
                    kind_plain: row.get(4)?,
                    encrypted_value: row.get(5)?,
                    tags: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;

            let mut entries = Vec::new();
            for row in rows {
                entries.push(row?);
            }
            Ok(entries)
        })
        .await
    }

    /// Get a single vault entry by ID (with encrypted_value for decryption).
    pub async fn get_vault_entry(&self, entry_id: &str) -> anyhow::Result<Option<VaultEntry>> {
        let id = entry_id.to_string();
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, kind, name_plain, kind_plain, encrypted_value, tags, created_at, updated_at
                 FROM vault_entries WHERE id = ?1",
            )?;

            let mut rows = stmt.query_map([&id], |row| {
                Ok(VaultEntry {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    name_plain: row.get(3)?,
                    kind_plain: row.get(4)?,
                    encrypted_value: row.get(5)?,
                    tags: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;

            Ok(rows.next().transpose()?)
        })
        .await
    }

    /// Insert a vault entry.
    pub async fn insert_vault_entry(&self, entry: &VaultEntry) -> anyhow::Result<()> {
        let id = entry.id.clone();
        let name = entry.name.clone();
        let kind = entry.kind.clone();
        let name_plain = entry.name_plain.clone();
        let kind_plain = entry.kind_plain.clone();
        let enc_val = entry.encrypted_value.clone();
        let tags = entry.tags.clone();
        let created_at = entry.created_at.clone();
        let updated_at = entry.updated_at.clone();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO vault_entries (id, name, kind, name_plain, kind_plain, encrypted_value, tags, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![id, name, kind, name_plain, kind_plain, enc_val, tags, created_at, updated_at],
            )?;
            Ok(())
        })
        .await
    }

    /// Update a vault entry.
    pub async fn update_vault_entry(&self, entry: &VaultEntry) -> anyhow::Result<bool> {
        let id = entry.id.clone();
        let name = entry.name.clone();
        let kind = entry.kind.clone();
        let name_plain = entry.name_plain.clone();
        let kind_plain = entry.kind_plain.clone();
        let enc_val = entry.encrypted_value.clone();
        let tags = entry.tags.clone();
        let updated_at = entry.updated_at.clone();

        self.exec(move |conn| {
            let affected = conn.execute(
                "UPDATE vault_entries SET name=?2, kind=?3, name_plain=?4, kind_plain=?5, encrypted_value=?6, tags=?7, updated_at=?8
                 WHERE id=?1",
                rusqlite::params![id, name, kind, name_plain, kind_plain, enc_val, tags, updated_at],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    /// Delete a vault entry.
    pub async fn delete_vault_entry(&self, entry_id: &str) -> anyhow::Result<bool> {
        let id = entry_id.to_string();
        self.exec(move |conn| {
            let affected = conn.execute("DELETE FROM vault_entries WHERE id = ?1", rusqlite::params![id])?;
            Ok(affected > 0)
        })
        .await
    }

    // ─── Notification Channels ──────────────────────────────────

    /// List all notification channels.
    pub async fn list_notification_channels(&self) -> anyhow::Result<Vec<NotificationChannel>> {
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, channel_type, config, enabled, created_at, updated_at
                 FROM notification_channels ORDER BY created_at ASC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(NotificationChannel {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    channel_type: row.get(2)?,
                    config: row.get(3)?,
                    enabled: row.get::<_, i32>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?;

            let mut channels = Vec::new();
            for row in rows {
                channels.push(row?);
            }
            Ok(channels)
        })
        .await
    }

    /// Upsert a notification channel.
    pub async fn upsert_notification_channel(&self, ch: &NotificationChannel) -> anyhow::Result<()> {
        let id = ch.id.clone();
        let name = ch.name.clone();
        let ctype = ch.channel_type.clone();
        let config = ch.config.clone();
        let enabled = ch.enabled as i32;
        let created_at = ch.created_at.clone();
        let updated_at = ch.updated_at.clone();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO notification_channels (id, name, channel_type, config, enabled, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, channel_type=excluded.channel_type, config=excluded.config,
                    enabled=excluded.enabled, updated_at=excluded.updated_at",
                rusqlite::params![id, name, ctype, config, enabled, created_at, updated_at],
            )?;
            Ok(())
        })
        .await
    }

    /// Delete a notification channel.
    pub async fn delete_notification_channel(&self, channel_id: &str) -> anyhow::Result<bool> {
        let id = channel_id.to_string();
        self.exec(move |conn| {
            let affected = conn.execute("DELETE FROM notification_channels WHERE id = ?1", rusqlite::params![id])?;
            Ok(affected > 0)
        })
        .await
    }

    // ─── Scheduler ────────────────────────────────────────────

    /// List all scheduled tasks.
    pub async fn list_scheduled_tasks(&self) -> anyhow::Result<Vec<ScheduledTask>> {
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, description, cron_expr, task_type, task_config,
                        target_host_id, enabled, last_run_at, next_run_at,
                        created_at, updated_at
                 FROM scheduled_tasks ORDER BY id ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(ScheduledTask {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    cron_expr: row.get(3)?,
                    task_type: row.get(4)?,
                    task_config: row.get(5)?,
                    target_host_id: row.get(6)?,
                    enabled: row.get::<_, i32>(7)? != 0,
                    last_run_at: row.get(8)?,
                    next_run_at: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })?;
            let mut tasks = Vec::new();
            for row in rows {
                tasks.push(row?);
            }
            Ok(tasks)
        })
        .await
    }

    /// Get a single scheduled task by ID.
    pub async fn get_scheduled_task(&self, task_id: i64) -> anyhow::Result<Option<ScheduledTask>> {
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, description, cron_expr, task_type, task_config,
                        target_host_id, enabled, last_run_at, next_run_at,
                        created_at, updated_at
                 FROM scheduled_tasks WHERE id = ?1",
            )?;
            let mut rows = stmt.query_map(rusqlite::params![task_id], |row| {
                Ok(ScheduledTask {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    cron_expr: row.get(3)?,
                    task_type: row.get(4)?,
                    task_config: row.get(5)?,
                    target_host_id: row.get(6)?,
                    enabled: row.get::<_, i32>(7)? != 0,
                    last_run_at: row.get(8)?,
                    next_run_at: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })?;
            Ok(rows.next().transpose()?)
        })
        .await
    }

    /// Insert a scheduled task. Returns the new row id.
    pub async fn insert_scheduled_task(&self, task: &ScheduledTask) -> anyhow::Result<i64> {
        let name = task.name.clone();
        let description = task.description.clone();
        let cron_expr = task.cron_expr.clone();
        let task_type = task.task_type.clone();
        let task_config = task.task_config.clone();
        let target_host_id = task.target_host_id.clone();
        let enabled = if task.enabled { 1 } else { 0 };
        let last_run_at = task.last_run_at.clone();
        let next_run_at = task.next_run_at.clone();
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO scheduled_tasks (name, description, cron_expr, task_type, task_config,
                 target_host_id, enabled, last_run_at, next_run_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![name, description, cron_expr, task_type, task_config,
                    target_host_id, enabled, last_run_at, next_run_at, now, now],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    /// Update a scheduled task.
    pub async fn update_scheduled_task(&self, task_id: i64, task: &ScheduledTask) -> anyhow::Result<bool> {
        let name = task.name.clone();
        let description = task.description.clone();
        let cron_expr = task.cron_expr.clone();
        let task_type = task.task_type.clone();
        let task_config = task.task_config.clone();
        let target_host_id = task.target_host_id.clone();
        let enabled = if task.enabled { 1 } else { 0 };
        let last_run_at = task.last_run_at.clone();
        let next_run_at = task.next_run_at.clone();
        let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f").to_string();

        self.exec(move |conn| {
            let affected = conn.execute(
                "UPDATE scheduled_tasks SET name=?1, description=?2, cron_expr=?3,
                 task_type=?4, task_config=?5, target_host_id=?6, enabled=?7,
                 last_run_at=?8, next_run_at=?9, updated_at=?10
                 WHERE id=?11",
                rusqlite::params![name, description, cron_expr, task_type, task_config,
                    target_host_id, enabled, last_run_at, next_run_at, now, task_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    /// Delete a scheduled task.
    pub async fn delete_scheduled_task(&self, task_id: i64) -> anyhow::Result<bool> {
        self.exec(move |conn| {
            let affected = conn.execute("DELETE FROM scheduled_tasks WHERE id = ?1", rusqlite::params![task_id])?;
            Ok(affected > 0)
        })
        .await
    }

    /// Toggle the enabled state of a task.
    pub async fn toggle_scheduled_task(&self, task_id: i64) -> anyhow::Result<bool> {
        self.exec(move |conn| {
            let affected = conn.execute(
                "UPDATE scheduled_tasks SET enabled = NOT enabled, updated_at = datetime('now') WHERE id = ?1",
                rusqlite::params![task_id],
            )?;
            Ok(affected > 0)
        })
        .await
    }

    /// Update a scheduled task's execution timestamps.
    pub async fn update_task_timestamps(
        &self,
        task_id: i64,
        last_run_at: &str,
        next_run_at: Option<&str>,
    ) -> anyhow::Result<()> {
        let last = last_run_at.to_string();
        let next = next_run_at.map(|s| s.to_string());
        self.exec(move |conn| {
            conn.execute(
                "UPDATE scheduled_tasks SET last_run_at=?1, next_run_at=?2, updated_at=datetime('now') WHERE id=?3",
                rusqlite::params![last, next, task_id],
            )?;
            Ok(())
        })
        .await
    }

    /// List execution history for a task.
    pub async fn list_task_history(&self, task_id: i64, limit: usize) -> anyhow::Result<Vec<TaskExecution>> {
        let limit_i64 = limit as i64;
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, status, output, error_message, started_at, finished_at
                 FROM task_execution_history
                 WHERE task_id = ?1
                 ORDER BY id DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(rusqlite::params![task_id, limit_i64], |row| {
                Ok(TaskExecution {
                    id: row.get(0)?,
                    task_id: row.get(1)?,
                    status: row.get(2)?,
                    output: row.get(3)?,
                    error_message: row.get(4)?,
                    started_at: row.get(5)?,
                    finished_at: row.get(6)?,
                })
            })?;
            let mut history = Vec::new();
            for row in rows {
                history.push(row?);
            }
            Ok(history)
        })
        .await
    }

    /// Insert a task execution record.
    pub async fn insert_task_execution(&self, exec: &TaskExecution) -> anyhow::Result<i64> {
        let task_id = exec.task_id;
        let status = exec.status.clone();
        let output = exec.output.clone();
        let error_message = exec.error_message.clone();
        let started_at = exec.started_at.clone();
        let finished_at = exec.finished_at.clone();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO task_execution_history (task_id, status, output, error_message, started_at, finished_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![task_id, status, output, error_message, started_at, finished_at],
            )?;
            Ok(conn.last_insert_rowid())
        })
        .await
    }

    /// Update a task execution record with completion data.
    pub async fn update_task_execution(
        &self,
        exec_id: i64,
        status: &str,
        output: &str,
        error_message: Option<&str>,
        finished_at: &str,
    ) -> anyhow::Result<()> {
        let s = status.to_string();
        let o = output.to_string();
        let e = error_message.map(|s| s.to_string());
        let f = finished_at.to_string();
        self.exec(move |conn| {
            conn.execute(
                "UPDATE task_execution_history SET status=?1, output=?2, error_message=?3, finished_at=?4 WHERE id=?5",
                rusqlite::params![s, o, e, f, exec_id],
            )?;
            Ok(())
        })
        .await
    }

    // ─── Internal helpers ────────────────────────────────────────

    /// Execute a closure on the database connection via `spawn_blocking`.
    pub async fn exec<F, T>(&self, f: F) -> anyhow::Result<T>
    where
        F: FnOnce(&Connection) -> anyhow::Result<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            f(&conn)
        })
        .await?
    }

    // ─── SSH Connections ─────────────────────────────────────────

    /// List all saved SSH connections, ordered by `sort_order`.
    pub async fn list_ssh_connections(&self) -> anyhow::Result<Vec<SshConnection>> {
        self.exec(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at
                 FROM ssh_connections ORDER BY sort_order ASC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(SshConnection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get::<_, i32>(3)? as u16,
                    username: row.get(4)?,
                    auth_type: row.get(5)?,
                    config: row.get(6)?,
                    sort_order: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?;
            let mut list = Vec::new();
            for row in rows {
                list.push(row?);
            }
            Ok(list)
        })
        .await
    }

    /// Upsert an SSH connection.
    pub async fn upsert_ssh_connection(&self, conn: &SshConnection) -> anyhow::Result<()> {
        let id = conn.id.clone();
        let name = conn.name.clone();
        let host = conn.host.clone();
        let port = conn.port as i32;
        let username = conn.username.clone();
        let auth_type = conn.auth_type.clone();
        let config = conn.config.clone();
        let sort_order = conn.sort_order;
        let created_at = conn.created_at.clone();
        let updated_at = conn.updated_at.clone();
        self.exec(move |c| {
            c.execute(
                "INSERT INTO ssh_connections (id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, host=excluded.host, port=excluded.port,
                    username=excluded.username, auth_type=excluded.auth_type,
                    config=excluded.config, sort_order=excluded.sort_order,
                    updated_at=excluded.updated_at",
                rusqlite::params![id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at],
            )?;
            Ok(())
        }).await
    }

    /// Delete an SSH connection by ID.
    pub async fn delete_ssh_connection(&self, connection_id: &str) -> anyhow::Result<bool> {
        let id = connection_id.to_owned();
        self.exec(move |c| {
            let affected = c.execute("DELETE FROM ssh_connections WHERE id = ?1", rusqlite::params![id])?;
            Ok(affected > 0)
        })
        .await
    }

    /// List all tables and their row counts (for system maintenance UI).
    ///
    /// Only returns counts for tables in the `ALLOWED_TABLES` whitelist.
    /// Unknown tables are skipped with a warning to prevent SQL injection
    /// even though names currently come from `sqlite_master`.
    pub async fn list_table_counts(&self) -> anyhow::Result<Vec<(String, i64)>> {
        self.exec(|conn| {
            let mut stmt = conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )?;
            let table_names: Vec<String> = stmt.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;

            let mut tables = Vec::new();
            for name in &table_names {
                if !ALLOWED_TABLES.contains(&name.as_str()) {
                    tracing::warn!("Skipping unknown table not in whitelist: {}", name);
                    continue;
                }
                let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", name), [], |row| row.get(0))?;
                tables.push((name.clone(), count));
            }
            Ok(tables)
        })
        .await
    }
}

// ─── Vault types ───────────────────────────────────────────────

/// A vault entry representing an encrypted credential.
#[derive(Debug, Clone)]
pub struct VaultEntry {
    pub id: String,
    pub name: String,
    pub kind: String, // ssh_key | api_key | password | note
    pub name_plain: String,  // plaintext name for index queries (V5+)
    pub kind_plain: String,  // plaintext kind for index queries (V5+)
    pub encrypted_value: String,
    pub tags: String, // JSON array
    pub created_at: String,
    pub updated_at: String,
}

/// A notification channel configuration.
#[derive(Debug, Clone)]
pub struct NotificationChannel {
    pub id: String,
    pub name: String,
    pub channel_type: String, // discord | slack | telegram | email
    pub config: String,       // JSON object with webhook URL, token, etc.
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// An SSH connection configuration persisted in SQLite.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String, // password | key | vault_ref
    pub config: String,    // JSON: {password, private_key, vault_entry_id, sudo_password, group}
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// A scheduled task entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScheduledTask {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub cron_expr: String,
    pub task_type: String,          // ssh_exec | script
    pub task_config: String,         // JSON config
    pub target_host_id: Option<String>,
    pub enabled: bool,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// A task execution history record.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TaskExecution {
    pub id: i64,
    pub task_id: i64,
    pub status: String,     // running | success | failed
    pub output: Option<String>,
    pub error_message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

// ─── Schema definitions ──────────────────────────────────────────

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS audit_logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    detail    TEXT    NOT NULL DEFAULT '{}',
    ip        TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

CREATE TABLE IF NOT EXISTS alerts (
    id        TEXT    PRIMARY KEY,
    timestamp TEXT    NOT NULL,
    level     TEXT    NOT NULL,
    host      TEXT    NOT NULL,
    metric    TEXT    NOT NULL,
    message   TEXT    NOT NULL,
    value     REAL    NOT NULL,
    threshold REAL    NOT NULL
);
"#;

const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS vault_entries (
    id              TEXT    PRIMARY KEY,
    name            TEXT    NOT NULL,
    kind            TEXT    NOT NULL DEFAULT 'password',
    encrypted_value TEXT    NOT NULL,
    tags            TEXT    NOT NULL DEFAULT '[]',
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_channels (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    channel_type TEXT   NOT NULL,
    config      TEXT    NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);
"#;

const SCHEMA_V3: &str = r#"
CREATE TABLE IF NOT EXISTS ssh_connections (
    id          TEXT    PRIMARY KEY,
    name        TEXT    NOT NULL,
    host        TEXT    NOT NULL,
    port        INTEGER NOT NULL DEFAULT 22,
    username    TEXT    NOT NULL DEFAULT 'root',
    auth_type   TEXT    NOT NULL DEFAULT 'password',
    config      TEXT    NOT NULL DEFAULT '{}',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);
"#;

const SCHEMA_V5: &str = r#"
-- Plaintext index columns for vault list queries (avoids O(n) decrypt)
ALTER TABLE vault_entries ADD COLUMN name_plain TEXT NOT NULL DEFAULT '';
ALTER TABLE vault_entries ADD COLUMN kind_plain TEXT NOT NULL DEFAULT '';
UPDATE vault_entries SET name_plain = name, kind_plain = kind;
"#;

const SCHEMA_V4: &str = r#"
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    description     TEXT    DEFAULT '',
    cron_expr       TEXT    NOT NULL,
    task_type       TEXT    NOT NULL CHECK(task_type IN ('ssh_exec','script')),
    task_config     TEXT    NOT NULL DEFAULT '{}',
    target_host_id  TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_run_at     TEXT,
    next_run_at     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_execution_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL,
    status          TEXT    NOT NULL CHECK(status IN ('running','success','failed')),
    output          TEXT,
    error_message   TEXT,
    started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at     TEXT,
    FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
"#;

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_db() -> Database {
        Database::open_in_memory().await.unwrap()
    }

    #[test]
    fn test_open_in_memory() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(Database::open_in_memory()).unwrap();
        rt.block_on(async move {
            // Verify tables exist by inserting and reading back
            let id = db
                .insert_audit_log("2026-01-01T00:00:00Z", "test", "{}", "127.0.0.1")
                .await
                .unwrap();
            assert!(id > 0);
        });
    }

    #[test]
    fn test_insert_and_load_audit_log() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async move {
            db.insert_audit_log("2026-01-01T00:00:00Z", "ssh_connect", r#"{"host":"192.168.1.1"}"#, "10.0.0.1")
                .await
                .unwrap();

            let logs = db.load_recent_audit_logs(10).await.unwrap();
            assert_eq!(logs.len(), 1);
            assert_eq!(logs[0].action, "ssh_connect");
            assert_eq!(logs[0].ip, "10.0.0.1");
        });
    }

    #[test]
    fn test_audit_log_limit() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            for i in 0..20 {
                db.insert_audit_log(
                    &format!("2026-01-{:02}T00:00:00Z", i + 1),
                    &format!("action_{}", i),
                    "{}",
                    "127.0.0.1",
                )
                .await
                .unwrap();
            }

            let logs = db.load_recent_audit_logs(5).await.unwrap();
            assert_eq!(logs.len(), 5);
            // Should be the 5 most recent in chronological order
            assert_eq!(logs[0].action, "action_15");
            assert_eq!(logs[4].action, "action_19");
        });
    }

    #[test]
    fn test_insert_and_load_alerts() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let alert = AlertEntry {
                id: "alert-1".into(),
                timestamp: "2026-01-01T00:00:00Z".into(),
                level: "warning".into(),
                host: "localhost".into(),
                metric: "cpu".into(),
                message: "CPU > 90%".into(),
                value: 95.0,
                threshold: 90.0,
            };

            db.insert_alert(&alert).await.unwrap();

            let alerts = db.load_alerts(10).await.unwrap();
            assert_eq!(alerts.len(), 1);
            assert_eq!(alerts[0].id, "alert-1");
            assert_eq!(alerts[0].value, 95.0);
        });
    }

    #[test]
    fn test_alert_dedup() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let alert = AlertEntry {
                id: "alert-dup".into(),
                timestamp: "2026-01-01T00:00:00Z".into(),
                level: "error".into(),
                host: "h1".into(),
                metric: "mem".into(),
                message: "OOM".into(),
                value: 99.0,
                threshold: 95.0,
            };

            // Insert twice (same id)
            db.insert_alert(&alert).await.unwrap();
            db.insert_alert(&alert).await.unwrap();

            let alerts = db.load_alerts(10).await.unwrap();
            assert_eq!(alerts.len(), 1); // dedup by id
        });
    }

    #[test]
    fn test_migration_idempotent() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        // Opening twice on same path should be safe
        rt.block_on(async {
            let _db1 = Database::open_in_memory().await.unwrap();
            let _db2 = Database::open_in_memory().await.unwrap();
            // No crash = migration is idempotent
        });
    }

    // ─── Vault tests ─────────────────────────────────────────

    fn sample_vault_entry(id: &str, name: &str, kind: &str, value: &str) -> VaultEntry {
        VaultEntry {
            id: id.to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            name_plain: name.to_string(),
            kind_plain: kind.to_string(),
            encrypted_value: value.to_string(),
            tags: "[]".to_string(),
            created_at: "2026-07-03T10:00:00Z".to_string(),
            updated_at: "2026-07-03T10:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_vault_crud() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let e1 = sample_vault_entry("v1", "My SSH Key", "ssh_key", "encrypted-data-1");
            let e2 = sample_vault_entry("v2", "My API Key", "api_key", "encrypted-data-2");

            db.insert_vault_entry(&e1).await.unwrap();
            db.insert_vault_entry(&e2).await.unwrap();

            let list = db.list_vault_entries().await.unwrap();
            assert_eq!(list.len(), 2);

            let found = db.get_vault_entry("v1").await.unwrap().unwrap();
            assert_eq!(found.name, "My SSH Key");
            assert_eq!(found.encrypted_value, "encrypted-data-1");

            // Update
            let updated = VaultEntry { name: "My Updated Key".into(), ..e1 };
            let ok = db.update_vault_entry(&updated).await.unwrap();
            assert!(ok);

            let found2 = db.get_vault_entry("v1").await.unwrap().unwrap();
            assert_eq!(found2.name, "My Updated Key");

            // Delete
            let deleted = db.delete_vault_entry("v2").await.unwrap();
            assert!(deleted);
            let list2 = db.list_vault_entries().await.unwrap();
            assert_eq!(list2.len(), 1);

            // Delete non-existent
            let deleted2 = db.delete_vault_entry("nonexistent").await.unwrap();
            assert!(!deleted2);
        });
    }

    #[test]
    fn test_notification_channel_crud() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let ch = NotificationChannel {
                id: "ch1".into(),
                name: "Discord Ops".into(),
                channel_type: "discord".into(),
                config: r#"{"webhookUrl":"https://discord.com/api/webhooks/xxx"}"#.into(),
                enabled: true,
                created_at: "2026-07-03T10:00:00Z".into(),
                updated_at: "2026-07-03T10:00:00Z".into(),
            };

            db.upsert_notification_channel(&ch).await.unwrap();

            let list = db.list_notification_channels().await.unwrap();
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].channel_type, "discord");
            assert!(list[0].enabled);

            // Upsert (update)
            let updated = NotificationChannel { name: "Discord Ops Updated".into(), enabled: false, ..ch };
            db.upsert_notification_channel(&updated).await.unwrap();

            let list2 = db.list_notification_channels().await.unwrap();
            assert_eq!(list2.len(), 1);
            assert!(!list2[0].enabled);

            // Delete
            db.delete_notification_channel("ch1").await.unwrap();
            let list3 = db.list_notification_channels().await.unwrap();
            assert_eq!(list3.len(), 0);
        });
    }

    #[test]
    fn test_vault_plaintext_index_fields() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let e1 = sample_vault_entry("v1", "My SSH Key", "ssh_key", "encrypted-data-1");
            let e2 = sample_vault_entry("v2", "My API Key", "api_key", "encrypted-data-2");

            db.insert_vault_entry(&e1).await.unwrap();
            db.insert_vault_entry(&e2).await.unwrap();

            // list_vault_entries should populate name_plain and kind_plain
            let list = db.list_vault_entries().await.unwrap();
            assert_eq!(list.len(), 2);

            let first = &list[0]; // sorted by updated_at DESC, both have same timestamp, order is insert-dependent
            let second = &list[1];

            // Both should have plaintext fields populated
            for entry in &[first, second] {
                assert!(!entry.name_plain.is_empty(), "name_plain should be populated");
                assert!(!entry.kind_plain.is_empty(), "kind_plain should be populated");
                // list_vault_entries should NOT load encrypted_value (empty string)
                assert!(entry.encrypted_value.is_empty(), "encrypted_value should be empty in list query");
            }

            // Verify name/kind match
            let names: Vec<&str> = list.iter().map(|e| e.name_plain.as_str()).collect();
            assert!(names.contains(&"My SSH Key"));
            assert!(names.contains(&"My API Key"));

            // get_vault_entry should still return encrypted_value
            let full = db.get_vault_entry("v1").await.unwrap().unwrap();
            assert_eq!(full.name_plain, "My SSH Key");
            assert_eq!(full.kind_plain, "ssh_key");
            assert!(!full.encrypted_value.is_empty(), "encrypted_value should be present in get query");
        });
    }

    #[test]
    fn test_vault_update_syncs_plaintext_fields() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let db = rt.block_on(test_db());

        rt.block_on(async {
            let e1 = sample_vault_entry("v1", "Old Name", "ssh_key", "encrypted-data");
            db.insert_vault_entry(&e1).await.unwrap();

            // Update name and kind
            let updated = VaultEntry {
                id: "v1".into(),
                name: "New Name".into(),
                kind: "api_key".into(),
                name_plain: "New Name".into(),
                kind_plain: "api_key".into(),
                ..e1
            };
            db.update_vault_entry(&updated).await.unwrap();

            let list = db.list_vault_entries().await.unwrap();
            assert_eq!(list.len(), 1);
            assert_eq!(list[0].name_plain, "New Name");
            assert_eq!(list[0].kind_plain, "api_key");
        });
    }

    #[test]
    fn test_db_schema_version_5() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let db = Database::open_in_memory().await.unwrap();
            // Verify schema version is at least 5
            let version: i32 = db
                .exec(|conn| {
                    let v: i32 = conn
                        .pragma_query_value(None, "user_version", |row| row.get(0))
                        .unwrap_or(0);
                    Ok(v)
                })
                .await
                .unwrap();
            assert!(version >= 5, "Expected schema version >= 5, got {}", version);
        });
    }
}
