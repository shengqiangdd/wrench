//! 空间隔离测试 —— Wrench 多人共用（无角色、人人平等）的核心安全断言。
//!
//! 每个访客一个 `space_id`，所有业务表都带 `space_id` 列，SQL 层强制过滤。
//! 这里逐表验证「A 空间写入的东西，B 空间一条也看不到」，以及跨空间 ID
//! 冲突不会覆盖别人的行（防止猜到 id 就能改别人数据）。

use rusqlite::params;
use wrench_backend::app_state::AlertEntry;
use wrench_backend::db::{Database, NotificationChannel, ScheduledTask, SshConnection, TaskExecution, VaultEntry};

const A: &str = "space-a";
const B: &str = "space-b";

fn ssh_conn(id: &str, name: &str) -> SshConnection {
    SshConnection {
        id: id.into(),
        name: name.into(),
        host: "10.0.0.1".into(),
        port: 22,
        username: "root".into(),
        auth_type: "password".into(),
        config: "{}".into(),
        sort_order: 0,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
        space_id: String::new(),
    }
}

fn vault_entry(id: &str, name: &str) -> VaultEntry {
    VaultEntry {
        id: id.into(),
        name: name.into(),
        kind: "password".into(),
        name_plain: name.into(),
        kind_plain: "password".into(),
        encrypted_value: "enc".into(),
        tags: "[]".into(),
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

fn channel(id: &str, name: &str) -> NotificationChannel {
    NotificationChannel {
        id: id.into(),
        name: name.into(),
        channel_type: "discord".into(),
        config: "{}".into(),
        enabled: true,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

fn alert(id: &str) -> AlertEntry {
    AlertEntry {
        id: id.into(),
        timestamp: "2026-01-01T00:00:00Z".into(),
        level: "warning".into(),
        host: "h1".into(),
        metric: "cpu".into(),
        message: "CPU high".into(),
        value: 95.0,
        threshold: 90.0,
        space_id: String::new(),
    }
}

fn task() -> ScheduledTask {
    ScheduledTask {
        id: 0,
        name: "nightly".into(),
        description: String::new(),
        cron_expr: "0 3 * * *".into(),
        task_type: "ssh_exec".into(),
        task_config: "{}".into(),
        target_host_id: None,
        enabled: true,
        last_run_at: None,
        next_run_at: None,
        created_at: "2026-01-01T00:00:00Z".into(),
        updated_at: "2026-01-01T00:00:00Z".into(),
    }
}

#[tokio::test]
async fn ssh_connections_are_isolated_between_spaces() {
    let db = Database::open_in_memory().await.unwrap();

    db.upsert_ssh_connection(&ssh_conn("c1", "A 的生产机"), A)
        .await
        .unwrap();
    db.upsert_ssh_connection(&ssh_conn("c2", "B 的测试机"), B)
        .await
        .unwrap();

    let a = db.list_ssh_connections(A).await.unwrap();
    let b = db.list_ssh_connections(B).await.unwrap();
    assert_eq!(a.len(), 1, "A 空间应只看到自己的主机");
    assert_eq!(a[0].name, "A 的生产机");
    assert_eq!(b.len(), 1, "B 空间应只看到自己的主机");
    assert_eq!(b[0].name, "B 的测试机");

    // 删除也按空间隔离：B 删不掉 A 的行
    assert!(!db.delete_ssh_connection("c1", B).await.unwrap());
    assert_eq!(db.list_ssh_connections(A).await.unwrap().len(), 1);
    assert!(db.delete_ssh_connection("c1", A).await.unwrap());
    assert!(db.list_ssh_connections(A).await.unwrap().is_empty());
}

#[tokio::test]
async fn cross_space_upsert_cannot_overwrite_another_spaces_row() {
    let db = Database::open_in_memory().await.unwrap();

    db.upsert_ssh_connection(&ssh_conn("same-id", "A 的主机"), A)
        .await
        .unwrap();
    // B 用同一个 id 写入：不得覆盖 A 的行；**同时 B 自己那条必须真的写进去**。
    // （V7 之前 id 是全局主键，B 的写入被静默丢弃，接口随后报 500
    //   「Failed to verify saved connection」）
    let mut other = ssh_conn("same-id", "B 自己的主机");
    other.host = "6.6.6.6".into();
    db.upsert_ssh_connection(&other, B).await.unwrap();

    let a = db.list_ssh_connections(A).await.unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].name, "A 的主机", "跨空间同 id 写入不能改到别人的行");
    assert_eq!(a[0].host, "10.0.0.1");

    let b = db.list_ssh_connections(B).await.unwrap();
    assert_eq!(b.len(), 1, "同 id 在 B 空间必须能独立存在");
    assert_eq!(b[0].name, "B 自己的主机");
    assert_eq!(b[0].host, "6.6.6.6");
}

#[tokio::test]
async fn same_id_in_two_spaces_writes_into_own_space_only() {
    let db = Database::open_in_memory().await.unwrap();

    // 凭据：V7 之前是裸 INSERT，撞全局主键直接 500
    db.insert_vault_entry(&vault_entry("same-v", "A 的密钥"), A)
        .await
        .unwrap();
    db.insert_vault_entry(&vault_entry("same-v", "B 的密钥"), B)
        .await
        .unwrap();
    assert_eq!(db.list_vault_entries(A).await.unwrap()[0].name_plain, "A 的密钥");
    assert_eq!(db.list_vault_entries(B).await.unwrap()[0].name_plain, "B 的密钥");

    // 通知渠道：V7 之前 upsert 的 ON CONFLICT(id) 没有空间守卫，B 会**覆盖** A 的行
    db.upsert_notification_channel(&channel("same-n", "A 的频道"), A)
        .await
        .unwrap();
    db.upsert_notification_channel(&channel("same-n", "B 的频道"), B)
        .await
        .unwrap();
    let a = db.list_notification_channels(A).await.unwrap();
    let b = db.list_notification_channels(B).await.unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].name, "A 的频道", "同 id 不得跨空间改写别人这一行");
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].name, "B 的频道");
}

