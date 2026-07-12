#!/bin/sh
set -e

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
    log "Created empty .env"
  fi
fi

# ── 2. 确保 JWT_SECRET 存在 ──
# 优先级：环境变量 > .env 文件 > 自动生成
if [ -n "$JWT_SECRET" ] && [ "$JWT_SECRET" != "" ]; then
  # 环境变量已设置（来自 docker-compose environment），同步写入 .env
  sed -i '/^#*JWT_SECRET=/d' /app/.env
  echo "JWT_SECRET=${JWT_SECRET}" >> /app/.env
  log "Using JWT_SECRET from environment variable"
elif ! grep -q "^JWT_SECRET=." /app/.env 2>/dev/null; then
  JWT_SECRET=$(openssl rand -hex 32)
  sed -i '/^#*JWT_SECRET=/d' /app/.env
  echo "JWT_SECRET=${JWT_SECRET}" >> /app/.env
  log "Generated random JWT_SECRET"
fi

# ── 3. 启动 ──
log "Starting Wrench backend..."
exec /app/wrench "$@"
