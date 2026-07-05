# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

ARG BUILD_HASH

WORKDIR /app

# Cache npm dependencies
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --prefer-offline

# Inject build hash to bust cache
RUN echo "$BUILD_HASH" > /tmp/build-hash.txt

# Copy and build frontend
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ============================================
# Stage 2: Build Rust backend
# ============================================
FROM rust:1.96-slim-bookworm AS rust-builder

# Prevent cargo from hanging on network issues
ENV CARGO_NET_RETRY=5
ENV CARGO_HTTP_TIMEOUT=120
# Limit parallelism to prevent OOM on memory-constrained runners
ENV CARGO_BUILD_JOBS=4
# Use sparse protocol for crates.io (much faster than default git)
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Cargo manifests for dependency caching
COPY smartbox-backend/Cargo.toml smartbox-backend/Cargo.lock* ./

# Create dummy source files so cargo can cache dependencies
RUN mkdir -p src && cat > src/main.rs << 'EOF'
fn main() {}
EOF
# Empty lib.rs — module stubs not needed; cargo resolves deps from Cargo.toml only
RUN echo "" > src/lib.rs

# Ensure Cargo.lock exists (for reproducible builds)
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi

# ── 关键优化：先用 dummy 源码编译依赖缓存层 ──
# 此步骤编译所有第三方依赖，只有 Cargo.lock 变化时才失效
# 注意：不使用 `|| true` 避免静默吞掉编译失败
RUN cargo build --release

# ── 然后覆盖真实源码，只重新编译 app 代码 ──
COPY smartbox-backend/src/ ./src/

# 增量编译：依赖已缓存，只编译 smartbox-backend 自身的代码
RUN cargo build --release

# ============================================
# Stage 3: Runtime image
# ============================================
FROM debian:12-slim

# 显式设置运行时路径和环境
ENV FRONTEND_DIST=/app/frontend/dist \
    RUST_LOG=smartbox_backend=info,tower_http=info \
    DATABASE_URL=/data/smartbox.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl curl tini && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r smartbox && useradd -r -g smartbox -m -d /app smartbox

WORKDIR /app

# ── 创建运行时数据目录 ──
# Docker compose 的 smartbox-data 卷挂载到 /data，
# 必须确保 smartbox 用户有写权限（否则 SQLite 无法写入）
RUN mkdir -p /data plugins && \
    chown smartbox:smartbox /app /app/plugins /data

# Copy Rust binary
COPY --from=rust-builder /app/target/release/smartbox-backend /app/smartbox-backend

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/

# Copy plugins
COPY plugins/ ./plugins/

# Copy entrypoint wrapper script.
# The script exec's directly into the Rust binary so that tini (PID 1)
# sends signals straight to the app, which already has proper
# SIGINT/SIGTERM handlers installed. This avoids the shell-in-the-middle
# signal forwarding that caused the exit-code-0 restart loop.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Copy default env config
COPY smartbox-backend/.env.example /app/.env.example

# Set ownership — must include all copied files
RUN chown -R smartbox:smartbox /app

USER smartbox

EXPOSE 3001

# Use tini as PID 1 (proper signal forwarding + zombie reaping).
# tini → docker-entrypoint.sh (exec) → smartbox-backend
# Signals (SIGTERM/SIGINT) go directly to the Rust binary.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/docker-entrypoint.sh"]
