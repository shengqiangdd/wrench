use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
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
        require_auth: true,
    }
}

/// 空间隔离需要持久化存储（没有库时受保护接口一律 503 失败关闭），
/// 因此测试统一用一次性临时库。
fn temp_db_config() -> AppConfig {
    let mut config = test_config();
    let dir = tempfile::TempDir::new().expect("tempdir");
    config.database_url = Some(dir.keep().join("wrench-test.db").to_string_lossy().into_owned());
    config
}

async fn build_test_app() -> Router {
    build_test_app_with(temp_db_config()).await
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

/// 未知 `/api/*` 即使在前端产物存在时也必须 404（回归测试）。
///
/// 生产镜像里 `frontend/dist/index.html` 是存在的，SPA fallback 会把所有
/// 未匹配路径兜成 `200 + index.html`；若不给 /api 挂 fallback，拼错的接口
/// 会以「HTTP 200 + HTML」伪装成功（`GET /api/ssh/hosts` 这种不存在的路径
/// 就是这样骗过排障时的 curl 的）。单元测试里的 frontend_dist 指向
/// /nonexistent，所以这个差异只有真正带上 SPA 产物才能测出来。
#[tokio::test]
async fn unknown_api_route_is_404_even_with_spa_present() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), "<html><body>spa</body></html>").unwrap();

    let mut config = test_config();
    config.frontend_dist = dir.path().to_path_buf();

    let app = build_test_app_with(config).await;

    let resp = app
        .clone()
        .oneshot(Request::builder().uri("/api/nonexistent").body(Body::from("")).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND, "未知 /api/* 必须 404");

    // 前端路由（非 /api）仍要回落到 SPA，否则刷新页面会 404。
    let resp = app
        .oneshot(Request::builder().uri("/ssh").body(Body::from("")).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "前端路由应回落 SPA");
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
    let config = temp_db_config();
    let state = AppState::new(config.clone()).await.expect("AppState");
    // 会话令牌必须绑定当前门户口令版本（token version）
    let token_version = state.auth.read().token_version;
    let app = wrench_backend::build_app(Arc::new(state)).await;

    let jwt = JwtService::from_secret(&config.jwt_secret).unwrap();
    let claims = Claims::session(token_version, false);
    let token = jwt.sign(&claims).unwrap();

    let req = Request::builder()
        .uri("/api/ai/config")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
}

/// 修改口令后，用旧口令签发的令牌立即失效（全局登出），但空间数据不受影响。
#[tokio::test]
async fn token_is_revoked_after_password_change() {
    let config = temp_db_config();
    let state = Arc::new(AppState::new(config.clone()).await.expect("AppState"));
    let app = wrench_backend::build_app(state.clone()).await;

    let jwt = JwtService::from_secret(&config.jwt_secret).unwrap();
    let old_token = jwt
        .sign(&Claims::session(state.auth.read().token_version, false))
        .unwrap();

    let mk_req = |token: &str| {
        Request::builder()
            .uri("/api/connections")
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::from(""))
            .unwrap()
    };

    // 旧令牌此刻可用
    let resp = app.clone().oneshot(mk_req(&old_token)).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);

    // 网页里改口令 → 哈希落库 + token_version 自增
    state
        .set_door_password_hash(wrench_backend::utils::crypto::hash_door_password("a-brand-new-password"))
        .await
        .unwrap();

    let resp = app.oneshot(mk_req(&old_token)).await.unwrap();
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

/// 整库下载端点必须**彻底不存在**：多人共用下它能一次性拿走所有人的主机凭据与 Vault。
#[tokio::test]
async fn system_db_download_is_removed() {
    let app = build_test_app().await;
    let req = Request::builder()
        .uri("/api/system/db-download")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "db-download 必须返回 404（端点已移除），而不是泄露整库"
    );
}

