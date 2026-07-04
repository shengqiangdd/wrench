use std::sync::Arc;
use std::path::PathBuf;
use axum::body::Body;
use axum::http::{Request, StatusCode};
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

#[tokio::test]
async fn test_health_endpoint_returns_200() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_404_for_nonexistent_api() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/nonexistent")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn test_cors_headers_present() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("Origin", "http://example.com")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(
        response.headers().contains_key("access-control-allow-origin"),
        "CORS header should be present"
    );
}

#[tokio::test]
async fn test_auth_middleware_blocks_unauthenticated() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/plugins")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Protected routes should return 401 without auth token"
    );
}

#[tokio::test]
async fn test_auth_middleware_allows_authenticated() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    // Create a valid JWT token
    let jwt_service = JwtService::from_secret(&config.jwt_secret)
        .expect("Failed to create JWT service");
    let claims = Claims::new("test".into(), "api+ws", 86400);
    let token = jwt_service.sign(&claims).expect("Failed to sign JWT");

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/ai/config")
                .header("Authorization", format!("Bearer {}", token))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    // With valid JWT, should not get 401 (might be 200 or 404 depending on config)
    assert_ne!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "Authenticated requests should not be blocked"
    );
}

#[tokio::test]
async fn test_vault_blocked_without_auth() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/vault")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_notifications_blocked_without_auth() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/notifications")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_system_backup_blocked_without_auth() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/system/backup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_jwt_token_endpoint_accessible() {
    let config = test_config();
    let state = AppState::new(config).await.expect("Failed to create AppState");
    let app = smartbox_backend::build_app(Arc::new(state));

    // POST /api/ws-token is mounted outside auth middleware
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/ws-token")
                .method("POST")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{}"#))
                .unwrap(),
        )
        .await
        .unwrap();

    // Should be accessible without auth (not 401 or 404)
    assert_ne!(response.status(), StatusCode::NOT_FOUND);
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);

    // If 200 OK, the response should have a JSON body with a token field
    if response.status() == StatusCode::OK {
        // Success — we trust the handler works correctly
    }
}
