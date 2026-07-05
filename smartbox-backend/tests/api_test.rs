/// Integration tests for SmartBox backend.
///
/// Verifies core infrastructure (AppState, JWT, router construction).
/// HTTP request tests are gradually added here.
use std::sync::Arc;
use std::path::PathBuf;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
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
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(async {
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
    let req = Request::builder()
        .uri("/api/health")
        .body(Body::from(""))
        .unwrap();
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
}
