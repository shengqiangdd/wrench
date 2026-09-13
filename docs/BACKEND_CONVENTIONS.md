# BACKEND_CONVENTIONS.md — Rust 后端开发规范

> 本文档规定 Wrench Rust 后端的代码风格、模式与约束。**必须遵循**，违反将导致 CI 失败。

---

## 1. Axum Handler 标准模板

### 1.1 REST API Handler 模板

```rust
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

// 1. 定义请求体（可选）
#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    pub name: String,
    pub host: String,
    #[serde(alias = "connectionId")]
    pub connection_id: String,
}

// 2. 定义查询参数（可选）
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

// 3. Handler 函数签名
pub async fn handler_name(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,           // 路径参数（如 /api/resource/{id}）
    Query(query): Query<ListQuery>,    // 查询参数（如 ?limit=10）
    Json(payload): Json<CreateRequest>, // 请求体（POST/PUT）
) -> ApiResponse<serde_json::Value> {
    // 4. 业务逻辑前置校验（返回前置错误）
    if id.is_empty() {
        return ApiResponse::error(400, "Resource ID is required");
    }

    // 5. 主逻辑（必须返回 Result，不可 unwrap/expect）
    match do_something(&state, &id, &payload).await {
        Ok(result) => ApiResponse::success(result),
        Err(e) => ApiResponse::error(500, &e.to_string()),
    }
}

// 6. 内部辅助函数（隔离业务逻辑）
async fn do_something(
    state: &Arc<AppState>,
    id: &str,
    payload: &CreateRequest,
) -> anyhow::Result<serde_json::Value> {
    // ... 业务实现，返回 Result
    Ok(serde_json::json!({ "id": id }))
}
```

### 1.2 WebSocket Handler 模板

```rust
use axum::{
    extract::{ws::{Message, WebSocket, WebSocketUpgrade}, State},
    response::IntoResponse,
};
use std::sync::Arc;

use crate::app_state::AppState;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(req) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = req.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    match msg_type {
                        "ping" => {
                            let _ = socket
                                .send(Message::Text(axum::extract::ws::Utf8Bytes::from(
                                    serde_json::json!({"type": "pong"}).to_string()
                                )))
                                .await;
                        }
                        // 其他消息类型处理...
                        _ => {}
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => continue,
        }
    }
}
```

---

## 2. 异步编程注意事项

### 2.1 禁止阻塞调用

**❌ 错误做法：**
```rust
pub async fn bad_handler(State(state): State<Arc<AppState>>) -> ApiResponse<String> {
    let conn = state.db.as_ref().unwrap().conn.lock().unwrap(); // ❌ 阻塞 lock
    conn.execute("INSERT INTO ...", []).unwrap(); // ❌ 阻塞 I/O
    ApiResponse::success("ok".into())
}
```

**✅ 正确做法：**
```rust
pub async fn good_handler(State(state): State<Arc<AppState>>) -> ApiResponse<String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        let conn = db.as_ref().ok_or("DB not configured")?.conn.blocking_lock();
        conn.execute("INSERT INTO ...", params_from_iter(&[]).unwrap())?;
        Ok::<_, anyhow::Error>(())
    })
    .await
    .map_err(|e| format!("DB error: {}", e))?
    .map_err(|e| e.to_string())?;
    ApiResponse::success("ok".into())
}
```

### 2.2 CPU 密集型任务处理

```rust
// 加密、编码、大文件解析等阻塞任务
use tokio::task::spawn_blocking;

pub async fn encrypt_large_data(data: Vec<u8>, key: String) -> Result<String, anyhow::Error> {
    let result = spawn_blocking(move || {
        // 这里是阻塞的加密操作
        crate::utils::crypto::encrypt_sync(&data, &key)
    })
    .await??;
    Ok(result)
}
```

### 2.3 SSH/SFTP 异步模式

```rust
// russh 提供原生 async，SFTP 缓存复用
impl SshSession {
    pub async fn exec(&self, command: &str) -> Result<(String, String, u32), Box<dyn std::error::Error + Send + Sync>> {
        let session = self.handle.lock().await;
        let mut channel = session.channel_open_session().await?;
        channel.exec(command).await?;
        // ... 异步读取 stdout/stderr
        self.touch(); // 更新 last_used 防止被清理
    }

    pub async fn get_sftp_session(&self) -> Result<Arc<SftpSession>, Box<dyn std::error::Error + Send + Sync>> {
        let mut cache = self.sftp_cache.lock().await;
        if let Some(ref sftp) = *cache {
            return Ok(sftp.clone());
        }
        let session = self.handle.lock().await;
        let sftp = session.subsystem_open("sftp").await?;
        *cache = Some(Arc::new(sftp));
        Ok(cache.as_ref().unwrap().clone())
    }
}
```

---

## 3. rusqlite 数据库操作规范

### 3.1 连接与初始化

