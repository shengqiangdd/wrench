#!/usr/bin/env bash
# Deploy or roll back a pinned production image without changing auth policy.
# WRENCH_REQUIRE_AUTH is intentionally fixed to "off" in docker-compose.prod.yml.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"

usage() {
  cat <<'EOF'
Usage:
  WRENCH_IMAGE=<registry/image@sha256:...> WRENCH_VERSION=<id> tools/deploy-prod.sh deploy
  WRENCH_IMAGE=<known-good@sha256:...> WRENCH_VERSION=<id> tools/deploy-prod.sh rollback

Deploy captures the currently running image and, when available, its health build
identifier automatically for rollback. Set WRENCH_PREVIOUS_IMAGE and
WRENCH_PREVIOUS_VERSION explicitly when the current container is unavailable.
Optional checks:
  WRENCH_WS_HEALTH_URL=<ws://.../ws> checks a WebSocket 101 handshake.
  WRENCH_SFTP_HEALTH_URL=<http://.../api/sftp/list>
  WRENCH_SFTP_HEALTH_BODY='{"connectionId":"...","path":"/"}'
WRENCH_REQUIRE_AUTH remains off in docker-compose.prod.yml and is not
configurable by this script.
EOF
}

need_env() {
  local name="$1"
  if [[ -z ${!name:-} ]]; then
    printf 'error: %s must be set\n' "$name" >&2
    exit 2
  fi
}

validate_image() {
  if [[ ${WRENCH_ALLOW_TAG_IMAGE:-0} != 1 && "$1" != *@sha256:* ]]; then
    printf 'error: WRENCH_IMAGE must be a sha256 digest (set WRENCH_ALLOW_TAG_IMAGE=1 only for an explicit exception)\n' >&2
    exit 2
  fi
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

check_health_once() {
  local expected_version="${1:-}"
  local body
  body="$(curl --fail --silent --show-error --max-time 5 "$HEALTH_URL")" || return 1
  if [[ -n "$expected_version" ]] && ! grep -Fq "\"build\":\"$expected_version\"" <<<"$body"; then
    printf 'error: health build does not match expected version\n' >&2
    return 1
  fi

  if [[ -n ${WRENCH_WS_HEALTH_URL:-} ]]; then
    if ! curl --fail --silent --show-error --max-time 5 --http1.1 --include \
      -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
      -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: d2JlbmNoLWhlYWx0aC1jaGVjaw==' \
      "$WRENCH_WS_HEALTH_URL" 2>/dev/null | grep -q '^HTTP/.* 101 '; then
      printf 'error: WebSocket health handshake failed\n' >&2
      return 1
    fi
  fi

  if [[ -n ${WRENCH_SFTP_HEALTH_URL:-} ]]; then
    [[ -n ${WRENCH_SFTP_HEALTH_BODY:-} ]] || {
      printf 'error: WRENCH_SFTP_HEALTH_BODY is required with WRENCH_SFTP_HEALTH_URL\n' >&2
      return 1
    }
    local sftp_body
    sftp_body="$(curl --fail --silent --show-error --max-time 10 \
      -H 'Content-Type: application/json' -d "$WRENCH_SFTP_HEALTH_BODY" \
      "$WRENCH_SFTP_HEALTH_URL")" || return 1
    if ! grep -Fq '"success":true' <<<"$sftp_body"; then
      printf 'error: SFTP health probe did not succeed\n' >&2
      return 1
    fi
  fi
  return 0
}

wait_for_health() {
  local expected_version="${1:-}"
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if check_health_once "$expected_version"; then
      printf 'healthy: %s\n' "$HEALTH_URL"
      return 0
    fi
    if (( attempt < HEALTH_ATTEMPTS )); then sleep "$HEALTH_DELAY"; fi
  done
  printf 'error: health checks failed after %s attempts\n' "$HEALTH_ATTEMPTS" >&2
  return 1
}

current_image() {
  docker inspect --format '{{.Config.Image}}' wrench 2>/dev/null || true
}
current_build() {
  local body
  local build_pattern='"build":"([^"]*)"'
  body="$(curl --fail --silent --show-error --max-time 5 "$HEALTH_URL")" || return 0
  if [[ "$body" =~ $build_pattern ]]; then
    printf "%s" "${BASH_REMATCH[1]}"
  fi
}
ensure_local_image() {
  local image="$1"
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    printf "error: rollback image is not present locally; refusing to change the running service\n" >&2
    return 1
  fi
}

validate_rollback_target() {
  local image="$1"
  local expected_version="${2:-}"
  ensure_local_image "$image" || return 1
  if [[ -n "$expected_version" ]] && ! check_health_once "$expected_version"; then
    printf "error: current health build does not match the rollback target; refusing to change the running service\n" >&2
    return 1
  fi
}

run_image() {
  local image="$1"
  local version="${2:-}"
  WRENCH_IMAGE="$image" WRENCH_VERSION="$version" compose pull wrench
  WRENCH_IMAGE="$image" WRENCH_VERSION="$version" compose up -d --no-build wrench
  wait_for_health "$version"
  # A container can pass its first probe while still restarting. Re-run the
  # same checks after one interval before declaring deploy/rollback stable.
  sleep "$HEALTH_DELAY"
  check_health_once "$version" || {
    printf 'error: post-deploy health recheck failed\n' >&2
    return 1
  }
  printf 'stable after recheck: %s\n' "$HEALTH_URL"
}

deployment_diagnostics() {
  printf '--- deployment diagnostics ---\n' >&2
  printf 'compose service state:\n' >&2
  compose ps >&2 || true
  printf 'recent wrench container logs:\n' >&2
  docker logs --tail 100 wrench >&2 || true
  printf '%s\n' '--- end deployment diagnostics ---' >&2
}

deploy() {
  need_env WRENCH_IMAGE
  need_env WRENCH_VERSION
  validate_image "$WRENCH_IMAGE"
  local previous_image="${WRENCH_PREVIOUS_IMAGE:-}"
  local previous_version="${WRENCH_PREVIOUS_VERSION:-}"
  if [[ -z "$previous_image" ]]; then
    previous_image="$(current_image)"
    if [[ -z "$previous_version" ]]; then previous_version="$(current_build)"; fi
  fi

  if [[ -n "$previous_image" ]] && ! validate_rollback_target "$previous_image" "$previous_version"; then
    return 1
  fi

  if run_image "$WRENCH_IMAGE" "$WRENCH_VERSION"; then return 0; fi

  deployment_diagnostics
  if [[ -n "$previous_image" ]]; then
    printf 'health check failed; restoring previous image\n' >&2
    if run_image "$previous_image" "$previous_version"; then
      printf 'previous image restored successfully\n' >&2
    else
      printf 'error: automatic rollback also failed\n' >&2
    fi
  else
    printf 'error: no previous image available for automatic rollback\n' >&2
  fi
  return 1
}

rollback() {
  need_env WRENCH_IMAGE
  need_env WRENCH_VERSION
  validate_image "$WRENCH_IMAGE"
  ensure_local_image "$WRENCH_IMAGE" || return 1
  if run_image "$WRENCH_IMAGE" "$WRENCH_VERSION"; then return 0; fi

  deployment_diagnostics
  return 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  command=${1:-}
  case "$command" in
    deploy) deploy ;;
    rollback) rollback ;;
    -h|--help|help) usage ;;
    *) usage >&2; exit 2 ;;
  esac
fi
