#![allow(clippy::needless_update)]

pub mod api;
pub mod api_types;
pub mod app_state;
pub mod config;
pub mod docker;
pub mod error;
pub mod response;
pub mod ssh;
pub mod websocket;

pub mod db;
pub mod middleware;
pub mod models;
pub mod notify;
pub mod utils;

pub use app_state::AppState;

use axum::{
    body::Body,
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        StatusCode,
    },
    middleware as axum_middleware,
    response::Response,
    routing::get,
    Router,
};
use std::sync::Arc;
use tower::Layer;
use tower::ServiceBuilder;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, services::ServeDir, trace::TraceLayer};
use tracing::info;

/// Serve the SPA index.html with a service-worker-unregister script injected.
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

/// Middleware to set Cache-Control headers on static assets based on file extension.
///
/// - Hashed assets (JS/CSS/fonts with content hash in name): immutable, 1 year
/// - Other static assets (images, fonts): 7 days
/// - index.html and non-static paths: no-store (handled by SPA handler)
async fn static_cache_middleware(req: axum::http::Request<Body>, next: axum_middleware::Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;

    // Only apply to GET/HEAD requests that succeed
    if !response.status().is_success() {
        return response;
    }

    let cache_header: Option<&str> = match std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
        // Hashed JS/CSS from Vite build — immutable cache for 1 year
        Some(ext) if matches!(ext, "js" | "mjs" | "css" | "woff2") && has_hash_in_path(&path) => {
            Some("public, max-age=31536000, immutable")
        }
        // Images and fonts — 7 days
        Some("png" | "jpg" | "jpeg" | "gif" | "svg" | "ico" | "webp" | "woff" | "ttf" | "eot") => {
            Some("public, max-age=604800")
        }
        // Other static files — 1 day
        Some("json" | "xml" | "map" | "txt") => Some("public, max-age=86400"),
        // Everything else — no-store
        _ => None,
    };

    if let Some(val) = cache_header {
        response.headers_mut().insert(CACHE_CONTROL, val.parse().unwrap());
    }
    response
}

/// Check if a file path contains a content-hash pattern (Vite-style: name.hash.ext).
fn has_hash_in_path(path: &str) -> bool {
    if let Some(filename) = std::path::Path::new(path).file_stem().and_then(|s| s.to_str()) {
        // Vite hash patterns: name-XXXXXXXX.js or name.XXXXXXXX.js
        filename.contains('-') || filename.contains('.')
    } else {
        false
    }
}

