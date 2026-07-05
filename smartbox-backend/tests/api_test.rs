/// Integration tests for SmartBox backend API.
///
/// Spawns the full app on a random port and makes HTTP requests
/// via `reqwest` (already a dependency).
use std::sync::Arc;

use smartbox_backend::app_state::AppState;
use smartbox_backend::config::AppConfig;
use std::path::PathBuf;

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

/// Build app state for testing.
async fn build_test_state() -> Arc<AppState> {
    Arc::new(
        AppState::new(test_config())
            .await
            .expect("Failed to create AppState"),
    )
}

/// Spawn the app on a random port and return the base URL.
/// Waits for the server to be ready before returning.
async fn spawn_test_app() -> String {
    let state = build_test_state().await;
    let app = smartbox_backend::build_app(state).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind");
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{}", addr);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("Test server error: {:?}", e);
        }
    });

    // Wait for server to be ready (max 5 seconds)
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();
    for _ in 0..25 {
        if client.get(&base).send().await.is_ok() {
            return base;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
    }

    panic!("Test server failed to start at {}", base);
}

#[tokio::test]
async fn health_check_returns_ok() {
    let base = spawn_test_app().await;
    let resp = reqwest::get(format!("{}/api/health", base))
        .await
        .expect("GET /api/health failed");
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn unknown_routes_return_404() {
    let base = spawn_test_app().await;
    let resp = reqwest::get(format!("{}/api/nonexistent", base))
        .await
        .expect("GET /api/nonexistent failed");
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn protected_routes_require_auth() {
    let base = spawn_test_app().await;
    let resp = reqwest::get(format!("{}/api/plugins", base))
        .await
        .expect("GET /api/plugins failed");
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn ws_token_endpoint_is_public() {
    let base = spawn_test_app().await;
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/ws-token", base))
        .header("Content-Type", "application/json")
        .body("{}")
        .send()
        .await
        .expect("POST /api/ws-token failed");
    assert!(
        resp.status() != 404 && resp.status() != 401,
        "expected public access, got {}",
        resp.status()
    );
}

#[tokio::test]
async fn vault_notifications_backup_require_auth() {
    let base = spawn_test_app().await;
    let client = reqwest::Client::new();
    for path in &["/api/vault", "/api/notifications", "/api/system/backup"] {
        let resp = client
            .get(format!("{}{}", base, path))
            .send()
            .await
            .expect("request failed");
        assert_eq!(
            resp.status(),
            401,
            "endpoint {} should require auth",
            path
        );
    }
}
