use axum::{
    body::Body,
    extract::{Request, State},
    http::{Method, StatusCode, header},
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;
use std::sync::Arc;

use crate::app_state::{AppState, WsTokenInfo};
use crate::space::{self, SpaceCtx, SpaceOutcome};
use crate::utils::jwt::{Claims, SCOPE_API, SCOPE_WS};

/// 路径所需能力：`/ws*` 需要 `ws`，其余 REST 接口需要 `api`。
fn required_scope(uri: &str) -> &'static str {
    if uri.starts_with("/ws") { SCOPE_WS } else { SCOPE_API }
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
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body))
        .unwrap()
}

/// 取出并**消费**一次性 WS 令牌（存在且未过期时返回其信息）。
fn take_ws_token(state: &Arc<AppState>, token: &str) -> Option<WsTokenInfo> {
    // 先读后删：避免同一分片上读锁→写锁自锁
    let valid = match state.ws_tokens.get(token) {
        Some(info) => info.expires_at >= chrono::Utc::now(),
        None => false,
    };
    if valid {
        state.ws_tokens.remove(token).map(|(_, v)| v)
    } else {
        None
    }
}

/// 校验 JWT 签名与有效期。
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

/// 请求是否经由 HTTPS（决定 cookie 是否加 `Secure`）。
///
/// 纯 HTTP 部署下如果加了 `Secure`，浏览器会直接丢弃 cookie，
/// 结果就是每次请求都新建一个空间 —— 必须按实际协议判断。
fn is_https(req: &Request<Body>) -> bool {
    req.headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(',').next().unwrap_or("").trim().eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

fn client_ip(req: &Request<Body>) -> String {
    req.extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

/// 认证 + 空间解析中间件。
///
/// # 两层
///
/// 1. **门（door）**：共享入口口令换来的会话 JWT（`api+ws`），或 `/api/ws-token` 签发的
///    一次性短时令牌（`ws`，仅 `/ws*` 可用）。校验签名、有效期、scope 与**令牌版本**
///    （改口令 = 旧令牌全失效）。未配置口令时 fail-closed（503）。
/// 2. **空间（space）**：门通过之后解析当前访问者的私有空间（HttpOnly cookie 或
///    `X-Space-Code` 头），首次访问自动创建。空间 id 注入 `SpaceCtx` 供 handler 使用，
///    每个 handler 都必须用 `space.id` 去查库。
///
/// 新建空间时响应会带上 `Set-Cookie` 与 `X-Space-Code`（明文码只在这里下发一次）。
pub async fn auth_middleware(State(state): State<Arc<AppState>>, mut req: Request<Body>, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().to_string();
    let is_upgrade = req.headers().get("upgrade").and_then(|v| v.to_str().ok()).unwrap_or("") == "websocket";

    // Always allow OPTIONS (CORS preflight)
    if method == Method::OPTIONS {
        return next.run(req).await;
    }

    // ── 门：服务端是否已有口令 ────────────────────────────────
    let (configured, current_tv) = {
        let auth = state.auth.read();
        (auth.configured(), auth.token_version)
    };
    if !configured {
        tracing::error!(
            "[auth] {} {} — 门户口令未设置，拒绝请求（请用启动日志里的 setup token 设置口令）",
            method,
            uri
        );
        return json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Authentication not configured. Ask the deployer for the one-time setup token shown in the server logs, \
             then open the web UI to set the entry password.",
        );
    }

    let required = required_scope(&uri);

    // Extract token from Authorization header (preferred, secure).
    let token_from_header = req
        .headers()
        .get(header::AUTHORIZATION)
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
    // is the only option during the transition period.
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
                "[auth] {} {} — DEPRECATED: Token via query parameter is insecure (exposed in server logs, browser history, proxy logs).",
                method,
                uri
            );
        }
        qt
    };

    // ── 门：一次性 WS 令牌 ────────────────────────────────────
    if let Some(t) = token.as_deref()
        && required == SCOPE_WS
        && let Some(info) = take_ws_token(&state, t)
    {
        tracing::info!("[auth] {} {} — one-time WS token OK (space={})", method, uri, info.space_id);
        req.extensions_mut().insert(SpaceCtx::new(info.space_id));
        return next.run(req).await;
    }

    // ── 门：会话 JWT ─────────────────────────────────────────
    let Some(t) = token else {
        tracing::warn!("[auth] {} {} — NO TOKEN (upgrade={})", method, uri, is_upgrade);
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Unauthorized: no token provided. Log in via POST /api/auth/login.",
        );
    };

    let Some(claims) = validate_jwt(&state, &t) else {
        tracing::warn!(
            "[auth] {} {} — REJECTED invalid/expired token (upgrade={})",
            method,
            uri,
            is_upgrade
        );
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Unauthorized: invalid or expired token. Log in via POST /api/auth/login.",
        );
    };

    // 令牌版本：改口令后所有旧令牌立即失效（空间数据不受影响）
    if claims.tv != Some(current_tv) {
        tracing::warn!(
            "[auth] {} {} — TOKEN REVOKED (token_version {:?} != {})",
            method,
            uri,
            claims.tv,
            current_tv
        );
        return json_error(
            StatusCode::UNAUTHORIZED,
            "Unauthorized: session expired (entry password changed). Please log in again.",
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

    // 把已验证的 claims 注入扩展：`/api/auth/me` 等 handler 需要它
    req.extensions_mut().insert(claims);

    // ── 空间：解析或创建 ─────────────────────────────────────
    let headers = req.headers().clone();
    let ip = client_ip(&req);
    match space::resolve_or_create(&state, &headers).await {
        SpaceOutcome::Existing(sp) => {
            tracing::debug!("[space] {} {} → space={}", method, uri, sp.id);
            req.extensions_mut().insert(SpaceCtx::new(sp.id));
            next.run(req).await
        }
        SpaceOutcome::Created(sp, code) => {
            tracing::info!("[space] {} {} → new space={}", method, uri, sp.id);
            state.add_audit_log("space_created", serde_json::json!({ "spaceId": sp.id }), &ip, &sp.id);
            let secure = is_https(&req);
            req.extensions_mut().insert(SpaceCtx::new(sp.id.clone()));
            let mut res = next.run(req).await;
            // 明文空间码只在这里下发一次；前端负责保存并展示给用户
            if let Ok(value) = header::HeaderValue::from_str(&space::cookie_header_value(&code, secure)) {
                res.headers_mut().insert(header::SET_COOKIE, value);
            }
            if let Ok(value) = header::HeaderValue::from_str(&code) {
                res.headers_mut().insert("x-space-code", value);
            }
            if let Ok(value) = header::HeaderValue::from_str(&sp.id) {
                res.headers_mut().insert("x-space-id", value);
            }
            res
        }
        SpaceOutcome::InvalidCode => {
            tracing::warn!("[space] {} {} — invalid space code supplied", method, uri);
            // 前端据此清掉失效的空间码并重新建一个空空间（否则用户会卡在“所有请求 400”）
            let mut res = json_error(
                StatusCode::BAD_REQUEST,
                "Invalid space code: 该空间码不存在（可能拼错，或已被重新生成）。",
            );
            res.headers_mut()
                .insert("x-space-invalid", header::HeaderValue::from_static("1"));
            res
        }
        SpaceOutcome::Unavailable => json_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Space storage unavailable on the server (database error or space limit reached).",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use crate::utils::jwt::JwtService;
    use std::path::PathBuf;

    fn test_config(auth_password: Option<&str>) -> AppConfig {
        AppConfig {
            host: "127.0.0.1".into(),
            port: 0,
            frontend_dist: PathBuf::from("./frontend/dist"),
            plugins_dir: PathBuf::from("/tmp/wrench/plugins"),
            cors_origins: vec![],
            openrouter_api_key: None,
            jwt_secret: "test-jwt-secret".into(),
            vault_key: None,
            database_url: None,
            log_level: "warn".into(),
            auth_password: auth_password.map(|s| s.to_string()),
        }
    }

    fn state_with_env_password(password: &str) -> Arc<AppState> {
        let rt = tokio::runtime::Runtime::new().unwrap();
        Arc::new(rt.block_on(AppState::new(test_config(Some(password)))).unwrap())
    }

    #[test]
    fn test_required_scope() {
        assert_eq!(required_scope("/api/hosts"), SCOPE_API);
        assert_eq!(required_scope("/ws/terminal"), SCOPE_WS);
    }

    #[test]
    fn test_take_ws_token_is_one_time() {
        let state = state_with_env_password("pw");
        state.ws_tokens.insert(
            "tok".into(),
            WsTokenInfo {
                token: "tok".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::minutes(5),
                space_id: "space-x".into(),
            },
        );
        let first = take_ws_token(&state, "tok").expect("first use should succeed");
        assert_eq!(first.space_id, "space-x");
        assert!(take_ws_token(&state, "tok").is_none(), "one-time token must not work twice");
    }

    #[test]
    fn test_expired_ws_token_rejected() {
        let state = state_with_env_password("pw");
        state.ws_tokens.insert(
            "old".into(),
            WsTokenInfo {
                token: "old".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() - chrono::Duration::seconds(1),
                space_id: "space-x".into(),
            },
        );
        assert!(take_ws_token(&state, "old").is_none());
    }

    #[test]
    fn test_jwt_without_token_version_is_stale() {
        // 旧版本的令牌（无 tv）必须被判定为过期：升级后强制重新登录一次
        let service = JwtService::from_secret("test-jwt-secret").unwrap();
        let legacy = Claims::new("owner".into(), "api+ws", 3600);
        let token = service.sign(&legacy).unwrap();
        let state = state_with_env_password("pw");
        let claims = validate_jwt(&state, &token).expect("signature 仍有效");
        let current_tv = state.auth.read().token_version;
        assert_ne!(claims.tv, Some(current_tv), "旧令牌应因缺少 tv 而被拒");
    }

    #[test]
    fn test_auth_runtime_verifies_env_and_db_password() {
        let state = state_with_env_password("env-pw");
        assert!(state.auth.read().verify("env-pw"));
        assert!(!state.auth.read().verify("wrong"));
        assert_eq!(state.auth.read().source(), "env");

        // DB 口令优先于环境变量（测试用低迭代次数，避免 debug 模式跑 60 万次 PBKDF2）
        let lower_cost_hash = low_cost_hash("db-pw");
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(state.set_door_password_hash(lower_cost_hash)).unwrap();
        assert!(state.auth.read().verify("db-pw"));
        assert!(!state.auth.read().verify("env-pw"), "DB 口令设置后 env 口令应失效");
        assert_eq!(state.auth.read().source(), "database");
    }

    /// 构造一个低迭代次数的 PBKDF2 哈希串（仅测试用，等价格式）。
    fn low_cost_hash(password: &str) -> String {
        use base64::Engine;
        let engine = base64::engine::general_purpose::STANDARD;
        let salt = [7u8; 16];
        let key = crate::utils::crypto::derive_key(password, &salt, 1_000);
        format!("pbkdf2-sha256$1000${}${}", engine.encode(salt), engine.encode(key))
    }

    #[test]
    fn test_password_hash_roundtrip_and_salt() {
        let stored = low_cost_hash("s3cret");
        assert!(crate::utils::crypto::verify_door_hash("s3cret", &stored));
        assert!(!crate::utils::crypto::verify_door_hash("S3cret", &stored));
        assert!(!crate::utils::crypto::verify_door_hash("s3cret", "garbage"));
        assert!(!crate::utils::crypto::verify_door_hash("s3cret", "pbkdf2-sha256$abc$eA==$eA=="));

        // 迭代次数是安全下限，用编译期断言：一旦被调低就编译失败
        // （不调用 hash_door_password 以免在测试里跑 60 万次迭代）
        const _: () = assert!(
            crate::utils::crypto::DOOR_ITERATIONS >= 600_000,
            "门户口令哈希迭代次数不得低于 OWASP 建议量级"
        );
    }
}
