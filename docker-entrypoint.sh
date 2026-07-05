#!/bin/sh
# ============================================================
# SmartBox Docker Entrypoint
#
# Strategy: exec directly into the Rust binary so that tini (PID 1)
# sends signals straight to the Rust process, which already has
# proper SIGINT/SIGTERM handlers installed (install_shutdown_signal).
#
# This avoids the fragile shell-in-the-middle signal forwarding that
# was causing the exit-code-0 restart loop: when a signal arrives
# during shell setup (before the Rust binary is even started), the
# shell's default behaviour terminates the whole process group with
# exit 0, and because `restart: unless-stopped` is set, Docker
# restarts the container — creating an infinite loop.
#
# For debugging, the log line below still appears in `docker logs`.
# ============================================================

LOG_PREFIX="[entrypoint]"
log() { printf '%s %s %s\n' "$LOG_PREFIX" "$(date -Iseconds 2>/dev/null || date)" "$*" >&2; }

log "Starting SmartBox backend (exec mode, signals go straight to app)..."
log "Entrypoint PID=$$, about to exec /app/smartbox-backend $*"

# ── exec replaces this shell with the Rust binary ──
# tini → smartbox-backend (no shell in between)
# Signals (SIGTERM/SIGINT) are delivered directly to the Rust process,
# which handles them via tokio::signal + graceful shutdown.
exec /app/smartbox-backend "$@"
