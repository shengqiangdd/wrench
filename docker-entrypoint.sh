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

# ── 4. 登录口令（WRENCH_AUTH_PASSWORD，可选）──
# 优先级：环境变量 > 持久化 .env。
# 两者都没有时**故意不生成**：后端会进入「首次设置」模式，把一次性 setup token
# 打到启动日志，由使用者在网页里自己设置口令（PBKDF2 哈希落库，明文不写任何文件）。
# 以前这里会自动生成随机口令并写进 /data/.env，导致网页「首次设置」永远走不到，
# 使用者只能 docker exec 进去 cat 明文口令 —— 那正是被刻意改掉的旧体验。
if [ -n "$WRENCH_AUTH_PASSWORD" ]; then
  sed -i '/^#*WRENCH_AUTH_PASSWORD=/d' /data/.env
  # 单引号包裹，避免密码里的特殊字符被 shell 解析
  echo "WRENCH_AUTH_PASSWORD='${WRENCH_AUTH_PASSWORD}'" >> /data/.env
  log "Using WRENCH_AUTH_PASSWORD from environment variable"
elif grep -q "^WRENCH_AUTH_PASSWORD=." /data/.env 2>/dev/null; then
  export WRENCH_AUTH_PASSWORD=$(grep "^WRENCH_AUTH_PASSWORD=" /data/.env | head -1 | cut -d= -f2- | sed "s/^'//; s/'$//")
  log "Loaded WRENCH_AUTH_PASSWORD from /data/.env"
else
  log "未配置 WRENCH_AUTH_PASSWORD —— 后端将进入首次设置模式：用启动日志里的 setup token 在网页上设置口令。"
fi

# ── 5. 启动 ──
log "Starting Wrench backend..."
exec /app/wrench "$@"
