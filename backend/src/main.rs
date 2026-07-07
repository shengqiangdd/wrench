use wrench_backend::build_app;
use wrench_backend::config::AppConfig;
use wrench_backend::AppState;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn print_usage() {
    eprintln!("Usage: wrench-backend [OPTIONS]");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --db-backup <output-path>   Backup SQLite database to a file");
    eprintln!("  --db-restore <input-path>    Restore SQLite database from a backup file");
    eprintln!("  --help                      Show this help");
}

/// Install a panic hook that logs the panic to stderr (visible in docker logs)
/// BEFORE the default abort/backtrace behaviour kicks in.
///
/// This is installed as a *permanent* hook (not replaced afterwards),
/// so any panic anywhere in the process is captured.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        eprintln!();
        eprintln!("========================================");
        eprintln!("APPLICATION PANIC");
        eprintln!("========================================");
        eprintln!("{panic_info}");
        if let Some(location) = panic_info.location() {
            eprintln!("  at {}:{}:{}", location.file(), location.line(), location.column());
        }
        eprintln!("========================================");
        eprintln!();

        // Also try tracing (may or may not be initialised yet)
        tracing::error!(target: "panic", "APPLICATION PANIC: {panic_info}");
    }));
}

/// Set up OS signal handlers for graceful shutdown.
///
/// Returns a `Notify` that is signalled when SIGINT or SIGTERM is received.
///
/// IMPORTANT: Signal handlers must be installed BEFORE `axum::serve` starts,
/// because signals sent early (before the handler is registered) will be
/// marked as "pending" by the kernel and delivered immediately upon
/// registration.  This would cause an immediate exit with code 0 and create
/// a Docker restart loop.
///
/// The handlers are installed once here, and a `Notify` is used to
/// communicate the signal to the graceful-shutdown future.
fn install_shutdown_signal() -> Arc<tokio::sync::Notify> {
    let notify = Arc::new(tokio::sync::Notify::new());

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
                    tracing::warn!("Failed to install SIGINT handler ({e}), graceful Ctrl+C will not work");
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
                    tracing::warn!("Failed to install SIGTERM handler ({e}), graceful docker stop will not work");
                }
            }
        });
    }

    notify
}

/// Wait for a shutdown signal. Must only be called after
/// `install_shutdown_signal()` has been invoked.
async fn wait_for_shutdown(notify: Arc<tokio::sync::Notify>) {
    notify.notified().await;
    tracing::info!("Shutdown signal received — initiating graceful shutdown");
    // Small delay to let the logger flush before the process exits
    tokio::time::sleep(Duration::from_millis(100)).await;
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // ── Earliest possible diagnostics (before tracing / env load) ──
    // These go straight to stderr so they appear in `docker logs` even if
    // everything else fails.  This is our lifeline for diagnosing the
    // exit-code-0 restart loop.
    eprintln!("[wrench] === Wrench backend starting ===");
    eprintln!(
        "[wrench] PID={}, argv0={}",
        std::process::id(),
        std::env::args().next().unwrap_or_default()
    );

    // Install the panic hook as early as possible
    install_panic_hook();

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
                .unwrap_or_else(|_| "wrench_backend=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    eprintln!("[wrench] Tracing initialised, loading config...");

    // Load config
    let config = AppConfig::from_env()?;
    tracing::info!(
        "Starting Wrench Backend PID={} on {}:{}",
        std::process::id(),
        config.host,
        config.port
    );
    tracing::info!("Frontend dist: {:?}", config.frontend_dist);
    tracing::info!("Database: {:?}", config.database_url);
    tracing::info!("Plugins dir: {:?}", config.plugins_dir);

    eprintln!("[wrench] Config loaded, building app state...");

    // Build app state
    let state = Arc::new(AppState::new(config.clone()).await?);
    tracing::info!("App state initialized");

    eprintln!("[wrench] App state ready, building router...");

    // Build router
    let app = build_app(state.clone()).await;
    tracing::info!("Router built");

    // ─── Idle SSH session cleanup (every 5 minutes) ───
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
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
                tracing::info!("Cleaned up {disconnected} idle/disconnected SSH sessions");
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
    eprintln!("[wrench] Binding TCP listener on {addr} ...");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Listening on http://{addr}/");

    // Run server with graceful shutdown on SIGTERM/SIGINT
    tracing::info!("Server started. Use Ctrl+C or 'docker stop' to gracefully shut down.");
    eprintln!("[wrench] Server is now accepting connections.");
    axum::serve(listener, app)
        .with_graceful_shutdown(wait_for_shutdown(shutdown_notify))
        .await?;

    tracing::info!("Server has shut down gracefully.");
    eprintln!("[wrench] Graceful shutdown complete, exiting.");
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
