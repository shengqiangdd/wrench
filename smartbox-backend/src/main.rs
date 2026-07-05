use smartbox_backend::build_app;
use smartbox_backend::config::AppConfig;
use smartbox_backend::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn print_usage() {
    eprintln!("Usage: smartbox-backend [OPTIONS]");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --db-backup <output-path>   Backup SQLite database to a file");
    eprintln!("  --db-restore <input-path>    Restore SQLite database from a backup file");
    eprintln!("  --help                      Show this help");
}

/// Set up OS signal handlers for graceful shutdown.
///
/// Returns a future that resolves when a shutdown signal is received.
///
/// IMPORTANT: Signal handlers must be installed BEFORE `axum::serve` starts,
/// because signals sent early (before the handler is registered) will be
/// marked as "pending" by the kernel and delivered immediately upon
/// registration. This would cause an immediate exit with code 0 and create
/// a Docker restart loop.
///
/// The handlers are installed once here, and a `Notify` is used to
/// communicate the signal to the graceful shutdown future.
fn install_shutdown_signal() -> std::sync::Arc<tokio::sync::Notify> {
    let notify = std::sync::Arc::new(tokio::sync::Notify::new());

    // ── SIGINT (Ctrl+C) ──
    {
        let n = notify.clone();
        tokio::spawn(async move {
            match tokio::signal::ctrl_c().await {
                Ok(()) => {
                    tracing::info!("Received SIGINT (Ctrl+C), starting graceful shutdown...");
                    n.notify_one();
                }
                Err(e) => {
                    tracing::warn!("Failed to install SIGINT handler ({}), graceful Ctrl+C will not work", e);
                }
            }
        });
    }

    // ── SIGTERM (docker stop) ──
    #[cfg(unix)]
    {
        let n = notify.clone();
        tokio::spawn(async move {
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(mut sig) => {
                    sig.recv().await;
                    tracing::info!("Received SIGTERM, starting graceful shutdown...");
                    n.notify_one();
                }
                Err(e) => {
                    tracing::warn!("Failed to install SIGTERM handler ({}), graceful docker stop will not work", e);
                }
            }
        });
    }

    notify
}

/// Wait for a shutdown signal. Must only be called after
/// `install_shutdown_signal()` has been invoked.
async fn wait_for_shutdown(notify: std::sync::Arc<tokio::sync::Notify>) {
    notify.notified().await;
    tracing::info!("Shutdown signal received — initiating graceful shutdown");
    // Small delay to let the logger flush before the process exits
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
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

    // Install panic hook to log panics before exit (helps diagnose Docker restart loops)
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        tracing::error!(
            target: "panic",
            "APPLICATION PANIC: {}",
            panic_info
        );
        // Also eprint for docker logs visibility
        eprintln!("PANIC: {}", panic_info);
    }));
    // Re-arm the original hook so default behavior (abort/backtrace) still happens
    std::panic::set_hook(prev_hook);

    // Load config
    let config = AppConfig::from_env()?;
    tracing::info!(
        "Starting SmartBox Backend PID={} on {}:{}",
        std::process::id(),
        config.host,
        config.port
    );
    tracing::info!("Frontend dist: {:?}", config.frontend_dist);
    tracing::info!("Database: {:?}", config.database_url);
    tracing::info!("Plugins dir: {:?}", config.plugins_dir);

    // Build app state
    let state = Arc::new(AppState::new(config.clone()).await?);
    tracing::info!("App state initialized");

    // Build router
    let app = build_app(state.clone()).await;
    tracing::info!("Router built");

    // ─── Idle SSH session cleanup (every 5 minutes) ───
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            let mut disconnected = 0usize;
            let ids: Vec<String> = cleanup_state.connections.iter().map(|e| e.key().clone()).collect();
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

    // ─── Install shutdown signal handlers BEFORE starting the server ───
    // This is critical: signals sent early (before handler registration) become
    // "pending" kernel signals and get delivered immediately upon registration,
    // causing an instant exit with code 0 (and a Docker restart loop).
    let shutdown_notify = install_shutdown_signal();

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{}/", addr);

    // Run server with graceful shutdown on SIGTERM/SIGINT
    tracing::info!("Server started. Use Ctrl+C or 'docker stop' to gracefully shut down.");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_notify))
        .await?;

    tracing::info!("Server has shut down gracefully.");
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
    let src_conn = rusqlite::Connection::open_with_flags(&src, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;

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

    let src_conn = rusqlite::Connection::open_with_flags(input, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let mut dst_conn = rusqlite::Connection::open(&dst)?;

    let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)?;
    backup.run_to_completion(100, Duration::from_millis(250), None)?;

    println!("Database restored from: {}", input.display());
    println!("Target: {}", dst.display());

    Ok(())
}
