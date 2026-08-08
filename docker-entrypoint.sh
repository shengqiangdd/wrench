#!/bin/sh
set -e

log() {
  echo "[entrypoint] $(date '+%Y-%m-%d %H:%M:%S') $*"
}

# ── 1. 确保持久化目录存在 ──
mkdir -p /data

# ── 2. 首次启动：复制默认配置文件到持久化卷 ──
if [ ! -f /data/.env ]; then
  if [ -f /app/.env.example ]; then
    cp /app/.env.example /data/.env
    log "Created default .env from example"
  else
    touch /data/.env
    log "Created empty .env"
  fi
fi

# ── 3. 确保 JWT_SECRET 存在 ──
# 优先级：环境变量 > 持久化 .env > 自动生成并保存
if [ -n "$JWT_SECRET" ] && [ "$JWT_SECRET" != "" ]; then
  # 环境变量已设置，同步写入持久化 .env
  sed -i '/^#*JWT_SECRET=/d' /data/.env
  echo "JWT_SECRET=${JWT_SECRET}" >> /data/.env
  log "Using JWT_SECRET from environment variable"
elif grep -q "^JWT_SECRET=." /data/.env 2>/dev/null; then
  # 从持久化卷读取之前生成的密钥
  export JWT_SECRET=$(grep "^JWT_SECRET=" /data/.env | head -1 | cut -d= -f2-)
  log "Loaded JWT_SECRET from /data/.env"
else
  # 首次启动：生成随机密钥并写入持久化卷
  JWT_SECRET=$(openssl rand -hex 32)
  export JWT_SECRET
  echo "JWT_SECRET=${JWT_SECRET}" >> /data/.env
  log "Generated random JWT_SECRET and saved to /data/.env"
fi

# ── 4. 启动 ──
log "Starting Wrench backend..."
exec /app/wrench "$@"
