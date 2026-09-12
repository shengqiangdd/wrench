use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::utils::jwt::{Claims, SCOPE_API, SCOPE_WS};

/// 路径所需能力：`/ws*` 需要 `ws`，其余 REST 接口需要 `api`。
fn required_scope(uri: &str) -> &'static str {
    if uri.starts_with("/ws") {
        SCOPE_WS
    } else {
        SCOPE_API
    }
}

fn json_error(status: StatusCode, message: &str) -> Response {
    // 与 ApiResponse 的错误结构保持一致，便于前端统一解析
    let body = serde_json::json!({
        "success": false,
        "code": status.as_u16(),
        "msg": message,
        "error": message,
        "data": serde_json::Value::Null,
    })
    .to_string();
    Response::builder()
        .status(status)
        .header(axum::http::header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

/// 校验令牌中的口令指纹是否与服务端**当前**口令一致。
///
/// 用于实现“改口令 = 全局登出”：修改 `WRENCH_AUTH_PASSWORD` 后，
/// 所有旧令牌立即失效，无需额外维护吊销列表。
fn fingerprint_matches(state: &Arc<AppState>, claims: &Claims) -> bool {
    match state.config.auth_password.as_deref() {
        // 未配置口令时由调用方提前返回 503（fail-closed），这里保守判否
        None => false,
        Some(password) => {
            claims.pwd_fp == crate::utils::jwt::password_fingerprint(&state.config.jwt_secret, password)
        }
    }
}

/// Validate a token against the in-memory WS token store.
///
/// Returns `true` if the token is valid (exists and not expired).
/// Consumes the token (one-time use).
fn validate_token(state: &Arc<AppState>, token: &str) -> bool {
    // Check validity in a block so the Ref (read-lock) is dropped before remove
    // to avoid DashMap read→write deadlock on the same shard.
    let is_valid = {
        let entry = state.ws_tokens.get(token);
        match entry {
            Some(info) => info.expires_at >= chrono::Utc::now(),
            None => false,
        }
    };

    if is_valid {
        state.ws_tokens.remove(token);
        true
    } else {
        false
    }
}

/// Validate a JWT token using the app's JWT service.
///
/// Returns the decoded [`Claims`] when the signature and expiration are valid.
fn validate_jwt(state: &Arc<AppState>, token: &str) -> Option<Claims> {
    let service = state.jwt_service.read();
    let service = service.as_ref()?;

    match service.verify(token) {
        Ok(token_data) => {
            let now = chrono::Utc::now().timestamp() as u64;
            if token_data.claims.exp > now {
                Some(token_data.claims)
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

/// Authentication middleware for REST API and WebSocket routes.
///
/// 两种认证方式：
/// 1. 会话 JWT（`Authorization: Bearer <token>`，或 WS 升级时的 `?token=`），按路由校验 scope
///    —— REST 接口需 `api`，`/ws*` 需 `ws`；登录会话的 scope 为 `api+ws`
/// 2. 遗留一次性 WS token（仅 `/ws*` 路径可用，校验成功后即失效）
///
/// 服务端未配置登录密码（`WRENCH_AUTH_PASSWORD`）时**拒绝一切受保护请求**（fail-closed）。
/// 无需认证的路由（`/api/health`、`/api/auth/login`、静态资源）挂在本中间件之外。
pub async fn auth_middleware(State(state): State<Arc<AppState>>, mut req: Request<Body>, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().to_string();
    let is_upgrade = req.headers().get("upgrade").and_then(|v| v.to_str().ok()).unwrap_or("") == "websocket";

    // Always allow OPTIONS (CORS preflight)
    if method == axum::http::Method::OPTIONS {
        return next.run(req).await;
    }

    // fail-closed：无法确定登录密码时，不放行任何受保护请求
    if state.config.auth_password.is_none() {
        tracing::error!(
            "[auth] {} {} — 认证未配置（服务端缺少 WRENCH_AUTH_PASSWORD），拒绝请求",
            method,
            uri
        );
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Authentication not configured on the server. Set WRENCH_AUTH_PASSWORD and restart.",
        );
    }

    let required = required_scope(&uri);

    // Extract token from Authorization header (preferred, secure).
    let token_from_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| {
            let parts: Vec<&str> = h.split_whitespace().collect();
            if parts.len() == 2 && parts[0].eq_ignore_ascii_case("Bearer") {
                Some(parts[1].to_string())
            } else {
                None
            }
        });

    // DEPRECATED: query parameter fallback for WebSocket upgrade requests.
    // Browser WebSocket API does not support custom headers, so query param
    // is the only option during the transition period. It will be replaced
    // by first-message authentication in a future release.
    let token = if let Some(t) = token_from_header {
        Some(t)
    } else {
        let qt = req.uri().query().and_then(|q| {
            q.split('&').find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                if parts.next()? == "token" {
                    parts.next().map(|v| v.to_string())
                } else {
                    None
                }
            })
        });
        if qt.is_some() {
            tracing::warn!(
                "[auth] {} {} — DEPRECATED: Token via query parameter is insecure (exposed in server logs, browser history, proxy logs). Migrate to Authorization header or first-message auth.",
                method, uri
            );
        }
        qt
    };

    match token {
        // 遗留一次性 WS token —— 仅 WS 路径可用，避免被 REST 请求提前消耗
        Some(t) if required == SCOPE_WS && validate_token(&state, &t) => {
            tracing::info!(
                "[auth] {} {} — one-time WS token OK (upgrade={})",
                method,
                uri,
                is_upgrade
            );
            next.run(req).await
        }
        Some(t) => match validate_jwt(&state, &t) {
            Some(claims) => {
                // 口令轮换 = 全局登出：指纹不匹配（口令已改）的令牌一律拒绝
                if !fingerprint_matches(&state, &claims) {
                    tracing::warn!(
                        "[auth] {} {} — TOKEN REVOKED (password rotated, fingerprint mismatch)",
                        method,
                        uri
                    );
                    return json_error(
                        StatusCode::UNAUTHORIZED,
                        "Unauthorized: token revoked (password changed). Log in via POST /api/auth/login.",
                    );
                }

                // 能力校验：会话令牌 `api+ws` 两者皆可；`ws` token 不能调 REST
                if !claims.has_scope(required) {
                    tracing::warn!(
                        "[auth] {} {} — SCOPE DENIED scope=[{}] required=[{}]",
                        method,
                        uri,
                        claims.scope,
                        required
                    );
                    return json_error(
                        StatusCode::FORBIDDEN,
                        &format!(
                            "Forbidden: token scope [{}] does not allow [{}]. Log in via /api/auth/login.",
                            claims.scope, required
                        ),
                    );
                }
                tracing::info!(
                    "[auth] {} {} — JWT OK scope=[{}] sub=[{}] (upgrade={})",
                    method,
                    uri,
                    claims.scope,
                    claims.sub,
                    is_upgrade
                );
                // 供 handler 使用（如 GET /api/auth/me 返回当前身份）
                req.extensions_mut().insert(claims);
                next.run(req).await
            }
            None => {
                // Enhanced diagnostics: try to decode the JWT to identify the exact failure reason
                let has_jwt_service = state.jwt_service.read().is_some();
                // 按字符截断，避免多字节 token 触发切片 panic
                let token_preview: String = if t.chars().count() > 20 {
                    let head: String = t.chars().take(10).collect();
                    let tail: String = t.chars().rev().take(5).collect::<Vec<_>>().into_iter().rev().collect();
                    format!("{head}...{tail}")
                } else {
                    t.clone()
                };

                // Try to manually decode to find failure reason
                let decode_hint = if let Some(service) = state.jwt_service.read().as_ref() {
                    match service.verify(&t) {
                        Ok(claims) => format!("signature OK, exp={}, now={}", claims.claims.exp, chrono::Utc::now().timestamp() as u64),
                        Err(e) => format!("verify failed: {:?}", e),
                    }
                } else {
                    "jwt_service is None".to_string()
                };

                tracing::warn!(
                    "[auth] {} {} — REJECTED token_len={} upgrade={} preview=[{}] jwt_service={} hint=[{}]",
                    method, uri, t.len(), is_upgrade, token_preview, has_jwt_service, decode_hint
                );
                json_error(
                    StatusCode::UNAUTHORIZED,
                    "Unauthorized: invalid or expired token. Log in via POST /api/auth/login.",
                )
            }
        },
        None => {
            tracing::warn!("[auth] {} {} — NO TOKEN (upgrade={})", method, uri, is_upgrade);
            json_error(
                StatusCode::UNAUTHORIZED,
                "Unauthorized: no token provided. Log in via POST /api/auth/login.",
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::WsTokenInfo;
    use crate::config::AppConfig;
    use crate::utils::jwt::{JwtService, SCOPE_API_WS, SESSION_TTL_SECS};
    use std::path::PathBuf;
    use std::sync::Arc;

    fn make_state() -> Arc<AppState> {
        make_state_with_password(Some("test-password"))
    }

    fn make_state_with_password(auth_password: Option<&str>) -> Arc<AppState> {
        let config = AppConfig {
            host: "0.0.0.0".into(),
            port: 3001,
            frontend_dist: PathBuf::from("./frontend/dist"),
            plugins_dir: PathBuf::from("/tmp/plugins"),
            cors_origins: vec!["*".into()],
            openrouter_api_key: None,
            jwt_secret: "test-jwt-secret".into(),
            vault_key: None,
            database_url: None,
            log_level: "warn".into(),
            auth_password: auth_password.map(|s| s.to_string()),
        };
        Arc::new(AppState {
            config,
            db: None,
            connections: dashmap::DashMap::new(),
            docker_clients: dashmap::DashMap::new(),
            alerts: parking_lot::RwLock::new(Vec::new()),
            audit_logs: parking_lot::RwLock::new(Vec::new()),
            ws_tokens: dashmap::DashMap::new(),
            marketplace_cache: parking_lot::RwLock::new(None),
            active_logtails: dashmap::DashMap::new(),
            jwt_service: parking_lot::RwLock::new(None),
            start_time: std::time::Instant::now(),
        })
    }

    #[test]
    fn test_validate_token_valid() {
        let state = make_state();
        // Insert a valid token
        state.ws_tokens.insert(
            "valid-token-123".into(),
            WsTokenInfo {
                token: "valid-token-123".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
            },
        );

        assert!(validate_token(&state, "valid-token-123"));
        // Token should be consumed (one-time use)
        assert!(!validate_token(&state, "valid-token-123"));
    }

    #[test]
    fn test_validate_token_invalid() {
        let state = make_state();
        assert!(!validate_token(&state, "nonexistent-token"));
    }

    #[test]
    fn test_validate_token_expired() {
        let state = make_state();
        state.ws_tokens.insert(
            "expired-token".into(),
            WsTokenInfo {
                token: "expired-token".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() - chrono::Duration::seconds(1),
            },
        );

        assert!(!validate_token(&state, "expired-token"));
    }

    #[test]
    fn test_validate_token_one_time_use() {
        let state = make_state();
        state.ws_tokens.insert(
            "one-time".into(),
            WsTokenInfo {
                token: "one-time".into(),
                ip: "10.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::hours(2),
            },
        );

        // First call succeeds
        assert!(validate_token(&state, "one-time"));
        // Second call fails (consumed)
        assert!(!validate_token(&state, "one-time"));
        // Third call still fails
        assert!(!validate_token(&state, "one-time"));
    }

    #[test]
    fn test_required_scope_by_path() {
        // WS 路径需要 ws 能力，其余 REST 路径需要 api 能力
        assert_eq!(required_scope("/ws"), SCOPE_WS);
        assert_eq!(required_scope("/ws/terminal"), SCOPE_WS);
        assert_eq!(required_scope("/ws/docker/stats?x=1"), SCOPE_WS);
        assert_eq!(required_scope("/api/connections"), SCOPE_API);
        assert_eq!(required_scope("/api/ws-token"), SCOPE_API);
    }

    #[test]
    fn test_validate_jwt_enforces_scope_semantics() {
        use crate::utils::jwt::{SESSION_TTL_SECS, WS_TOKEN_TTL_SECS};
        let (state, service) = state_with_jwt_service("test-jwt-secret");

        let session_token = service
            .sign(&Claims::new("owner".into(), SCOPE_API_WS, SESSION_TTL_SECS))
            .unwrap();
        let claims = validate_jwt(&state, &session_token).expect("session token should verify");
        assert!(claims.has_scope(SCOPE_API));
        assert!(claims.has_scope(SCOPE_WS));

        // 短时 WS token 只有 ws 能力 → 不能调 REST
        let ws_token = service
            .sign(&Claims::new("owner".into(), SCOPE_WS, WS_TOKEN_TTL_SECS))
            .unwrap();
        let ws_claims = validate_jwt(&state, &ws_token).expect("ws token should verify");
        assert!(!ws_claims.has_scope(SCOPE_API));
        assert!(ws_claims.has_scope(SCOPE_WS));
    }

    #[test]
    fn test_validate_jwt_rejects_expired_and_foreign_secret() {
        let (state, service) = state_with_jwt_service("test-jwt-secret");

        // 已过期
        let expired = service
            .sign(&Claims::new("owner".into(), SCOPE_API_WS, 0))
            .unwrap();
        assert!(validate_jwt(&state, &expired).is_none());

        // 伪造签名（不同密钥）必须被拒绝
        let attacker = JwtService::from_secret("attacker-secret").unwrap();
        let forged = attacker
            .sign(&Claims::new("owner".into(), SCOPE_API_WS, 3600))
            .unwrap();
        assert!(validate_jwt(&state, &forged).is_none());

        // jwt_service 未初始化时一律拒绝
        assert!(validate_jwt(&make_state(), &forged).is_none());
    }

    /// 构造带 JwtService 的 state，并返回同一密钥的 service 用于签发测试令牌。
    fn state_with_jwt_service(secret: &str) -> (Arc<AppState>, JwtService) {
        let state = make_state();
        *state.jwt_service.write() = Some(JwtService::from_secret(secret).unwrap());
        (state, JwtService::from_secret(secret).unwrap())
    }

    #[test]
    fn test_fingerprint_matches_binds_token_to_password() {
        let state = make_state(); // auth_password = "test-password"
        let ok = Claims::session(&state.config.jwt_secret, "test-password");
        assert!(fingerprint_matches(&state, &ok));

        // 用旧口令签发的令牌在口令变更后必须失效
        let stale = Claims::session(&state.config.jwt_secret, "old-password");
        assert!(!fingerprint_matches(&state, &stale));

        // 无指纹的令牌（旧版本/伪造）同样拒绝
        let no_fp = Claims::new("owner".into(), SCOPE_API_WS, SESSION_TTL_SECS);
        assert!(!fingerprint_matches(&state, &no_fp));
    }

    #[test]
    fn test_fingerprint_requires_configured_password() {
        // 未配置口令时（fail-closed 场景）指纹校验一律不通过
        let state = make_state_with_password(None);
        assert!(!fingerprint_matches(
            &state,
            &Claims::session("test-jwt-secret", "test-password")
        ));
    }
}
