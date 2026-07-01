use smartbox_backend::build_app;
use smartbox_backend::config::AppConfig;
use smartbox_backend::AppState;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "smartbox_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load config
    let config = AppConfig::from_env()?;
    tracing::info!("Starting SmartBox Backend on {}:{}", config.host, config.port);
    tracing::info!("Frontend dist: {:?}", config.frontend_dist);

    // Build app state
    let state = Arc::new(AppState::new(config.clone()).await?);

    // Build router
    let app = build_app(state).await;

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{}/", addr);

    axum::serve(listener, app)
        .await?;

    Ok(())
}
