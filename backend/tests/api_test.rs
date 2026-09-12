use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use std::path::PathBuf;
/// Integration tests for Wrench backend.
///
/// Uses in-process request/response via `tower::ServiceExt::oneshot`
/// to exercise the full router stack without spawning an HTTP server.
use std::sync::Arc;
use tower::ServiceExt;

use wrench_backend::app_state::AppState;
use wrench_backend::config::AppConfig;
use wrench_backend::utils::jwt::{Claims, JwtService};

fn test_config() -> AppConfig {
    AppConfig {
        host: "127.0.0.1".to_string(),
        port: 0,
        frontend_dist: PathBuf::from("/nonexistent"),
        plugins_dir: PathBuf::from("/nonexistent/plugins"),
        cors_origins: vec![],
        openrouter_api_key: None,
        jwt_secret: "test-secret-not-for-production".to_string(),
        vault_key: None,
        database_url: None,
        log_level: "error".to_string(),
        auth_password: Some("test-password".to_string()),
    }
}

async fn build_test_app() -> Router {
    build_test_app_with(test_config()).await
}

async fn build_test_app_with(config: AppConfig) -> Router {
    let state = AppState::new(config).await.expect("Failed to create AppState");
    wrench_backend::build_app(Arc::new(state)).await
}

/// Verify that `AppState` can be constructed with a test config.
#[test]
fn test_app_state_creation() {
    let config = test_config();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let state = AppState::new(config).await.expect("Failed to create AppState");
        assert!(state.connections.is_empty());
        assert!(state.docker_clients.is_empty());
        assert!(state.ws_tokens.is_empty());
    });
}

/// Verify that a JWT can be signed and verified.
#[test]
fn test_jwt_roundtrip() {
    let jwt = JwtService::from_secret("test-secret").expect("JwtService::from_secret");
    let claims = Claims::new("test-subject".into(), "api+ws", 3600);
    let token = jwt.sign(&claims).expect("sign");
    let decoded = jwt.verify(&token).expect("verify");
    assert_eq!(decoded.claims.sub, "test-subject");
    assert_eq!(decoded.claims.scope, "api+ws");
}

/// Verify that `build_app` creates a router successfully.
#[tokio::test]
async fn test_build_app_creates_router() {
    let app = build_test_app().await;
    let _ = app;
}

