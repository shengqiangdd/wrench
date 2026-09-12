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

/// 会话令牌有效期：7 天
pub const SESSION_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// WS 令牌有效期：10 分钟
pub const WS_TOKEN_TTL_SECS: u64 = 10 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iat: u64,
    pub exp: u64,
    pub scope: String,
    /// 口令指纹：绑定签发时的登录口令，服务端每次校验时用当前口令重算比对。
    /// 因此修改口令 = 所有旧令牌立即失效（相当于全局登出）。
    #[serde(default)]
    pub pwd_fp: String,
}

/// 口令指纹：`HMAC-SHA256(JWT_SECRET, 口令)` 的前 16 个十六进制字符。
///
/// 使用 HMAC（而非明文哈希）以避免令牌泄露后被离线暴力破解口令；
/// 截断到 64 bit 足够做“是否同一口令”的判定。
pub fn password_fingerprint(jwt_secret: &str, password: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let mut mac =
        Hmac::<Sha256>::new_from_slice(jwt_secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(password.as_bytes());
    mac.finalize()
        .into_bytes()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

impl Claims {
    pub fn new(subject: String, scope: impl Into<String>, expires_in: u64) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("Time went backwards")
            .as_secs();
        Self {
            sub: subject,
            iat: now,
            exp: now + expires_in,
            scope: scope.into(),
            pwd_fp: String::new(),
        }
    }

    /// 登录会话令牌：scope=`api+ws`，7 天，绑定当前登录口令。
    pub fn session(jwt_secret: &str, password: &str) -> Self {
        let mut claims = Self::new("owner".into(), SCOPE_API_WS, SESSION_TTL_SECS);
        claims.pwd_fp = password_fingerprint(jwt_secret, password);
        claims
    }

    /// 短时 WebSocket 令牌：scope=`ws`，10 分钟，绑定当前登录口令。
    pub fn ws_token(jwt_secret: &str, password: &str) -> Self {
        let mut claims = Self::new("owner".into(), SCOPE_WS, WS_TOKEN_TTL_SECS);
        claims.pwd_fp = password_fingerprint(jwt_secret, password);
        claims
    }

    /// 是否具备指定能力（scope 以 `+` 分隔，如 `api+ws`）。
    pub fn has_scope(&self, required: &str) -> bool {
        self.scope
            .split('+')
            .any(|s| s.trim().eq_ignore_ascii_case(required))
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
    fn test_password_fingerprint_is_keyed_and_stable() {
        let a = password_fingerprint("secret-a", "pw");
        let b = password_fingerprint("secret-a", "pw");
        let c = password_fingerprint("secret-b", "pw");
        let d = password_fingerprint("secret-a", "pw2");

        assert_eq!(a, b, "同一密钥+口令应得到相同指纹");
        assert_ne!(a, c, "不同密钥不应得到相同指纹");
        assert_ne!(a, d, "不同口令不应得到相同指纹");
        assert_eq!(a.len(), 16, "指纹为 8 字节十六进制");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_session_and_ws_token_scopes() {
        let session = Claims::session("sec", "pw");
        assert!(session.has_scope(SCOPE_API));
        assert!(session.has_scope(SCOPE_WS));
        assert_eq!(session.exp - session.iat, SESSION_TTL_SECS);

        let ws = Claims::ws_token("sec", "pw");
        assert!(ws.has_scope(SCOPE_WS));
        assert!(!ws.has_scope(SCOPE_API));
        assert_eq!(ws.exp - ws.iat, WS_TOKEN_TTL_SECS);
        assert_eq!(ws.pwd_fp, session.pwd_fp);
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
