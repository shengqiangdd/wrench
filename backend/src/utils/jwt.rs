use axum::http::StatusCode;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, TokenData, Validation};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Default token lifetime: 24 hours
pub const DEFAULT_JWT_EXPIRY_SECS: u64 = 86400;

// ── Scope 定义 ──
//
// 令牌按能力划分 scope，中间件按路由校验（REST 需 `api`，`/ws` 需 `ws`）：
// * 会话令牌：登录后签发，scope=`api+ws`，长有效期
// * WS 令牌：受保护接口签发，scope=`ws`，短有效期，降低 URL 查询串泄露的影响

/// 仅 REST API
pub const SCOPE_API: &str = "api";
/// 仅 WebSocket
pub const SCOPE_WS: &str = "ws";
/// 会话令牌：REST + WebSocket
pub const SCOPE_API_WS: &str = "api+ws";

/// 会话令牌有效期：7 天（未勾选「记住此设备」）
pub const SESSION_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// 勾选「记住此设备」后的会话有效期：30 天
pub const SESSION_TTL_REMEMBER_SECS: u64 = 30 * 24 * 60 * 60;
/// WS 令牌有效期：10 分钟
pub const WS_TOKEN_TTL_SECS: u64 = 10 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iat: u64,
    pub exp: u64,
    pub scope: String,
    /// 门户口令版本（token version）：与服务器当前值不一致即失效。
    ///
    /// 用 `Option` 而不是裸 `u32`，是为了让**没有该字段的旧令牌一律被拒**：
    /// 升级到多人共用版本后，所有人需要重新登录一次（空间数据不受影响）。
    #[serde(default)]
    pub tv: Option<u32>,
}

impl Claims {
    pub fn new(subject: String, scope: impl Into<String>, expires_in: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_secs();
        Self { sub: subject, iat: now, exp: now + expires_in, scope: scope.into(), tv: None }
    }

    /// 登录会话令牌：scope=`api+ws`，绑定当前门户口令版本。
    ///
    /// `remember` 为真时有效期 30 天（「记住此设备」），否则 7 天。
    pub fn session(token_version: u32, remember: bool) -> Self {
        let ttl = if remember {
            SESSION_TTL_REMEMBER_SECS
        } else {
            SESSION_TTL_SECS
        };
        let mut claims = Self::new("visitor".into(), SCOPE_API_WS, ttl);
        claims.tv = Some(token_version);
        claims
    }

    /// 短时 WebSocket 令牌：scope=`ws`，10 分钟，绑定当前门户口令版本。
    pub fn ws_token(token_version: u32) -> Self {
        let mut claims = Self::new("visitor".into(), SCOPE_WS, WS_TOKEN_TTL_SECS);
        claims.tv = Some(token_version);
        claims
    }

    /// 是否具备指定能力（scope 以 `+` 分隔，如 `api+ws`）。
    pub fn has_scope(&self, required: &str) -> bool {
        self.scope.split('+').any(|s| s.trim().eq_ignore_ascii_case(required))
    }
}

pub struct JwtService {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    validation: Validation,
}

impl JwtService {
    pub fn from_secret(secret: &str) -> anyhow::Result<Self> {
        Ok(Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            validation: Validation::new(Algorithm::HS256),
        })
    }

    pub fn sign(&self, claims: &Claims) -> Result<String, StatusCode> {
        jsonwebtoken::encode(&Header::default(), claims, &self.encoding_key)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    }

    pub fn verify(&self, token: &str) -> Result<TokenData<Claims>, StatusCode> {
        jsonwebtoken::decode::<Claims>(token, &self.decoding_key, &self.validation)
            .map_err(|_| StatusCode::UNAUTHORIZED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_and_ws_token_scopes() {
        let session = Claims::session(3, false);
        assert!(session.has_scope(SCOPE_API));
        assert!(session.has_scope(SCOPE_WS));
        assert_eq!(session.exp - session.iat, SESSION_TTL_SECS);
        assert_eq!(session.tv, Some(3));

        let remembered = Claims::session(3, true);
        assert_eq!(remembered.exp - remembered.iat, SESSION_TTL_REMEMBER_SECS);

        let ws = Claims::ws_token(3);
        assert!(ws.has_scope(SCOPE_WS));
        assert!(!ws.has_scope(SCOPE_API));
        assert_eq!(ws.exp - ws.iat, WS_TOKEN_TTL_SECS);
        assert_eq!(ws.tv, session.tv);
    }

    #[test]
    fn test_claims_without_token_version_are_rejected_by_deserialization_default() {
        // 旧令牌（无 tv 字段）反序列化后 tv 必须为 None，中间件据此拒绝
        let legacy = r#"{"sub":"owner","iat":1,"exp":99999999999,"scope":"api+ws"}"#;
        let claims: Claims = serde_json::from_str(legacy).unwrap();
        assert_eq!(claims.tv, None);
    }

    #[test]
    fn test_has_scope_parsing() {
        let claims = Claims::new("s".into(), "api+ws", 60);
        assert!(claims.has_scope("api"));
        assert!(claims.has_scope("WS"), "scope 比较不区分大小写");
        assert!(!claims.has_scope("admin"));

        let api_only = Claims::new("s".into(), "api", 60);
        assert!(api_only.has_scope("api"));
        assert!(!api_only.has_scope("ws"));
    }
}
