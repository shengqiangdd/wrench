//! `api/connections.rs` — SSH 连接**元数据** API（只读 + 删除）
//!
//! 契约（重要，改这里前先读）：
//!
//! - **服务端不接收、不保存 SSH 凭据。** 这里没有写入端点：凭据要么留在浏览器本地
//!   （`secure-store` 加密后存 IndexedDB），要么进 Secret Vault（AES-256-GCM 加密，按空间隔离）。
//!   远程连接时凭据经 `/api/ssh/ensure`、`/ws` 一次性传给后端使用，**不落库**。
//! - `GET /api/connections` 返回的 `config` 会**递归剥离凭据字段**（见 [`redact_config`]），
//!   这样即使库里躺着历史遗留的明文记录（本接口曾经可以写入明文），也不会再被读出去。
//! - `DELETE /api/connections/{id}` 保留，用于清理这些历史记录；它不涉及任何凭据。
//!
//! 为什么砍掉写入口而不是「校验字段」：黑名单永远可能漏（`key`、`identity`、自定义字段名……），
//! 而「服务端根本没有存凭据的入口」是结构性保证，不依赖字段命名。

use crate::app_state::AppState;
use crate::db::SshConnection;
use crate::error::AppError;
use crate::response::ApiResponse;
use crate::space::SpaceCtx;
use axum::{
    Extension, Json,
    extract::{Path, State},
};
use serde::Serialize;
use std::sync::Arc;

/// 凭据类键名的后缀（比对前会去掉非字母数字字符并转小写）。
///
/// 覆盖 `password` / `sudo_password` / `sudoPassword` / `passwd` / `passphrase` /
/// `private_key` / `privateKey` / `client_secret` / `api_token` / `apiKey` 等写法。
const SECRET_KEY_SUFFIXES: [&str; 7] = [
    "password",
    "passwd",
    "passphrase",
    "privatekey",
    "secret",
    "token",
    "apikey",
];

/// 键名是否属于凭据类。
fn is_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    !normalized.is_empty() && SECRET_KEY_SUFFIXES.iter().any(|s| normalized.ends_with(s))
}

/// 递归剥离 JSON 里的凭据字段；返回是否确实剥掉了什么。
fn redact_value(value: &mut serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            let mut stripped = false;
            for key in keys {
                if is_secret_key(&key) {
                    map.remove(&key);
                    stripped = true;
                } else if let Some(child) = map.get_mut(&key) {
                    stripped |= redact_value(child);
                }
            }
            stripped
        }
        serde_json::Value::Array(items) => {
            let mut stripped = false;
            for item in items.iter_mut() {
                stripped |= redact_value(item);
            }
            stripped
        }
        _ => false,
    }
}

/// 把存储中的 `config` 转成**可安全返回给客户端**的形式。
///
/// 非法 JSON / 空值一律回退为 `{}`（宁可丢信息也不放行未知内容）。
pub fn redact_config(config: &str) -> String {
    let trimmed = config.trim();
    if trimmed.is_empty() {
        return "{}".to_string();
    }
    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(mut value) => {
            // config 的约定形态是 JSON 对象；其它形态一律丢弃（不给未知内容放行的机会）
            if !value.is_object() {
                return "{}".to_string();
            }
            redact_value(&mut value);
            value.to_string()
        }
        Err(_) => "{}".to_string(),
    }
}

/// JSON response body for a connection.
#[derive(Debug, Serialize)]
pub struct ConnectionResponse {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    /// 已脱敏：任何凭据字段都不会出现在这里
    pub config: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

impl From<SshConnection> for ConnectionResponse {
    fn from(c: SshConnection) -> Self {
        Self {
            id: c.id,
            name: c.name,
            host: c.host,
            port: c.port,
            username: c.username,
            auth_type: c.auth_type,
            config: redact_config(&c.config),
            sort_order: c.sort_order,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// GET /api/connections — list all saved connections (凭据已脱敏)
pub async fn list_connections(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> Result<Json<ApiResponse<Vec<ConnectionResponse>>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let conns = db
        .list_ssh_connections(&space.id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let resp: Vec<ConnectionResponse> = conns.into_iter().map(Into::into).collect();
    Ok(Json(ApiResponse::success(resp)))
}

/// DELETE /api/connections/:id — delete a connection (含历史遗留的明文记录)
pub async fn delete_connection(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Path(connection_id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let deleted = db
        .delete_ssh_connection(&connection_id, &space.id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !deleted {
        return Err(AppError::NotFound("Connection not found".into()));
    }
    Ok(Json(ApiResponse::success(true)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn redact(raw: &str) -> String {
        redact_config(raw)
    }

    #[test]
    fn strips_plaintext_credentials_flat() {
        let out = redact(r#"{"password":"hunter2","private_key":"-----BEGIN","sudo_password":"s"}"#);
        assert!(!out.contains("hunter2"));
        assert!(!out.contains("BEGIN"));
        assert_eq!(out, "{}");
    }

    #[test]
    fn strips_credentials_whatever_the_naming_style() {
        for key in [
            "password",
            "passwd",
            "passphrase",
            "privateKey",
            "private_key",
            "sudoPassword",
            "client_secret",
            "api_token",
            "apiKey",
        ] {
            let raw = format!(r#"{{"{key}":"x"}}"#);
            assert_eq!(redact(&raw), "{}", "键 {key} 未被剥离");
        }
    }

    #[test]
    fn strips_nested_and_array_credentials() {
        let out = redact(r#"{"proxy":{"password":"deep"},"keys":[{"privateKey":"k"}]}"#);
        assert!(!out.contains("deep"), "{out}");
        assert!(!out.contains("\"k\""), "{out}");
    }

    #[test]
    fn keeps_non_secret_fields() {
        let out = redact(r#"{"vault_entry_id":"v-1","sudo":true,"port":2222}"#);
        assert!(out.contains("v-1"), "{out}");
        assert!(out.contains("2222"), "{out}");
        assert!(out.contains("sudo"), "{out}");
    }

    #[test]
    fn invalid_or_empty_config_falls_back_to_empty_object() {
        assert_eq!(redact(""), "{}");
        assert_eq!(redact("   "), "{}");
        assert_eq!(redact("not json at all"), "{}");
        // 非对象形态（裸字符串/数组/数字）一律丢弃，避免把「整段就是口令」的值原样放出去
        assert_eq!(redact("\"hunter2\""), "{}");
        assert_eq!(redact("[1,2,3]"), "{}");
        assert_eq!(redact("42"), "{}");
    }

    #[test]
    fn response_never_exposes_credentials() {
        let conn = SshConnection {
            id: "c-1".into(),
            name: "prod".into(),
            host: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_type: "password".into(),
            config: r#"{"password":"hunter2","vault_entry_id":"v-1"}"#.into(),
            sort_order: 0,
            created_at: "2026-01-01T00:00:00+08:00".into(),
            updated_at: "2026-01-01T00:00:00+08:00".into(),
            space_id: "s-1".into(),
        };
        let resp = ConnectionResponse::from(conn);
        assert!(!resp.config.contains("hunter2"));
        assert!(resp.config.contains("v-1"));
    }
}