/// Health endpoint returns 200 OK.
#[tokio::test]
async fn health_check_returns_200() {
    let app = build_test_app().await;
    let req = Request::builder().uri("/api/health").body(Body::from("")).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

/// Unknown routes return 404.
#[tokio::test]
async fn unknown_route_returns_404() {
    let app = build_test_app().await;
    let req = Request::builder().uri("/api/nonexistent").body(Body::from("")).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

/// Protected routes return 401 without auth.
#[tokio::test]
async fn protected_routes_require_auth() {
    let app = build_test_app().await;
    let req = Request::builder().uri("/api/plugins").body(Body::from("")).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Invalid JWT is rejected with 401.
#[tokio::test]
async fn invalid_jwt_is_rejected() {
    let app = build_test_app().await;
    let req = Request::builder()
        .uri("/api/plugins")
        .header("Authorization", "Bearer invalid-token")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Valid JWT passes auth middleware.
#[tokio::test]
async fn authenticated_request_passes_auth() {
    let config = test_config();
    let state = AppState::new(config.clone()).await.expect("AppState");
    let app = wrench_backend::build_app(Arc::new(state)).await;

    let jwt = JwtService::from_secret(&config.jwt_secret).unwrap();
    // 会话令牌必须绑定当前登录口令
    let claims = Claims::session(&config.jwt_secret, "test-password");
    let token = jwt.sign(&claims).unwrap();

    let req = Request::builder()
        .uri("/api/ai/config")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// 修改口令后，用旧口令签发的令牌立即失效（全局登出）。
#[tokio::test]
async fn token_is_revoked_after_password_change() {
    let old_config = test_config();
    let jwt = JwtService::from_secret(&old_config.jwt_secret).unwrap();
    let old_token = jwt
        .sign(&Claims::session(&old_config.jwt_secret, "test-password"))
        .unwrap();

    // 服务端换成新口令重新部署
    let mut new_config = test_config();
    new_config.auth_password = Some("a-brand-new-password".to_string());
    let app = build_test_app_with(new_config).await;

    let req = Request::builder()
        .uri("/api/connections")
        .header("Authorization", format!("Bearer {old_token}"))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "old-password token must stop working after password rotation"
    );
}

/// Vault endpoint requires auth.
#[tokio::test]
async fn vault_requires_auth() {
    let app = build_test_app().await;
    let req = Request::builder().uri("/api/vault").body(Body::from("")).unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// Notifications endpoint requires auth.
#[tokio::test]
async fn notifications_require_auth() {
    let app = build_test_app().await;
    let req = Request::builder()
        .uri("/api/notifications")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// System db-info endpoint requires auth.
#[tokio::test]
async fn system_db_info_requires_auth() {
    let app = build_test_app().await;
    let req = Request::builder()
        .uri("/api/system/db-info")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// System db-download endpoint requires auth.
#[tokio::test]
async fn system_db_download_requires_auth() {
    let app = build_test_app().await;
    let req = Request::builder()
        .uri("/api/system/db-download")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// ws-token 端点必须要求认证（回归：以前无认证即可换取 24h 全权令牌）。
#[tokio::test]
async fn ws_token_endpoint_requires_auth() {
    let app = build_test_app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/ws-token")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::UNAUTHORIZED,
        "ws-token must not be issuable without authentication"
    );
}

/// 登录：口令错误 → 401；口令正确 → 200 并返回会话令牌。
#[tokio::test]
async fn login_requires_correct_password() {
    let app = build_test_app().await;

    let wrong = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"password":"wrong-password"}"#))
            .unwrap(),
    );
    let resp = app.clone().oneshot(wrong).await.unwrap();
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);

    let right = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"password":"test-password"}"#))
            .unwrap(),
    );
    let resp = app.oneshot(right).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert!(
        json["data"]["token"].as_str().map(|t| !t.is_empty()).unwrap_or(false),
        "login response must contain a token: {json}"
    );
}

/// 会话令牌可访问 REST；只有 `ws` 能力的令牌访问 REST 返回 403。
#[tokio::test]
async fn token_scope_is_enforced() {
    let app = build_test_app().await;
    let session = login_and_get_token(&app, "test-password").await;

    // 会话令牌（api+ws）可以访问 REST
    let req = with_connect_info(
        Request::builder()
            .uri("/api/plugins")
            .header("Authorization", format!("Bearer {session}"))
            .body(Body::from(""))
            .unwrap(),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_ne!(resp.status(), StatusCode::FORBIDDEN);

    // 用会话令牌换短时 WS 令牌
    let req = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/ws-token")
            .header("Authorization", format!("Bearer {session}"))
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{}"#))
            .unwrap(),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let ws_token = json["data"]["token"].as_str().unwrap().to_string();

    // WS 令牌不能调 REST（403，而不是 401）
    let req = Request::builder()
        .uri("/api/connections")
        .header("Authorization", format!("Bearer {ws_token}"))
        .body(Body::from(""))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    // 但可用于 /ws（非升级请求会被 handler 拒绝，不应是 401/403）
    let req = Request::builder()
        .uri("/ws")
        .header("Authorization", format!("Bearer {ws_token}"))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
    assert_ne!(resp.status(), StatusCode::FORBIDDEN);
}

/// 未配置登录密码时，受保护接口一律 503（fail-closed，绝不放行）。
#[tokio::test]
async fn missing_password_config_fails_closed() {
    let mut config = test_config();
    config.auth_password = None;
    let app = build_test_app_with(config).await;

    let req = Request::builder().uri("/api/connections").body(Body::from("")).unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    // 连登录口也是 503：无法登录，也就无法签发任何令牌
    let req = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"password":"test-password"}"#))
            .unwrap(),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
}

/// 在 oneshot 请求上补上 ConnectInfo（登录路由的限流中间件需要真实连接信息）。
fn with_connect_info(mut req: Request<Body>) -> Request<Body> {
    req.extensions_mut()
        .insert(axum::extract::connect_info::ConnectInfo(std::net::SocketAddr::from((
            [127, 0, 0, 1],
            54321,
        ))));
    req
}

/// 登录并取出会话令牌。
async fn login_and_get_token(app: &Router, password: &str) -> String {
    let req = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/auth/login")
            .header("Content-Type", "application/json")
            .body(Body::from(format!(r#"{{"password":"{password}"}}"#)))
            .unwrap(),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "login should succeed");
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    json["data"]["token"].as_str().unwrap().to_string()
}