#[tokio::test]
async fn vault_entries_are_isolated_between_spaces() {
    let db = Database::open_in_memory().await.unwrap();

    db.insert_vault_entry(&vault_entry("v1", "A 的密钥"), A).await.unwrap();
    db.insert_vault_entry(&vault_entry("v2", "B 的密钥"), B).await.unwrap();

    assert_eq!(db.list_vault_entries(A).await.unwrap().len(), 1);
    assert_eq!(db.list_vault_entries(B).await.unwrap().len(), 1);

    // 知道 id 也读不到 / 改不到 / 删不掉别人的凭据
    assert!(db.get_vault_entry("v2", A).await.unwrap().is_none());
    assert!(db.get_vault_entry("v1", B).await.unwrap().is_none());
    assert!(!db.delete_vault_entry("v1", B).await.unwrap());
    let mut hijack = vault_entry("v1", "被 B 改名");
    hijack.name_plain = "被 B 改名".into();
    assert!(!db.update_vault_entry(&hijack, B).await.unwrap());
    assert_eq!(db.get_vault_entry("v1", A).await.unwrap().unwrap().name_plain, "A 的密钥");
}

#[tokio::test]
async fn notifications_and_alerts_are_isolated() {
    let db = Database::open_in_memory().await.unwrap();

    db.upsert_notification_channel(&channel("n1", "A 的频道"), A)
        .await
        .unwrap();
    db.upsert_notification_channel(&channel("n2", "B 的频道"), B)
        .await
        .unwrap();

    assert_eq!(db.list_notification_channels(A).await.unwrap().len(), 1);
    assert_eq!(db.list_notification_channels(B).await.unwrap().len(), 1);
    assert!(!db.delete_notification_channel("n1", B).await.unwrap());
    assert_eq!(db.list_notification_channels(A).await.unwrap().len(), 1);

    db.insert_alert(&alert("al-1"), A).await.unwrap();
    assert_eq!(db.load_alerts(50, A).await.unwrap().len(), 1);
    assert!(db.load_alerts(50, B).await.unwrap().is_empty());
}

#[tokio::test]
async fn audit_logs_and_task_history_are_isolated() {
    let db = Database::open_in_memory().await.unwrap();

    db.insert_audit_log("2026-01-01T00:00:00Z", "ssh_exec", "{}", "1.1.1.1", A)
        .await
        .unwrap();
    db.insert_audit_log("2026-01-01T00:00:00Z", "ssh_exec", "{}", "2.2.2.2", B)
        .await
        .unwrap();

    let a_logs = db.load_recent_audit_logs(50, A).await.unwrap();
    assert_eq!(a_logs.len(), 1);
    assert_eq!(a_logs[0].ip, "1.1.1.1");
    let b_logs = db.load_recent_audit_logs(50, B).await.unwrap();
    assert_eq!(b_logs.len(), 1);
    assert_eq!(b_logs[0].ip, "2.2.2.2");

    let task_id = db.insert_scheduled_task(&task(), A).await.unwrap();
    assert!(db.get_scheduled_task(task_id, B).await.unwrap().is_none());
    assert!(db.get_scheduled_task(task_id, A).await.unwrap().is_some());
    assert!(!db.delete_scheduled_task(task_id, B).await.unwrap());
    assert!(!db.toggle_scheduled_task(task_id, B).await.unwrap());

    db.insert_task_execution(
        &TaskExecution {
            id: 0,
            task_id,
            status: "success".into(),
            output: Some("ok".into()),
            error_message: None,
            started_at: "2026-01-01T00:00:00Z".into(),
            finished_at: None,
        },
        A,
    )
    .await
    .unwrap();
    assert_eq!(db.list_task_history(task_id, 50, A).await.unwrap().len(), 1);
    assert!(db.list_task_history(task_id, 50, B).await.unwrap().is_empty());
}

