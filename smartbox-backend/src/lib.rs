pub mod app_state;
pub mod config;
pub mod error;
pub mod response;

pub mod api;
pub mod websocket;
pub mod ssh;
pub mod docker;

pub mod middleware;
pub mod utils;
pub mod db;

pub mod models;

pub use app_state::AppState;

use axum::{
    body::Body,
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        StatusCode,
    },
    routing::get,
    Router,
};
use std::sync::Arc;
use tower_http::{
    cors::CorsLayer,
    services::ServeDir,
    trace::TraceLayer,
};
use tracing::info;

/// Clone of spa_fallback inline - reused for both explicit and fallback routes.
async fn serve_index_html(frontend_path: std::path::PathBuf) -> axum::response::Response {
    let index_path = frontend_path.join("index.html");
    match tokio::fs::read_to_string(&index_path).await {
        Ok(content) => {
            let sw_script = r#"
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(registrations) {
    for (let reg of registrations) {
      reg.unregister();
      console.log('ServiceWorker unregistered:', reg);
    }
  });
}
</script>
"#;
            let modified = content.replace("</head>", &format!("{}</head>", sw_script));
            axum::response::Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                .header(CACHE_CONTROL, "no-store, no-cache, must-revalidate, proxy-revalidate")
                .body(Body::from(modified))
                .unwrap()
        }
        Err(_) => axum::response::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap(),
    }
}

pub async fn build_app(state: Arc<AppState>) -> Router {
    // CORS
    let cors = if state.config.cors_origins.is_empty() {
        CorsLayer::permissive()
    } else {
        let origins: Vec<_> = state
            .config
            .cors_origins
            .iter()
            .map(|o| o.parse::<axum::http::HeaderValue>().unwrap())
            .collect();
        CorsLayer::new().allow_origin(origins)
    };

    // ============ API routes ============
    let api_routes = Router::new()
        .route("/health", get(api::health::health_check))
        .route("/ws-token", axum::routing::post(api::auth::issue_ws_token))
        .route("/audit-logs", get(api::auth::get_audit_logs))
        .route("/hosts", get(api::hosts::list_hosts))
        .route("/hosts", axum::routing::post(api::hosts::add_host))
        .route("/hosts/{id}", axum::routing::delete(api::hosts::delete_host))
        .route("/alerts", get(api::alerts::list_alerts))
        .route("/alerts", axum::routing::post(api::alerts::create_alert))
        .route("/metrics", get(api::monitor::get_metrics))
        .route("/scripts", get(api::scripts::list_scripts))
        .route("/ssh/exec", axum::routing::post(api::ssh::exec_command))
        .route("/docker/containers", get(api::docker::list_containers))
        .route("/docker/containers/{id}/start", axum::routing::post(api::docker::start_container))
        .route("/docker/containers/{id}/stop", axum::routing::post(api::docker::stop_container))
        .route("/docker/containers/{id}/restart", axum::routing::post(api::docker::restart_container))
        .route("/docker/containers/{id}/logs", get(api::docker::container_logs))
        .route("/docker/ps", get(api::docker::docker_ps))
        .route("/logs/list-sources", axum::routing::post(api::logs::list_sources))
        .route("/logs/tail", axum::routing::post(api::logs::tail_log))
        .route("/logs/grep", axum::routing::post(api::logs::grep_log))
        .route("/plugins", get(api::plugins::list_plugins))
        .route("/plugins/install", axum::routing::post(api::plugins::install_plugin))
        .route("/plugins/uninstall", axum::routing::post(api::plugins::uninstall_plugin))
        .route("/plugins/{id}/plugin.js", get(api::plugins::get_plugin_js))
        .route("/plugins/{id}/manifest.json", get(api::plugins::get_plugin_manifest))
        .route("/ai/config", get(api::ai::get_ai_config))
        .route("/ai/fetch-free-models", get(api::ai::fetch_free_models))
        .route("/ai/fetch-all-models", get(api::ai::fetch_all_models));

    let api_routes = Router::new()
        .nest("/api", api_routes)
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http());

    // ============ WebSocket routes ============
    let ws_routes = Router::new()
        .route("/terminal", get(websocket::terminal::ws_handler))
        .route("/logs", get(websocket::logs::ws_handler))
        .route("/batch", get(websocket::batch::ws_handler))
        .route("/docker/stats", get(websocket::docker_stats::ws_handler));

    let ws_routes = Router::new()
        .nest("/ws", ws_routes)
        .layer(cors);

    // ============ Combine API + WS with state ============
    let app_with_state = Router::new()
        .merge(api_routes)
        .merge(ws_routes)
        .with_state(state.clone());

    // ============ Static frontend serving ============
    let frontend_path = state.config.frontend_dist.clone();
    info!("Serving frontend from: {:?}", frontend_path);

    // Static file server for existing files
    let serve_dir = ServeDir::new(&frontend_path)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip();

    // SPA fallback (clone path for async closure)
    let fp_fallback = frontend_path.clone();
    let spa_handler = get(move || {
        let fp = fp_fallback.clone();
        async move { serve_index_html(fp).await }
    });

    // Fallback: first try static file, then SPA index.html
    let fallback = serve_dir.fallback(spa_handler);

    // Final router: API/WS routes first, then fallback for everything else
    Router::new()
        .merge(app_with_state)
        .fallback_service(fallback)
        .layer(TraceLayer::new_for_http())
}
