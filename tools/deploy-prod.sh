#!/usr/bin/env bash
# Deploy or roll back the pinned production image without changing auth policy.
# WRENCH_REQUIRE_AUTH is intentionally fixed to "off" in docker-compose.prod.yml.
set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"

usage() {
  cat <<'EOF'
Usage:
  WRENCH_IMAGE=<digest> WRENCH_VERSION=<id> tools/deploy-prod.sh deploy
  WRENCH_IMAGE=<previous-digest> WRENCH_VERSION=<id> tools/deploy-prod.sh rollback

For deploy, set WRENCH_PREVIOUS_IMAGE to enable automatic rollback when the
new container does not become healthy. WRENCH_REQUIRE_AUTH is not configurable
by this script and remains off in docker-compose.prod.yml.
EOF
}

need_env() {
  local name="$1"
  if [[ -z ${!name:-} ]]; then
    printf 'error: %s must be set\n' "$name" >&2
    exit 2
  fi
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

wait_for_health() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
    if curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
      printf 'healthy: %s\n' "$HEALTH_URL"
      return 0
    fi
    if (( attempt < HEALTH_ATTEMPTS )); then
      sleep "$HEALTH_DELAY"
    fi
  done
  printf 'error: health check failed after %s attempts: %s\n' "$HEALTH_ATTEMPTS" "$HEALTH_URL" >&2
  return 1
}

deploy() {
  need_env WRENCH_IMAGE
  need_env WRENCH_VERSION
  compose pull wrench
  compose up -d --no-build wrench
  if wait_for_health; then
    return 0
  fi

  if [[ -n ${WRENCH_PREVIOUS_IMAGE:-} ]]; then
    printf 'health check failed; restoring previous image\n' >&2
    WRENCH_IMAGE="$WRENCH_PREVIOUS_IMAGE" compose pull wrench
    WRENCH_IMAGE="$WRENCH_PREVIOUS_IMAGE" compose up -d --no-build wrench
    wait_for_health
  fi
  return 1
}

rollback() {
  need_env WRENCH_IMAGE
  need_env WRENCH_VERSION
  compose pull wrench
  compose up -d --no-build wrench
  wait_for_health
}

command=${1:-}
case "$command" in
  deploy) deploy ;;
  rollback) rollback ;;
  -h|--help|help) usage ;;
  *) usage >&2; exit 2 ;;
esac
