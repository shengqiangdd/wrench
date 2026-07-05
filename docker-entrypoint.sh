#!/bin/sh
# ============================================================
# SmartBox Docker Entrypoint
#
# Acts as a lightweight signal tracer between tini and the
# application. Every signal received is logged to stderr (which
# Docker captures) BEFORE being forwarded to the Rust binary.
# ============================================================
set -e

APP="/app/smartbox-backend"
SIGNAL_LOG="/proc/self/fd/2"  # stderr → docker logs

log() {
    echo "[entrypoint] $(date -Iseconds) $*" >&2
}

log "Starting SmartBox backend..."

# ── Trap common signals and log them ──
trap 'log "Received SIGINT (Ctrl+C) — forwarding to app"; kill -INT "$APP_PID"; wait "$APP_PID"; exit $?' INT
trap 'log "Received SIGTERM (docker stop) — forwarding to app"; kill -TERM "$APP_PID"; wait "$APP_PID"; exit $?' TERM
trap 'log "Received SIGQUIT — forwarding to app"; kill -QUIT "$APP_PID"; wait "$APP_PID"; exit $?' QUIT
trap 'log "Received SIGHUP — ignoring (not forwarded)"' HUP
trap 'log "Received SIGUSR1 — ignoring"' USR1
trap 'log "Received SIGUSR2 — ignoring"' USR2

# ── Start the backend in background ──
"$APP" "$@" &
APP_PID=$!
log "Backend started (PID ${APP_PID})"

# ── Wait for app to exit ──
if wait "$APP_PID"; then
    EXIT_CODE=$?
else
    EXIT_CODE=$?
fi

log "Backend exited with code ${EXIT_CODE}"
exit "${EXIT_CODE}"
