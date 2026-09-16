use axum::Json;
use axum::extract::connect_info::ConnectInfo;
use axum::extract::{Extension, State};
use axum::http::HeaderMap;

use std::net::SocketAddr;
use std::sync::Arc;

use crate::api_types::{AuditLogsResponse, TokenResponse};
use crate::app_state::AppState;
use crate::response::{ApiError, ApiResponse};
use crate::space::SpaceCtx;
use crate::utils::crypto::{hash_door_password, verify_password};
use crate::utils::jwt::{Claims, SCOPE_API_WS, SCOPE_WS, SESSION_TTL_REMEMBER_SECS, SESSION_TTL_SECS};

/// POST /api/auth/login 请求体
#[derive(serde::Deserialize)]
pub struct LoginRequest {
    pub password: String,
    /// 「记住此设备」：勾选后会话 30 天，否则 7 天
    #[serde(default)]
    pub remember: bool,
}

/// POST /api/auth/password 请求体（修改门户口令）
#[derive(serde::Deserialize)]
pub struct ChangePasswordRequest {
    #[serde(rename = "currentPassword")]
    pub current_password: String,
    #[serde(rename = "newPassword")]
    pub new_password: String,
}

/// GET /api/auth/status 响应：前端据此决定显示登录界面、配置提示，还是零输入直进。
#[derive(serde::Serialize)]
pub struct AuthStatusResponse {
    /// 门户口令是否已配置
    pub configured: bool,
    /// 门是否启用（`WRENCH_REQUIRE_AUTH`）；`false` 表示零输入直进，没有登录界面
    #[serde(rename = "authRequired")]
    pub auth_required: bool,
    /// 口令来源：`database` / `env` / `none` / `disabled`
    pub source: String,
    /// 是否允许在网页里修改口令（环境变量模式下也可以覆盖为数据库口令）
    #[serde(rename = "canChangePassword")]
    pub can_change_password: bool,
    /// 口令修改是否会让所有人重新登录（始终为 true，提示用户）
    #[serde(rename = "rotationLogsOutEveryone")]
    pub rotation_logs_out_everyone: bool,
}

/// GET /api/auth/me 响应：当前令牌身份
#[derive(serde::Serialize)]
pub struct IdentityResponse {
    pub sub: String,
    pub scope: String,
    pub iat: u64,
    pub exp: u64,
    #[serde(rename = "expiresIn")]
    pub expires_in: i64,
}

/// 使用 AppState 中已初始化的 JwtService 签发令牌。
///
/// 注意：不要用 `config.jwt_secret` 重新构造 service —— 必须与中间件校验用的
/// 那一个实例保持一致，否则会出现“签得出、验不过”。
fn sign_claims(state: &AppState, claims: &Claims) -> Result<String, ApiError> {
    let service = state.jwt_service.read();
    let service = service
        .as_ref()
        .ok_or_else(|| ApiError::internal("JWT service not initialized"))?;
    service
        .sign(claims)
        .map_err(|_| ApiError::internal("Failed to sign JWT"))
}

/// GET /api/auth/status（公开）——前端启动时判断显示哪种界面。
///
/// 三种情形：
/// * 门关（`authRequired=false`）→ 前端直接进入，没有登录界面；
/// * 门开且有口令 → 登录界面；
/// * 门开但没口令 → 前端显示「请部署侧配置」的说明页（fail-closed，用户设不了口令）。
pub async fn status(State(state): State<Arc<AppState>>) -> ApiResponse<AuthStatusResponse> {
    let auth = state.auth.read();
    let configured = auth.configured();
    let auth_required = state.config.require_auth;
    ApiResponse::success(AuthStatusResponse {
        configured,
        auth_required,
        source: if auth_required { auth.source().to_string() } else { "disabled".into() },
        can_change_password: auth_required && configured,
        rotation_logs_out_everyone: true,
    })
}

