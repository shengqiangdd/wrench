#!/bin/sh
set -ex

log() {
  echo "[entrypoint] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

# ── 1. 首次启动：复制默认配置文件 ──
if [ ! -f /app/.env ]; then
  if [ -f /app/.env.example ]; then
    cp /app/.env.example /app/.env
    log "Created default .env from example"
  else
    touch /app/.env
    log "Created empty .env (no example file found)"
  fi
fi

# ── 2. 确保 JWT_SECRET 存在 ──
if ! grep -q "^JWT_SECRET=." /app/.env 2>/dev/null; then
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i '/^#*JWT_SECRET=/d' /app/.env
  echo "JWT_SECRET=${JWT_SECRET}" >> /app/.env
  log "Generated random JWT_SECRET"
fi

# ── 3. 诊断 ──
log "Binary: /app/wrench ($(stat -c%s /app/wrench 2>/dev/null || echo '?') bytes)"
log "FRONTEND_DIST=${FRONTEND_DIST:-/app/frontend/dist}"

# 检查共享库依赖
log "Shared library dependencies:"
ldd /app/wrench 2>&1 | while read -r line; do
  log "  $line"
done

# ── 4. 启动 ──
log "Starting Wrench backend..."
echo ""

# 直接执行，不用 exec，这样可以捕获退出码
/app/wrench "$@"
EXIT_CODE=$?

echo ""
log "Wrench exited with code: $EXIT_CODE"
exit $EXIT_CODE
