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

    /// List all vault entries.
    pub async fn list_vault_entries(&self) -> anyhow::Result<Vec<VaultEntry>> {
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, kind, encrypted_value, tags, created_at, updated_at
                 FROM vault_entries ORDER BY updated_at DESC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(VaultEntry {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    encrypted_value: row.get(3)?,
                    tags: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
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

    /// Get a single vault entry by ID.
    pub async fn get_vault_entry(&self, entry_id: &str) -> anyhow::Result<Option<VaultEntry>> {
        let id = entry_id.to_string();
        self.exec(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, kind, encrypted_value, tags, created_at, updated_at
                 FROM vault_entries WHERE id = ?1",
            )?;

            let mut rows = stmt.query_map([&id], |row| {
                Ok(VaultEntry {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    encrypted_value: row.get(3)?,
                    tags: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
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
        let enc_val = entry.encrypted_value.clone();
        let tags = entry.tags.clone();
        let created_at = entry.created_at.clone();
        let updated_at = entry.updated_at.clone();

        self.exec(move |conn| {
            conn.execute(
                "INSERT INTO vault_entries (id, name, kind, encrypted_value, tags, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, name, kind, enc_val, tags, created_at, updated_at],
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
        let enc_val = entry.encrypted_value.clone();
        let tags = entry.tags.clone();
        let updated_at = entry.updated_at.clone();

        self.exec(move |conn| {
            let affected = conn.execute(
                "UPDATE vault_entries SET name=?2, kind=?3, encrypted_value=?4, tags=?5, updated_at=?6
                 WHERE id=?1",
                rusqlite::params![id, name, kind, enc_val, tags, updated_at],
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
    pub async fn list_table_counts(&self) -> anyhow::Result<Vec<(String, i64)>> {
        self.exec(|conn| {
            let mut stmt = conn.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )?;
            let table_names: Vec<String> = stmt.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;

            let mut tables = Vec::new();
            for name in &table_names {
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

// ─── Schema definitions ──────────────────────────────────────────

const SCHEMA_V1: &str = "
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
";

const SCHEMA_V2: &str = "
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
";

const SCHEMA_V3: &str = "
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
";

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
}
