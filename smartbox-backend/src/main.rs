use std::path::PathBuf;
use std::time::Duration;
use smartbox_backend::build_app;
use smartbox_backend::config::AppConfig;
use smartbox_backend::AppState;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn print_usage() {
    eprintln!("Usage: smartbox-backend [OPTIONS]");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --db-backup <output-path>   Backup SQLite database to a file");
    eprintln!("  --db-restore <input-path>    Restore SQLite database from a backup file");
    eprintln!("  --help                      Show this help");
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env if present
    dotenvy::dotenv().ok();

    // Parse CLI args for backup/restore commands
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        match args[1].as_str() {
            "--db-backup" => {
                if args.len() < 3 {
                    print_usage();
                    std::process::exit(1);
                }
                let output = PathBuf::from(&args[2]);
                return cmd_db_backup(&output).await;
            }
            "--db-restore" => {
                if args.len() < 3 {
                    print_usage();
                    std::process::exit(1);
                }
                let input = PathBuf::from(&args[2]);
                return cmd_db_restore(&input).await;
            }
            "--help" | "-h" => {
                print_usage();
                return Ok(());
            }
            _ => {
                print_usage();
                std::process::exit(1);
            }
        }
    }

    // ── Normal server startup ──

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
    let app = build_app(state.clone()).await;

    // ─── Idle SSH session cleanup (every 5 minutes) ───
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let mut disconnected = 0usize;
            let ids: Vec<String> = cleanup_state
                .connections
                .iter()
                .map(|e| e.key().clone())
                .collect();
            for id in ids {
                // Remove connection if session is idle or closed
                let should_remove = {
                    let entry = cleanup_state.connections.get(&id);
                    match entry {
                        Some(conn) => match &conn.session {
                            Some(session) => {
                                if !session.is_connected().await || session.is_idle_async().await {
                                    session.disconnect().await;
                                    true
                                } else {
                                    false
                                }
                            }
                            None => true, // No session, clean up entry
                        },
                        None => false,
                    }
                };
                if should_remove {
                    cleanup_state.connections.remove(&id);
                    disconnected += 1;
                }
            }
            if disconnected > 0 {
                tracing::info!("Cleaned up {} idle/disconnected SSH sessions", disconnected);
            }
        }
    });

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{}/", addr);

    axum::serve(listener, app)
        .await?;

    Ok(())
}

/// Backup the SQLite database to a file.
async fn cmd_db_backup(output: &PathBuf) -> anyhow::Result<()> {
    let config = AppConfig::from_env()?;
    let db_url = &config.database_url;

    if db_url.is_none() || db_url.as_ref().is_none_or(|u| u.is_empty() || u == ":memory:") {
        eprintln!("Error: No persistent database configured (DATABASE_URL is empty or :memory:). Nothing to back up.");
        std::process::exit(1);
    }

    let src = PathBuf::from(db_url.as_ref().unwrap());
    if !src.exists() {
        eprintln!("Error: Database file not found: {}", src.display());
        std::process::exit(1);
    }

    // Use SQLite's backup API via rusqlite
    let src_conn = rusqlite::Connection::open_with_flags(
        &src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;

    let mut dst_conn = rusqlite::Connection::open(output)?;

    let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)?;
    backup.run_to_completion(100, Duration::from_millis(250), None)?;

    println!("Database backed up to: {}", output.display());
    println!("Source: {}", src.display());
    println!("Size: {} bytes", std::fs::metadata(output)?.len());

    Ok(())
}

/// Restore the SQLite database from a backup file.
async fn cmd_db_restore(input: &PathBuf) -> anyhow::Result<()> {
    if !input.exists() {
        eprintln!("Error: Backup file not found: {}", input.display());
        std::process::exit(1);
    }

    let config = AppConfig::from_env()?;
    let db_url = &config.database_url;

    if db_url.is_none() || db_url.as_ref().is_none_or(|u| u.is_empty() || u == ":memory:") {
        eprintln!("Error: No persistent database configured (DATABASE_URL is empty or :memory:). Cannot restore.");
        std::process::exit(1);
    }

    let dst = PathBuf::from(db_url.as_ref().unwrap());

    // Ask for confirmation
    eprintln!("WARNING: This will OVERWRITE the current database at: {}", dst.display());
    eprintln!("Restore from backup: {}", input.display());

    let src_conn = rusqlite::Connection::open_with_flags(
        input,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;

    let mut dst_conn = rusqlite::Connection::open(&dst)?;

    let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)?;
    backup.run_to_completion(100, Duration::from_millis(250), None)?;

    println!("Database restored from: {}", input.display());
    println!("Target: {}", dst.display());

    Ok(())
}