```rust
// db/mod.rs
impl Database {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        let conn = tokio::task::spawn_blocking(move || {
            let c = rusqlite::Connection::open(path)?;
            c.execute_batch(
                "PRAGMA journal_mode=WAL;
                 PRAGMA busy_timeout=5000;
                 PRAGMA foreign_keys=ON;"
            )?;
            Ok::<_, anyhow::Error>(c)
        })
        .await??;
        Ok(Self { conn: Arc::new(Mutex::new(conn)) })
    }
}
```

### 3.2 查询（读操作）

```rust
// 读操作：spawn_blocking + 立即释放锁；空间过滤写进 SQL，不做「查完再筛」
impl Database {
    pub async fn load_recent_audit_logs(&self, limit: usize, space_id: &str) -> anyhow::Result<Vec<AuditEntry>> {
        let conn = self.clone();
        let space = space_id.to_string();
        tokio::task::spawn_blocking(move || {
            let mut stmt = conn.lock().unwrap()
                .prepare("SELECT * FROM audit_logs WHERE space_id = ?1 ORDER BY timestamp DESC LIMIT ?2")?;
            let rows = stmt
                .query_map(params![space, limit as i32], |row| {
                    Ok(AuditEntry { /* ... */ })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(rows)
        })
        .await??
    }
}
```

### 3.3 插入（写操作）

```rust
// 写操作：spawn_blocking，失败不阻塞主流程；space_id 随写一起落库
impl AppState {
    pub fn add_audit_log(&self, action: &str, detail: serde_json::Value, ip: &str, space_id: &str) {
        let ts = chrono::Utc::now();
        let entry = AuditEntry { /* ... */ };
        self.audit_logs.write().push(entry.clone()); // 内存双写

        // 异步写 DB，失败只记 warn
        if let Some(ref db) = self.db {
            let db = db.clone();
            let ts = ts.to_rfc3339();
            let action = action.to_string();
            let detail = detail.clone();
            let ip = ip.to_string();
            let space = space_id.to_string();
            tokio::spawn(async move {
                if let Err(e) = db.insert_audit_log(&ts, &action, &detail, &ip, &space).await {
                    tracing::warn!("Audit log DB write failed: {}", e);
                }
            });
        }
    }
}
```

### 3.4 迁移模式

```rust
// user_version 迁移（每个版本一个 SCHEMA_Vn）
async fn migrate(&self) -> anyhow::Result<()> {
    self.exec(move |conn| {
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or(0);

        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.pragma_update(None, "user_version", 1)?;
        }
        // V2, V3... 继续
        Ok(())
    })
    .await
}
```

### 3.5 多租户（空间隔离）硬规则 —— **违反即事故**

Wrench 是多人在同一个实例上共用、彼此不可见（无角色体系）。隔离**只靠 SQL 层**，没有任何兜底：

1. **所有业务表的读写方法签名必须带 `space_id`**（`&str`），并在 SQL 里过滤/写入该值：
   ```rust
   // ✅ 对：签名强制 + SQL 过滤
   pub async fn list_vault_entries(&self, space_id: &str) -> ...
       // "SELECT * FROM vault_entries WHERE space_id = ?1 ..."

   // ❌ 错：漏了 space_id —— 等于把所有人的数据混在一起
   pub async fn list_vault_entries(&self) -> ...
   ```
2. **不允许「查完再在内存里筛 `space_id`」** —— 过滤条件必须出现在 SQL（`WHERE` / `ON CONFLICT`），
   否则一旦有分页/`LIMIT` 就是跨空间泄露。
3. **写入用 `ON CONFLICT ... WHERE space_id = excluded.space_id`**，防止跨空间同名 id 覆盖别人的行。
4. **新增业务表必须**：加 `space_id TEXT NOT NULL DEFAULT ''`、加复合索引 `(space_id, id)`、
   把表名登记进 `db::SPACE_SCOPED_TABLES`（`/api/space/me` 的计数与认领逻辑依赖它）。
5. 内存态（`AppState` 里的 `DashMap` 等）**没有**空间隔离，凡是按连接/任务缓存的东西都要自己带
   `space_id` 判断；不确定就不要放进全局缓存。
6. 交付前必须跑 `cargo test --all-targets`（含 `tests/space_isolation_test.rs` 的跨空间回归）。

---

## 4. 常见误区禁止

| 误区 | 正确方式 |
|------|----------|
| `unwrap()` 处理数据库查询结果 | `map_err` 转换成 `ApiResponse::error` |
| `std::fs::File` 在 async 函数 | `tokio::fs` 或 `spawn_blocking` |
| 硬编码 `"/api/xxx"` 字符串 | 用常量模块或 `config.rs` 环境变量 |
| `Vec<>` 替代 `DashMap` 做共享状态 | 保持现有 `AppState` 结构 |
| 手动 `format!("rm -rf {}", path)` | `format!("rm -rf {}", escape_sh_arg(path))` |
| db 方法少一个 `space_id` 参数 | 见 §3.5：签名必须带 `space_id`，漏传即编译失败 |

---

> **记住**：“先让它编译”，然后“让它编译**安全**”。每一个 `?` 必须有对应的 `map_err` 或 `ok_or_else`。每一个阻塞调用必须 `spawn_blocking`。