/// 口令强度下限：共享入口 + 公网暴露，弱口令等于没有门。
fn validate_password_strength(password: &str) -> Result<(), ApiError> {
    if password.chars().count() < 8 {
        return Err(ApiError::bad_request("Password must be at least 8 characters."));
    }
    let classes = [
        password.chars().any(|c| c.is_ascii_lowercase()),
        password.chars().any(|c| c.is_ascii_uppercase()),
        password.chars().any(|c| c.is_ascii_digit()),
        password.chars().any(|c| !c.is_alphanumeric()),
    ];
    if classes.iter().filter(|x| **x).count() < 2 {
        return Err(ApiError::bad_request(
            "Password must mix at least two of: lowercase, uppercase, digits, symbols.",
        ));
    }
    Ok(())
}

/// 登录：用共享入口口令换取会话令牌（scope=`api+ws`）。
///
/// 口令来源：数据库哈希优先，其次环境变量（legacy 部署）。
/// 失败统一 401；口令本身不写日志、不进审计明细。
pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(payload): Json<LoginRequest>,
) -> Result<ApiResponse<TokenResponse>, ApiError> {
    let client_ip = crate::middleware::client_ip::resolve(Some(addr.ip()), &headers);

    if !state.config.require_auth {
        // 门关着的时候没有「登录」这回事：前端压根不会调这里
        return Err(ApiError::bad_request(
            "Entry password is disabled on this instance (WRENCH_REQUIRE_AUTH=off).",
        ));
    }

    if !state.auth.read().configured() {
        tracing::error!("[auth] login denied — 门已开启但没有任何口令（部署侧需设置 WRENCH_AUTH_PASSWORD）");
        return Err(ApiError::not_configured());
    }

    // PBKDF2 校验是 CPU 密集操作，放到阻塞线程池，避免卡住异步运行时
    let candidate = payload.password.clone();
    let auth_snapshot = {
        let auth = state.auth.read();
        (auth.door_hash.clone(), auth.env_password.clone())
    };
    let ok = tokio::task::spawn_blocking(move || match auth_snapshot.0.as_deref() {
        Some(hash) => crate::utils::crypto::verify_door_hash(&candidate, hash),
        None => match auth_snapshot.1.as_deref() {
            Some(expected) => verify_password(&candidate, expected),
            None => false,
        },
    })
    .await
    .unwrap_or(false);

    // 审计归属：若请求带着自己的空间 cookie，就把这条登录记到该空间下
    let space_id = crate::space::resolve_existing(&state, &headers)
        .await
        .map(|s| s.id)
        .unwrap_or_default();

    tracing::info!(
        "[auth] login attempt from {} — {}",
        client_ip,
        if ok { "success" } else { "failed" }
    );
    state.add_audit_log(
        if ok { "login_success" } else { "login_failed" },
        serde_json::json!({ "scope": SCOPE_API_WS }),
        &client_ip,
        &space_id,
    );

    if !ok {
        return Err(ApiError::unauthorized("Invalid password."));
    }

    let claims = Claims::session(state.auth.read().token_version, payload.remember);
    let token = sign_claims(&state, &claims)?;
    let ttl = if payload.remember {
        SESSION_TTL_REMEMBER_SECS
    } else {
        SESSION_TTL_SECS
    };

    Ok(ApiResponse::success(TokenResponse {
        token,
        token_type: "Bearer".into(),
        expires_in: ttl,
    }))
}