pub async fn build_app(state: Arc<AppState>) -> Router {
    // CORS configuration
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

    // ─── Authentication + Rate-limit middleware layer ───
    let auth_layer = ServiceBuilder::new()
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            middleware::auth::auth_middleware
                as fn(
                    _: axum::extract::State<Arc<AppState>>,
                    _: axum::http::Request<Body>,
                    _: axum_middleware::Next,
                ) -> _,
        ))
        .layer(axum_middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit::rate_limit_middleware
                as fn(
                    _: axum::extract::State<Arc<AppState>>,
                    _: axum::http::Request<Body>,
                    _: axum_middleware::Next,
                ) -> _,
        ));

    // ─── Public API routes (no auth required) ───
    let public_api = Router::new()
        .route("/health", get(api::health::health_check))
        .route("/ws-token", axum::routing::post(api::auth::issue_jwt_token));

    // ─── Protected API routes (auth + rate limit required) ───
    let protected_api = Router::new()
        .route("/audit-logs", get(api::auth::get_audit_logs))
        .route("/hosts", get(api::hosts::list_hosts))
        .route("/hosts", axum::routing::post(api::hosts::add_host))
        .route("/hosts/{id}", axum::routing::delete(api::hosts::delete_host))
        .route("/alerts", get(api::alerts::list_alerts))
        .route("/alerts", axum::routing::post(api::alerts::create_alert))
        .route("/metrics", get(api::monitor::get_metrics))
        .route("/scripts", get(api::scripts::list_scripts))
        .route("/ssh/exec", axum::routing::post(api::ssh::exec_command))
        .route("/ssh/connect", axum::routing::post(api::ssh::connect_ssh))
        .route("/ssh/ensure", axum::routing::post(api::ssh::ensure_connection))
        .route("/ssh/disconnect", axum::routing::post(api::ssh::disconnect_ssh))
        .route("/ssh/test-config", get(api::ssh::test_config))
        .route("/docker/ps", axum::routing::post(api::docker::docker_ps))
        .route("/docker/images", axum::routing::post(api::docker::docker_images))
        .route("/docker/start", axum::routing::post(api::docker::start_container))
        .route("/docker/stop", axum::routing::post(api::docker::stop_container))
        .route("/docker/restart", axum::routing::post(api::docker::restart_container))
        .route("/docker/logs", axum::routing::post(api::docker::container_logs))
        .route("/docker/inspect", axum::routing::post(api::docker::inspect_container))
        .route("/docker/rm", axum::routing::post(api::docker::remove_container))
        .route("/docker/rmi", axum::routing::post(api::docker::remove_image))
        .route("/docker/pull", axum::routing::post(api::docker::pull_image))
        .route("/docker/push", axum::routing::post(api::docker::push_image))
        .route("/docker/tag", axum::routing::post(api::docker::tag_image))
        .route("/docker/prune", axum::routing::post(api::docker::prune_images))
        .route("/docker/history", axum::routing::post(api::docker::image_history))
        .route("/docker/stats", axum::routing::post(api::docker::container_stats))
        .route(
            "/docker/stats/all",
            axum::routing::post(api::docker::container_stats_all),
        )
        .route("/docker/exec", axum::routing::post(api::docker::exec_container))
        .route("/docker/compose", axum::routing::post(api::docker::compose_list))
        .route("/docker/compose/action", axum::routing::post(api::docker::compose_action))
        .route("/docker/diagnose", axum::routing::post(api::docker::docker_diagnose))
        .route("/logs/list-sources", axum::routing::post(api::logs::list_sources))
        .route("/logs/scan", axum::routing::post(api::logs::scan_log_sources))
        .route("/logs/tail", axum::routing::post(api::logs::tail_log))
        .route("/logs/grep", axum::routing::post(api::logs::grep_log))
        .route("/plugins", get(api::plugins::list_plugins))
        .route("/plugins/install", axum::routing::post(api::plugins::install_plugin))
        .route("/plugins/uninstall", axum::routing::post(api::plugins::uninstall_plugin))
        .route("/plugins/{id}/plugin.js", get(api::plugins::get_plugin_js))
        .route("/plugins/{id}/manifest.json", get(api::plugins::get_plugin_manifest))
        .route("/ai/config", get(api::ai::get_ai_config))
        .route("/ai/fetch-free-models", get(api::ai::fetch_free_models))
        .route("/ai/fetch-all-models", get(api::ai::fetch_all_models))
        .route("/ai/chat", axum::routing::post(api::ai::chat_proxy))
        .route("/sftp/list", axum::routing::post(api::sftp::sftp_list_dir))
        .route("/sftp/upload", axum::routing::post(api::sftp::sftp_upload))
        .route("/sftp/download", axum::routing::post(api::sftp::sftp_download))
        .route("/sftp/delete", axum::routing::post(api::sftp::sftp_delete))
        .route("/sftp/mkdir", axum::routing::post(api::sftp::sftp_mkdir))
        .route("/sftp/rename", axum::routing::post(api::sftp::sftp_rename))
        .route("/sftp/stat", axum::routing::post(api::sftp::sftp_stat))
        .route("/sftp/chmod", axum::routing::post(api::sftp::sftp_chmod))
        // ─── Host Health Dashboard ───
        .route("/hosts/health", get(api::host_health::get_all_health))
        .route("/hosts/diagnose", axum::routing::post(api::host_health::diagnose_host))
        // ─── Vault routes ───
        .route("/vault/types", get(api::vault::get_vault_types))
        .route("/vault", get(api::vault::list_vault_entries))
        .route("/vault", axum::routing::post(api::vault::create_vault_entry))
        .route("/vault/{id}", axum::routing::put(api::vault::update_vault_entry))
        .route("/vault/{id}", axum::routing::delete(api::vault::delete_vault_entry))
        // ─── Notification Channel routes ───
        .route("/notifications", get(api::notifications::list_channels))
        .route("/notifications", axum::routing::post(api::notifications::upsert_channel))
        .route("/notifications/{id}", axum::routing::delete(api::notifications::delete_channel))
        .route(
            "/notifications/test/{id}",
            axum::routing::post(api::notifications::test_channel),
        )
        // ─── SSH Connection persistence routes ───
        .route("/connections", get(api::connections::list_connections))
        .route("/connections", axum::routing::post(api::connections::upsert_connection))
        .route("/connections/{id}", axum::routing::delete(api::connections::delete_connection))
        // ─── System maintenance routes ───
        .route("/system/db-info", get(api::system::db_info))
        .route("/system/db-download", get(api::system::db_download))
        // ─── Marketplace routes ───
        .route("/market/index", get(api::market::get_market_index))
        .layer(auth_layer);

    // Combine public + protected API routes under /api
    let api_routes = Router::new()
        .nest("/api", Router::new().merge(public_api).merge(protected_api))
        .layer(cors.clone())
        .layer(TraceLayer::new_for_http())
        // Compress JSON API responses on-the-fly (gzip, min-size 512 bytes)
        .layer(CompressionLayer::new());

    // ─── Protected WebSocket routes (auth via query token) ───
    // Build a separate auth layer for WS (ServiceBuilder doesn't clone)
    let ws_auth_layer = ServiceBuilder::new().layer(axum_middleware::from_fn_with_state(
        state.clone(),
        middleware::auth::auth_middleware
            as fn(_: axum::extract::State<Arc<AppState>>, _: axum::http::Request<Body>, _: axum_middleware::Next) -> _,
    ));

    let ws_routes = Router::new()
        .route("/ws", get(websocket::terminal::ws_handler))
        .route("/ws/terminal", get(websocket::terminal::ws_handler))
        .route("/ws/logs", get(websocket::logs::ws_handler))
        .route("/ws/docker/stats", get(websocket::docker_stats::ws_handler))
        .layer(ws_auth_layer)
        .layer(cors);

    // ─── Combine all routes ───
    let app_with_state = Router::new()
        .merge(api_routes)
        .merge(ws_routes)
        .with_state(state.clone());

    // ─── Static frontend serving with SPA fallback ───
    let frontend_path = state.config.frontend_dist.clone();
    info!("Serving frontend from: {:?}", frontend_path);

    let serve_dir = ServeDir::new(&frontend_path)
        .append_index_html_on_directories(true)
        .precompressed_br()
        .precompressed_gzip();

    let fp_fallback = frontend_path.clone();
    let spa_handler = get(move || {
        let fp = fp_fallback.clone();
        async move { serve_index_html(fp).await }
    });

    let fallback = serve_dir.fallback(spa_handler);

    // Wrap with static cache middleware for optimal asset caching
    let fallback = axum_middleware::from_fn(static_cache_middleware).layer(fallback);

    Router::new()
        .merge(app_with_state)
        .fallback_service(fallback)
        .layer(TraceLayer::new_for_http())
}
