use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use std::path::PathBuf;
/// Integration tests for SmartBox backend.
///
/// Uses in-process request/response via `tower::ServiceExt::oneshot`
/// to exercise the full router stack without spawning an HTTP server.
use std::sync::Arc;
use tower::ServiceExt;

use smartbox_backend::app_state::AppState;
use smartbox_backend::config::AppConfig;
use smartbox_backend::utils::jwt::{Claims, JwtService};

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
    }
}

async fn build_test_app() -> Router {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    smartbox_backend::build_app(Arc::new(state)).await
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
    let app = smartbox_backend::build_app(Arc::new(state)).await;

    let jwt = JwtService::from_secret(&config.jwt_secret).unwrap();
    let claims = Claims::new("test".into(), "api+ws", 86400);
    let token = jwt.sign(&claims).unwrap();

    let req = Request::builder()
        .uri("/api/ai/config")
        .header("Authorization", format!("Bearer {}", token))
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_ne!(resp.status(), StatusCode::UNAUTHORIZED);
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

/// ws-token endpoint is public (no auth).
#[tokio::test]
async fn ws_token_endpoint_is_public() {
    let app = build_test_app().await;
    let req = Request::builder()
        .method("POST")
        .uri("/api/ws-token")
        .header("Content-Type", "application/json")
        .body(Body::from(r#"{}"#))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert!(
        resp.status() != StatusCode::UNAUTHORIZED && resp.status() != StatusCode::NOT_FOUND,
        "Expected public access, got {}",
        resp.status()
    );
}