/// POST /api/auth/password（受保护）——修改门户口令。
///
/// 需要提供当前口令；改完后**所有旧令牌立即失效**（包括自己，需要重新登录），
/// 但任何人的**空间与数据都不受影响** —— 这正是把门与空间解耦的目的。
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Extension(space): Extension<SpaceCtx>,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<ApiResponse<serde_json::Value>, ApiError> {
    let client_ip = crate::middleware::client_ip::resolve(Some(addr.ip()), &headers);

    if !state.config.require_auth {
        return Err(ApiError::bad_request(
            "Entry password is disabled on this instance (WRENCH_REQUIRE_AUTH=off).",
        ));
    }

    let current = payload.current_password.clone();
    let auth_snapshot = {
        let auth = state.auth.read();
        (auth.door_hash.clone(), auth.env_password.clone())
    };
    let ok = tokio::task::spawn_blocking(move || match auth_snapshot.0.as_deref() {
        Some(hash) => crate::utils::crypto::verify_door_hash(&current, hash),
        None => match auth_snapshot.1.as_deref() {
            Some(expected) => verify_password(&current, expected),
            None => false,
        },
    })
    .await
    .unwrap_or(false);

    if !ok {
        state.add_audit_log("password_change_rejected", serde_json::json!({}), &client_ip, &space.id);
        return Err(ApiError::unauthorized("Current password is incorrect."));
    }

    validate_password_strength(&payload.new_password)?;

    let hashed = hash_door_password(&payload.new_password);
    state
        .set_door_password_hash(hashed)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to store password: {e}")))?;

    tracing::info!("[auth] entry password changed from {client_ip}; all sessions revoked");
    state.add_audit_log("password_changed", serde_json::json!({}), &client_ip, &space.id);

    Ok(ApiResponse::success(serde_json::json!({
        "changed": true,
        "sessionsRevoked": true,
        "spacesUnaffected": true,
    })))
}

/// 签发短时 WebSocket 令牌（scope=`ws`，10 分钟），并绑定当前空间。
///
/// 该路由挂在受保护路由上，到达此处即表示请求已通过门校验（scope 含 `api`）。
/// 不直接把会话令牌放进 WS 的 URL 查询串，是因为查询串会进入浏览器历史、
/// 代理日志与服务器访问日志；短时且仅限 WS 的令牌能显著降低泄露影响。
pub async fn issue_ws_token(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Extension(space): Extension<SpaceCtx>,
) -> Result<ApiResponse<TokenResponse>, ApiError> {
    if state.config.require_auth && !state.auth.read().configured() {
        return Err(ApiError::not_configured());
    }

    let client_ip = crate::middleware::client_ip::resolve(Some(addr.ip()), &headers);

    let claims = Claims::ws_token(state.auth.read().token_version);
    let token = sign_claims(&state, &claims)?;

    // 令牌与空间绑定：WS 里只能用本空间的主机，避免跨空间越权
    state.ws_tokens.insert(
        token.clone(),
        crate::app_state::WsTokenInfo {
            token: token.clone(),
            ip: client_ip.clone(),
            expires_at: chrono::Utc::now() + chrono::Duration::seconds(crate::utils::jwt::WS_TOKEN_TTL_SECS as i64),
            space_id: space.id.clone(),
        },
    );

    state.add_audit_log(
        "ws_token_issued",
        serde_json::json!({ "scope": SCOPE_WS, "ttlSeconds": crate::utils::jwt::WS_TOKEN_TTL_SECS }),
        &client_ip,
        &space.id,
    );

    Ok(ApiResponse::success(TokenResponse {
        token,
        token_type: "Bearer".into(),
        expires_in: crate::utils::jwt::WS_TOKEN_TTL_SECS,
    }))
}

/// 当前令牌身份（GET /api/auth/me）——前端用于校验本地缓存的会话是否仍有效。
pub async fn me(Extension(claims): Extension<Claims>) -> ApiResponse<IdentityResponse> {
    let now = chrono::Utc::now().timestamp();
    ApiResponse::success(IdentityResponse {
        sub: claims.sub,
        scope: claims.scope,
        iat: claims.iat,
        exp: claims.exp,
        expires_in: claims.exp as i64 - now,
    })
}

/// Get audit logs (GET /api/audit-logs) —— 仅当前空间的操作记录。
///
/// 门外的全局事件（登录失败等）不在这里返回：它们带有别人的 IP，
/// 属于运维信息，只出现在容器日志里。
pub async fn get_audit_logs(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> ApiResponse<AuditLogsResponse> {
    let logs = state.audit_logs_for(&space.id, 200).await;
    let total = logs.len();
    // 新的在前
    let slice: Vec<_> = logs.into_iter().rev().collect();
    ApiResponse::success(AuditLogsResponse { total, logs: slice })
}
