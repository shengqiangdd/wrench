use axum::Json;
use axum::extract::connect_info::ConnectInfo;
use axum::extract::{Extension, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use std::net::SocketAddr;
use std::sync::Arc;

use crate::api_types::{AuditLogsResponse, TokenResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::utils::crypto::verify_password;
use crate::utils::jwt::{Claims, SCOPE_API_WS, SCOPE_WS, SESSION_TTL_SECS};

/// 认证类错误：需要用**真实 HTTP 状态码**返回（`ApiResponse` 固定 200，
/// 客户端无法据此区分“口令错误”与“服务端故障”）。
///
/// body 结构与 `ApiResponse` 的错误响应保持一致，便于前端统一处理。
pub struct AuthError {
    status: StatusCode,
    message: String,
}

impl AuthError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }

    /// 口令错误（不区分“未配置/错误”，避免信息泄露）
    fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, message)
    }

    /// 服务端未配置登录口令 —— fail-closed，拒绝签发任何令牌
    fn not_configured() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "Authentication not configured on the server. Set WRENCH_AUTH_PASSWORD and restart.",
        )
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let code = self.status.as_u16() as i32;
        let body = axum::Json(serde_json::json!({
            "success": false,
            "code": code,
            "msg": self.message,
            "error": self.message,
            "data": serde_json::Value::Null,
        }));
        (self.status, body).into_response()
    }
}

/// POST /api/auth/login 请求体
#[derive(serde::Deserialize)]
pub struct LoginRequest {
    pub password: String,
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
fn sign_claims(state: &AppState, claims: &Claims) -> Result<String, AuthError> {
    let service = state.jwt_service.read();
    let service = service
        .as_ref()
        .ok_or_else(|| AuthError::internal("JWT service not initialized"))?;
    service
        .sign(claims)
        .map_err(|_| AuthError::internal("Failed to sign JWT"))
}

/// 登录：用服务端配置的口令换取会话令牌（scope=`api+ws`，7 天）。
///
/// 这是签发会话令牌的**唯一**入口，必须携带正确的服务端口令；
/// 失败统一返回 401，口令本身不写日志、不进审计明细。
pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(payload): Json<LoginRequest>,
) -> Result<ApiResponse<TokenResponse>, AuthError> {
    let client_ip = addr.ip().to_string();

    let Some(expected) = state.config.auth_password.as_deref() else {
        tracing::error!("[auth] login denied — 服务端未配置 WRENCH_AUTH_PASSWORD");
        return Err(AuthError::not_configured());
    };

    // 恒定时间比较（SHA-256 摘要 + 定长比较），避免按字节短路泄露前缀
    let ok = verify_password(&payload.password, expected);
    tracing::info!(
        "[auth] login attempt from {} — {}",
        client_ip,
        if ok { "success" } else { "failed" }
    );
    state.add_audit_log(
        if ok { "login_success" } else { "login_failed" },
        serde_json::json!({ "scope": SCOPE_API_WS }),
        &client_ip,
    );

    if !ok {
        return Err(AuthError::unauthorized("Invalid password."));
    }

    // 会话令牌绑定当前口令：改口令即可让所有已签发令牌立即失效
    let claims = Claims::session(&state.config.jwt_secret, expected);
    let token = sign_claims(&state, &claims)?;

    Ok(ApiResponse::success(TokenResponse {
        token,
        token_type: "Bearer".into(),
        expires_in: SESSION_TTL_SECS,
    }))
}

/// 签发短时 WebSocket 令牌（scope=`ws`，10 分钟）。
///
/// 该路由挂在受保护路由上，到达此处即表示请求已通过会话校验（scope 含 `api`）。
/// 不直接把会话令牌放进 WS 的 URL 查询串，是因为查询串会进入浏览器历史、
/// 代理日志与服务器访问日志；短时且仅限 WS 的令牌能显著降低泄露影响。
pub async fn issue_ws_token(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Result<ApiResponse<TokenResponse>, AuthError> {
    let Some(password) = state.config.auth_password.as_deref() else {
        return Err(AuthError::not_configured());
    };

    let claims = Claims::ws_token(&state.config.jwt_secret, password);
    let token = sign_claims(&state, &claims)?;

    state.add_audit_log(
        "ws_token_issued",
        serde_json::json!({ "scope": SCOPE_WS, "ttlSeconds": crate::utils::jwt::WS_TOKEN_TTL_SECS }),
        &addr.ip().to_string(),
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

/// Get audit logs (GET /api/audit-logs)
pub async fn get_audit_logs(State(state): State<Arc<AppState>>) -> ApiResponse<AuditLogsResponse> {
    let logs = state.audit_logs.read();
    let total = logs.len();
    let slice: Vec<_> = logs.iter().rev().take(200).cloned().collect();

    ApiResponse::success(AuditLogsResponse { total, logs: slice })
}
