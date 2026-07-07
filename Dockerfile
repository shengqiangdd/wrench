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
ENV CARGO_BUILD_JOBS=8
# Use sparse protocol for crates.io (much faster than default git)
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Step 1: Copy manifests for dependency caching ──
COPY backend/Cargo.toml backend/Cargo.lock* ./

# Create dummy source files so cargo can cache dependencies
RUN mkdir -p src && cat > src/main.rs << 'EOF'
fn main() {}
EOF
RUN echo "" > src/lib.rs

# Ensure Cargo.lock exists (for reproducible builds)
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi

# ── Step 2: Build dependencies (cached) ──
RUN cargo build --release

# ── Step 3: Build actual application ──
COPY backend/src/ ./src/
RUN cargo build --release

# ============================================
# Stage 3: Runtime image
# ============================================
FROM debian:12-slim

# 显式设置运行时路径和环境
ENV FRONTEND_DIST=/app/frontend/dist \
    RUST_LOG=backend=info,tower_http=info \
    DATABASE_URL=/data/wrench.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl curl tini && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r wrench && useradd -r -g wrench -m -d /app wrench

WORKDIR /app

# ── 创建运行时数据目录 ──
# Docker compose 的 data 卷挂载到 /data，
# 必须确保 wrench 用户有写权限（否则 SQLite 无法写入）
RUN mkdir -p /data plugins && \
    chown wrench:wrench /app /app/plugins /data

# Copy Rust binary
COPY --from=rust-builder /app/target/release/wrench-backend /app/wrench

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/

# Copy plugins
COPY plugins/ ./plugins

# Copy .env.example for entrypoint
COPY backend/.env.example /app/.env.example

# Copy entrypoint
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# ── Health check ──
# 每 30s 检查一次 API 响应，确保容器健康运行
# 返回 200 表示正常，其他表示异常
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3000/api/health || exit 1

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]

# Run as non-root user
USER wrench

EXPOSE 3000

CMD ["/app/docker-entrypoint.sh"]
