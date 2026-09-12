//! 访问者空间（per-visitor space）—— 无角色的多人共用隔离原语。
//!
//! # 模型
//!
//! * **门（door）**：一个共享入口口令，唯一作用是防止公网上任何人把实例当 SSH 跳板。
//!   口令哈希存在数据库 `app_settings`（legacy 部署也可由环境变量提供）。
//! * **空间（space）**：每个浏览器第一次带着有效门令牌访问时，自动得到一个**自己的**
//!   空间；7 张业务表都带 `space_id`，SQL 层强制过滤，所以谁也看不到别人的数据。
//! * **空间码**：256-bit 随机值（64 位十六进制）。服务端**只存 SHA-256**，明文只在创建
//!   那一刻返回一次，由访问者浏览器保存 —— 因此连部署者也无法进入别人的空间，
//!   数据库被完整拖走也不足以进入任何空间。
//!
//! 空间码的用途是「换设备 / 恢复」：新设备登录后点「用空间码进入」粘贴即可。
//! 日常访问走 HttpOnly cookie，访客无需记住任何东西。

use std::sync::Arc;

use axum::http::{HeaderMap, header};
use sha2::{Digest, Sha256};

use crate::app_state::AppState;
use crate::db::Space;

/// 空间 cookie 名（HttpOnly，由服务端下发）。
pub const SPACE_COOKIE: &str = "wrench_space";
/// 换设备 / 恢复空间时使用的请求头。
pub const SPACE_HEADER: &str = "x-space-code";
/// 空间总数上限：防止被刷出无限空间（每个空间只占一行，但仍要设边界）。
pub const MAX_SPACES: i64 = 10_000;
/// 空间码熵：32 字节 = 256 bit。
const SPACE_CODE_BYTES: usize = 32;
/// 空间码字符数（十六进制）。
pub const SPACE_CODE_LEN: usize = SPACE_CODE_BYTES * 2;
/// 遗留数据认领码在启动日志里打印的最大次数（认领后不再打印）。
pub const LEGACY_SPACE_ID: &str = "legacy";
/// `last_seen_at` 的最小写入间隔：热路径只读，避免每个请求都写库。
const TOUCH_INTERVAL_SECS: i64 = 3600;

/// 注入到请求 `extensions` 的空间上下文（handler 用 `Extension<SpaceCtx>` 取）。
#[derive(Clone, Debug)]
pub struct SpaceCtx {
    pub id: String,
}

impl SpaceCtx {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }

    /// 是否为「历史数据认领空间」（V6 升级时自动建立，用于接管升级前的数据）。
    pub fn is_legacy(&self) -> bool {
        self.id == LEGACY_SPACE_ID
    }
}

/// 解析结果。
pub enum SpaceOutcome {
    /// 命中已有空间。
    Existing(Space),
    /// 新建空间（附明文空间码 —— 只会返回这一次）。
    Created(Space, String),
    /// 客户端带了空间码，但服务端不认识（拼错 / 已被轮换）。
    InvalidCode,
    /// 服务端未启用数据库（fail-closed）。
    Unavailable,
}

/// 生成一个新的空间码（256 bit，十六进制小写）。
pub fn generate_code() -> String {
    use rand::TryRng;
    let mut buf = [0u8; SPACE_CODE_BYTES];
    let mut rng = rand::rngs::SysRng;
    // SysRng 是系统熵源，失败即 panic（与 config.rs 生成口令的策略一致）
    rng.try_fill_bytes(&mut buf).expect("system RNG unavailable");
    hex(&buf)
}

/// 空间码 → 存储用哈希（SHA-256 十六进制）。
///
/// 空间码本身就是 256-bit 随机值，不需要慢哈希；SHA-256 足够且便于索引。
pub fn hash_code(code: &str) -> String {
    hex(&Sha256::digest(code.as_bytes()))
}

/// 规范化用户输入的空间码：去掉空白/连字符/冒号并转小写。
///
/// 返回 `None` 表示长度或字符集不合法（避免拿任意字符串去打数据库）。
pub fn normalize_code(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != ':' && *c != '_')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if cleaned.len() != SPACE_CODE_LEN || !cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(cleaned)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// 从请求头里取出空间码：`X-Space-Code` 优先于 cookie。
pub fn code_from_headers(headers: &HeaderMap) -> Option<String> {
    if let Some(raw) = headers.get(SPACE_HEADER).and_then(|v| v.to_str().ok())
        && let Some(code) = normalize_code(raw)
    {
        return Some(code);
    }
    let jar = headers.get_all(header::COOKIE);
    for value in jar.iter() {
        let Ok(text) = value.to_str() else { continue };
        for pair in text.split(';') {
            let mut it = pair.splitn(2, '=');
            let (Some(k), Some(v)) = (it.next(), it.next()) else {
                continue;
            };
            if k.trim() == SPACE_COOKIE
                && let Some(code) = normalize_code(v)
            {
                return Some(code);
            }
        }
    }
    None
}