/// 服务端**不再提供** SSH 连接写入端点：凭据不入服务端库（结构性保证）。
///
/// 历史教训：`POST /api/connections` 曾经把 `config` 原样存库，而 `config` 里通常
/// 带着 `password` / `private_key` 明文。写了就能存，黑名单校验永远可能漏字段名，
/// 所以直接取消写入口，只保留「读（脱敏）+ 删（清理历史）」。
#[tokio::test]
async fn connections_api_has_no_write_endpoint() {
    // 直接签一个合法会话令牌，避免再打一次 /api/auth/login（该端点有按 IP 限流，
    // 多打一次会让同进程内其它登录型测试收到 429）。
    let config = temp_db_config();
    let jwt_secret = config.jwt_secret.clone();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let token_version = state.auth.read().token_version;
    let app = wrench_backend::build_app(Arc::new(state)).await;
    let session = JwtService::from_secret(&jwt_secret)
        .expect("JwtService")
        .sign(&Claims::session(token_version, false))
        .expect("sign");

    // 即便带着有效会话，也没有 POST
    let req = with_connect_info(
        Request::builder()
            .method("POST")
            .uri("/api/connections")
            .header("Authorization", format!("Bearer {session}"))
            .header("Content-Type", "application/json")
            .body(Body::from(r#"{"name":"x","host":"h","config":"{\"password\":\"hunter2\"}"}"#))
            .unwrap(),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    assert_eq!(
        status,
        StatusCode::METHOD_NOT_ALLOWED,
        "写入口必须不存在，避免明文凭据被持久化；实际响应体：{}",
        String::from_utf8_lossy(&body)
    );

    // GET 仍然可用（元数据 + 脱敏）
    let req = with_connect_info(
        Request::builder()
            .uri("/api/connections")
            .header("Authorization", format!("Bearer {session}"))
            .body(Body::from(""))
            .unwrap(),
    );
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}

/// 服务端没有可用数据库时，受保护接口失败关闭（503），绝不退化成共享空间。
#[tokio::test]
async fn no_database_fails_closed() {
    let app = build_test_app_with(test_config()).await;
    let session = login_and_get_token(&app, "test-password").await;
    let req = Request::builder()
        .uri("/api/connections")
        .header("Authorization", format!("Bearer {session}"))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::SERVICE_UNAVAILABLE,
        "没有数据库就无法保证空间隔离，必须拒绝而不是共享"
    );
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

/// 显式带上（请求头）一个格式合法但库里不存在的空间码 → 400 + `x-space-invalid`。
///
/// 这是「用户拼错码 / 码在别处被重新生成」的路径：必须明确报错并由前端清码重建，
/// 不能静默换一个空空间（用户会以为数据丢了）。
#[tokio::test]
async fn unknown_space_code_header_is_rejected() {
    let app = build_test_app_with(temp_db_config()).await;
    let token = login_and_get_token(&app, "test-password").await;

    let req = with_connect_info(
        Request::builder()
            .method("GET")
            .uri("/api/space/me")
            .header("Authorization", format!("Bearer {token}"))
            .header("X-Space-Code", "a".repeat(64))
            .body(Body::empty())
            .unwrap(),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        resp.headers().get("x-space-invalid").and_then(|v| v.to_str().ok()),
        Some("1"),
        "要给出失效标记，前端据此清掉本地失效码"
    );
}

/// 只剩一个「库里已经没有」的 cookie 时必须发一个新空间，而不是 400。
///
/// 触发场景很常见：换库 / 重建实例 / 空间被删。cookie 是 HttpOnly，前端清不掉，
/// 一旦返回 400 就会变成「清码 → 再 400」的死循环，浏览器再也进不去。
#[tokio::test]
async fn stale_space_cookie_gets_a_fresh_space() {
    let app = build_test_app_with(temp_db_config()).await;
    let token = login_and_get_token(&app, "test-password").await;

    let req = with_connect_info(
        Request::builder()
            .method("GET")
            .uri("/api/space/me")
            .header("Authorization", format!("Bearer {token}"))
            .header("Cookie", format!("wrench_space={}", "b".repeat(64)))
            .body(Body::empty())
            .unwrap(),
    );
    let resp = app.oneshot(req).await.unwrap();

    assert_eq!(resp.status(), StatusCode::OK, "陈旧 cookie 应当拿到一个新空间");
    assert!(
        resp.headers().get("x-space-code").is_some(),
        "新空间码要下发（否则用户永远拿不到自己的码）"
    );
    assert!(
        resp.headers().get("set-cookie").is_some(),
        "要用新 cookie 覆盖掉那个陈旧 cookie"
    );
}

/// 首次访问（没有任何空间码）→ 200 且下发新空间码与 cookie。
#[tokio::test]
async fn first_visit_creates_a_space() {
    let app = build_test_app_with(temp_db_config()).await;
    let token = login_and_get_token(&app, "test-password").await;

    let req = with_connect_info(
        Request::builder()
            .method("GET")
            .uri("/api/space/me")
            .header("Authorization", format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap(),
    );
    let resp = app.oneshot(req).await.unwrap();
    let status = resp.status();
    let body = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    assert_eq!(
        status,
        StatusCode::OK,
        "第一次访问应当拿到一个新空间，实际 body={}",
        String::from_utf8_lossy(&body)
    );
}

// ─────────────────────────── 出口策略（egress policy） ───────────────────────────
//
// 这些用例盯的是「服务端替客户端连出去」这件事的**接线**：策略本身在
// `backend/src/egress.rs` 的单测里覆盖（地址分类、白名单、硬拒段、严格模式）。
// 这里只确认各条出口路径真的调用了策略，并且拒绝时给出 403 + 可读原因。

/// 建一个应用并**直接签**一个合法会话令牌（不走 /api/auth/login）。
///
/// `/api/auth/login` 有按 IP 限流，同进程内多打几次会让其它登录型用例收到 429，
/// 所以出口策略的用例自己签令牌，避免互相干扰。
async fn authed_app_and_token() -> (Router, String) {
    let config = temp_db_config();
    let jwt_secret = config.jwt_secret.clone();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let token_version = state.auth.read().token_version;
    let app = wrench_backend::build_app(Arc::new(state)).await;
    let token = JwtService::from_secret(&jwt_secret)
        .expect("JwtService")
        .sign(&Claims::session(token_version, false))
        .expect("sign");
    (app, token)
}

async fn authed_json_post(
    app: &Router,
    token: &str,
    uri: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let req = with_connect_info(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    );
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 256 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    (status, json)
}

/// SSH 连接：目标是内网地址且不在白名单里 → 拒绝，且原因要能读懂（不是笼统的"认证失败"）。
#[tokio::test]
async fn ssh_connect_to_private_host_is_denied_by_egress_policy() {
    let (app, token) = authed_app_and_token().await;

    let (status, json) = authed_json_post(
        &app,
        &token,
        "/api/ssh/connect",
        serde_json::json!({
            "host": "192.168.99.99",
            "port": 22,
            "username": "root",
            "password": "whatever",
        }),
    )
    .await;

    // 这个端点用 ApiResponse 约定：HTTP 200 + body 里的 code
    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["code"], 403, "内网目标必须被出口策略挡下：{json}");
    let msg = json["msg"].as_str().unwrap_or_default();
    assert!(msg.contains("出口策略"), "{msg}");
    assert!(msg.contains("WRENCH_EGRESS_ALLOW"), "要告诉管理员改哪个变量：{msg}");
}

/// 云元数据地址：即使写进白名单也不许连（写白名单也没有正当用途）。
#[tokio::test]
async fn ssh_connect_to_cloud_metadata_is_always_denied() {
    let (app, token) = authed_app_and_token().await;

    let (status, json) = authed_json_post(
        &app,
        &token,
        "/api/ssh/connect",
        serde_json::json!({
            "host": "169.254.169.254",
            "port": 22,
            "username": "root",
            "password": "whatever",
        }),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{json}");
    assert_eq!(json["code"], 403, "{json}");
    let msg = json["msg"].as_str().unwrap_or_default();
    assert!(msg.contains("元数据") || msg.contains("链路本地"), "{msg}");
}

/// 白名单里的目标要放行到「真的去连」这一步：预检通过后失败原因是连接/认证，
/// 而不是策略拒绝（403）。选 127.0.0.1 上没有监听的端口，失败是瞬间的。
#[tokio::test]
async fn allowlisted_target_passes_egress_check_and_fails_only_on_auth() {
    wrench_backend::egress::install(wrench_backend::egress::EgressPolicy::parse("127.0.0.1:2233", false).unwrap());

    let (app, token) = authed_app_and_token().await;

    let (_status, json) = authed_json_post(
        &app,
        &token,
        "/api/ssh/connect",
        serde_json::json!({
            "host": "127.0.0.1",
            "port": 2233,
            "username": "root",
            "password": "wrong-password",
        }),
    )
    .await;

    assert_ne!(json["code"], 403, "白名单内不该被策略拒绝：{json}");
    // 连不上/认证失败都是预期（该端口没有服务），但绝不是策略拒绝
    let msg = json["msg"].as_str().unwrap_or_default();
    assert!(!msg.contains("出口策略"), "{msg}");
}

/// 插件安装：下载地址来自请求体 → 私网/环回地址必须 403（否则就是 SSRF 跳板）。
#[tokio::test]
async fn plugin_install_from_loopback_url_is_denied() {
    let (app, token) = authed_app_and_token().await;

    let (status, json) = authed_json_post(
        &app,
        &token,
        "/api/plugins/install",
        serde_json::json!({
            "pluginId": "ssrf-probe",
            "manifestUrl": "http://127.0.0.1:9/manifest.json",
            "pluginUrl": "http://127.0.0.1:9/plugin.js",
        }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN, "{json}");
    let msg = json["msg"].as_str().unwrap_or_default();
    assert!(msg.contains("出口策略"), "{msg}");
}

/// AI 代理：base_url 来自请求体 → 打到云元数据地址必须 403。
#[tokio::test]
async fn ai_chat_proxy_to_metadata_url_is_denied() {
    let (app, token) = authed_app_and_token().await;

    let (status, json) = authed_json_post(
        &app,
        &token,
        "/api/ai/chat",
        serde_json::json!({
            "model": "whatever",
            "messages": [{"role": "user", "content": "hi"}],
            "base_url": "http://169.254.169.254/v1",
        }),
    )
    .await;

    assert_eq!(status, StatusCode::FORBIDDEN, "{json}");
    let msg = json["error"]["message"].as_str().unwrap_or_default();
    assert!(msg.contains("出口策略"), "{msg}");
}

// ─── 入口门的三种形态 ───────────────────────────────────────────
//
// 2026-09 起的产品决定：**不要求使用者设置口令**。
// * 门开 + 有口令（部署侧提供）→ 登录界面；
// * 门开 + 没口令 → 受保护接口 503（fail-closed），日志/状态接口告诉部署者怎么配；
// * 门关（`WRENCH_REQUIRE_AUTH=off`）→ 零输入直进，界面里没有任何口令环节。
//
// 关键不变式：**数据隔离不依赖门**。门关着时每个浏览器照样有自己的私有空间，
// 别人看不到（隔离由 `space_id` 在 SQL 层强制）。

/// `WRENCH_REQUIRE_AUTH=off`：无令牌也能访问受保护接口，且首访零输入就有自己的空间。
#[tokio::test]
async fn gate_off_allows_password_free_access() {
    let mut config = temp_db_config();
    config.require_auth = false;
    let app = build_test_app_with(config).await;

    // 1) 无令牌访问受保护接口 → 放行（不给 401）
    let resp = app
        .clone()
        .oneshot(with_connect_info(Request::builder().uri("/api/ai/config").body(Body::from("")).unwrap()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "门关着时不应要求令牌");

    // 2) 零输入首访 → 服务端直接建空间并下发一次性明文空间码
    let resp = app
        .clone()
        .oneshot(with_connect_info(Request::builder().uri("/api/space/me").body(Body::from("")).unwrap()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert!(
        resp.headers().get("x-space-code").is_some(),
        "零输入首访应立刻拿到自己的空间码（这是换设备的唯一凭据）"
    );

    // 3) 状态接口明确告诉前端「不用登录」
    let resp = app
        .clone()
        .oneshot(with_connect_info(Request::builder().uri("/api/auth/status").body(Body::from("")).unwrap()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let data = &json["data"];
    assert_eq!(data["authRequired"], serde_json::json!(false), "{json}");
    assert_eq!(data["source"], serde_json::json!("disabled"), "{json}");
    assert_eq!(data["configured"], serde_json::json!(false), "{json}");

    // 4) 门关着时「登录」没有意义，必须明确拒绝而不是假装成功
    let resp = app
        .clone()
        .oneshot(with_connect_info(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"password":"whatever"}"#))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

/// 门开着但没有口令 → 503 fail-closed，且状态接口说清「需要部署侧配置」（不再有网页首次设置）。
#[tokio::test]
async fn gate_on_without_password_fails_closed() {
    let mut config = temp_db_config();
    config.auth_password = None;
    assert!(config.require_auth, "默认为开门");
    let app = build_test_app_with(config).await;

    let resp = app
        .clone()
        .oneshot(with_connect_info(Request::builder().uri("/api/plugins").body(Body::from("")).unwrap()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);

    let resp = app
        .clone()
        .oneshot(with_connect_info(Request::builder().uri("/api/auth/status").body(Body::from("")).unwrap()))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK, "状态接口本身必须可访问（前端据此显示配置指引）");
    let bytes = axum::body::to_bytes(resp.into_body(), 64 * 1024).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["data"]["authRequired"], serde_json::json!(true), "{json}");
    assert_eq!(json["data"]["configured"], serde_json::json!(false), "{json}");
}

/// 网页「首次设置口令」端点必须彻底不存在：口令是部署侧的事，使用者不该被要求设口令。
#[tokio::test]
async fn web_setup_endpoint_is_gone() {
    let app = build_test_app().await;
    let resp = app
        .oneshot(with_connect_info(
            Request::builder()
                .method("POST")
                .uri("/api/auth/setup")
                .header("Content-Type", "application/json")
                .body(Body::from(r#"{"password":"a-strong-password"}"#))
                .unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        StatusCode::NOT_FOUND,
        "不能再有「由使用者设置口令」的入口"
    );
}