#[tokio::test]
async fn table_counts_are_scoped_to_the_caller() {
    let db = Database::open_in_memory().await.unwrap();
    db.upsert_ssh_connection(&ssh_conn("c1", "A 的主机"), A).await.unwrap();

    let counts_a = db.list_table_counts(A).await.unwrap();
    let counts_b = db.list_table_counts(B).await.unwrap();
    let ssh_a = counts_a.iter().find(|(t, _)| t == "ssh_connections").map(|(_, c)| *c);
    let ssh_b = counts_b.iter().find(|(t, _)| t == "ssh_connections").map(|(_, c)| *c);
    assert_eq!(ssh_a, Some(1));
    assert_eq!(ssh_b, Some(0), "概览计数也不能泄露别人的行数");
}

#[tokio::test]
async fn orphan_rows_are_counted_and_adoptable() {
    let db = Database::open_in_memory().await.unwrap();

    // 模拟升级前的历史行：space_id = ''
    db.exec(|conn| {
        conn.execute(
            "INSERT INTO ssh_connections \
             (id, name, host, port, username, auth_type, config, sort_order, created_at, updated_at, space_id) \
             VALUES (?1, ?2, ?3, 22, ?4, 'password', '{}', 0, ?5, ?6, '')",
            params![
                "legacy-1",
                "老主机",
                // RFC 5737 文档用地址，避免把真实部署主机写进测试
                "198.51.100.9",
                "admin",
                "2025-01-01T00:00:00Z",
                "2025-01-01T00:00:00Z"
            ],
        )?;
        Ok(())
    })
    .await
    .unwrap();

    assert_eq!(db.count_orphan_rows().await.unwrap(), 1);
    assert!(db.list_ssh_connections(A).await.unwrap().is_empty());

    // 认领：历史行划归 A 空间
    let moved = db.adopt_legacy_rows(A).await.unwrap();
    assert_eq!(moved, 1);
    assert_eq!(db.list_ssh_connections(A).await.unwrap().len(), 1);
    assert_eq!(db.count_orphan_rows().await.unwrap(), 0);
    assert!(db.list_ssh_connections(B).await.unwrap().is_empty());
}

#[tokio::test]
async fn space_codes_are_stored_as_hashes() {
    let db = Database::open_in_memory().await.unwrap();
    let code = wrench_backend::space::generate_code();
    let hash = wrench_backend::space::hash_code(&code);

    db.create_space("s1", &hash, "2026-01-01T00:00:00Z").await.unwrap();

    // 明文永远不进库：只能按哈希反查
    assert!(db.find_space_by_id("s1").await.unwrap().unwrap().code_hash == hash);
    assert_eq!(db.find_space_by_code_hash(&hash).await.unwrap().unwrap().id, "s1");
    assert!(db.find_space_by_code_hash(&code).await.unwrap().is_none());
    assert_eq!(db.count_spaces().await.unwrap(), 1);

    // 轮换后旧哈希失效
    let new_hash = wrench_backend::space::hash_code(&wrench_backend::space::generate_code());
    db.set_space_code_hash("s1", &new_hash).await.unwrap();
    assert!(db.find_space_by_code_hash(&hash).await.unwrap().is_none());
    assert!(db.find_space_by_code_hash(&new_hash).await.unwrap().is_some());
}

/// 结构门禁：带客户端 id 的三张表必须以 `(space_id, id)` 为主键。
///
/// 只要有人把主键改回全局 `id`，跨空间就会重新出现「静默丢写 / 越权改写」，
/// 这条测试会立刻报红 —— 这类问题不该靠人眼审查。
#[tokio::test]
async fn space_scoped_tables_use_space_scoped_primary_keys() {
    let db = Database::open_in_memory().await.unwrap();

    let ddl: String = db
        .exec(|conn| {
            let mut all = String::new();
            for table in ["ssh_connections", "vault_entries", "notification_channels"] {
                let one: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )?;
                all.push_str(&one);
                all.push('\n');
            }
            Ok(all)
        })
        .await
        .unwrap();

    assert_eq!(
        ddl.matches("PRIMARY KEY (space_id, id)").count(),
        3,
        "三张表都必须是空间内唯一主键，实际 DDL：\n{ddl}"
    );
}