/// 解析（必要时创建）当前请求所属的空间。
///
/// * 带了空间码且命中 → `Existing`
/// * 带了空间码但不存在 → `InvalidCode`（**不静默新建**，否则拼错会悄悄换空间）
/// * 没有空间码 → 新建（仅限已通过门认证的请求；未认证的调用方不会被调用到）
pub async fn resolve_or_create(state: &Arc<AppState>, headers: &HeaderMap) -> SpaceOutcome {
    let Some(db) = state.db.as_ref() else {
        return SpaceOutcome::Unavailable;
    };

    if let Some(code) = code_from_headers(headers) {
        match db.find_space_by_code_hash(&hash_code(&code)).await {
            Ok(Some(space)) => {
                maybe_touch(db, &space).await;
                return SpaceOutcome::Existing(space);
            }
            Ok(None) => return SpaceOutcome::InvalidCode,
            Err(err) => {
                tracing::error!("[space] lookup failed: {err}");
                return SpaceOutcome::Unavailable;
            }
        }
    }

    create_space(state).await
}

/// 解析**已存在**的空间（不创建）——用于登录等门外的审计归属。
pub async fn resolve_existing(state: &Arc<AppState>, headers: &HeaderMap) -> Option<Space> {
    let db = state.db.as_ref()?;
    let code = code_from_headers(headers)?;
    db.find_space_by_code_hash(&hash_code(&code)).await.ok().flatten()
}

/// 新建一个空间。
pub async fn create_space(state: &Arc<AppState>) -> SpaceOutcome {
    let Some(db) = state.db.as_ref() else {
        return SpaceOutcome::Unavailable;
    };

    match db.count_spaces().await {
        Ok(n) if n >= MAX_SPACES => {
            tracing::error!("[space] refused to create space: limit {MAX_SPACES} reached ({n} existing)");
            return SpaceOutcome::Unavailable;
        }
        Ok(_) => {}
        Err(err) => {
            tracing::error!("[space] count_spaces failed: {err}");
            return SpaceOutcome::Unavailable;
        }
    }

    let code = generate_code();
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_string();
    if let Err(err) = db.create_space(&id, &hash_code(&code), &now).await {
        tracing::error!("[space] create failed: {err}");
        return SpaceOutcome::Unavailable;
    }

    tracing::info!("[space] created space id={id}");
    SpaceOutcome::Created(
        Space {
            id,
            code_hash: hash_code(&code),
            created_at: now.clone(),
            last_seen_at: now,
            claimed: false,
        },
        code,
    )
}

/// 把请求绑定到指定空间码（换设备）：校验通过则返回该空间。
pub async fn attach(state: &Arc<AppState>, raw_code: &str) -> Result<Space, &'static str> {
    let Some(code) = normalize_code(raw_code) else {
        return Err("空间码格式不正确（应为 64 位十六进制字符）");
    };
    let Some(db) = state.db.as_ref() else {
        return Err("服务端未启用数据库");
    };
    match db.find_space_by_code_hash(&hash_code(&code)).await {
        Ok(Some(space)) => Ok(space),
        Ok(None) => Err("空间码无效或已失效"),
        Err(err) => {
            tracing::error!("[space] attach lookup failed: {err}");
            Err("服务端数据库错误")
        }
    }
}

/// 轮换空间码：新码返回给调用方一次，旧码立即失效（cookie 也随之失效）。
pub async fn rotate(state: &Arc<AppState>, space_id: &str) -> anyhow::Result<String> {
    let Some(db) = state.db.as_ref() else {
        anyhow::bail!("no database");
    };
    let code = generate_code();
    db.set_space_code_hash(space_id, &hash_code(&code)).await?;
    tracing::info!("[space] rotated code for space id={space_id}");
    Ok(code)
}

/// 更新 `last_seen_at`（最多每小时写一次，避免把读热路径变成写热路径）。
async fn maybe_touch(db: &crate::db::Database, space: &Space) {
    let now = chrono::Utc::now();
    let stale = chrono::DateTime::parse_from_rfc3339(&space.last_seen_at)
        .map(|t| (now - t.with_timezone(&chrono::Utc)).num_seconds() > TOUCH_INTERVAL_SECS)
        .unwrap_or(true);
    if stale {
        let _ = db.touch_space(&space.id, &now.to_rfc3339()).await;
    }
}

fn now_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// 生成 `Set-Cookie` 头值。
///
/// `secure` 由调用方按请求实际协议决定（HTTPS 后才加 `Secure`，否则纯 HTTP 下
/// 浏览器会丢弃 cookie，导致每次请求都新建空间）。
pub fn cookie_header_value(code: &str, secure: bool) -> String {
    // 一年有效期；HttpOnly 保证 JS 读不到（XSS 也拿不到空间码）
    let mut v = format!("{SPACE_COOKIE}={code}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax");
    if secure {
        v.push_str("; Secure");
    }
    v
}
