# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

ARG BUILD_HASH=0
WORKDIR /app

# 依赖缓存（package-lock.json 不变则跳过）
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm cd frontend && npm ci

# 源码变更 → 重新构建
COPY frontend/ ./frontend/
ENV VITE_BUILD_HASH=${BUILD_HASH}
RUN BUILD_HASH=${BUILD_HASH} cd frontend && npm run build

# ============================================
# Stage 2: Rust 依赖预编译（cargo-chef）
# ============================================
# cargo-chef 分析 Cargo.lock 生成「recipe」，只重建变化的依赖
# 依赖不变时此层 100% 命中缓存（~0s）
FROM rust:1.96-slim-bookworm AS chef
RUN cargo install cargo-chef
WORKDIR /app

# ============================================
# Stage 3: 依赖 recipe 生成
# ============================================
FROM chef AS planner
COPY backend/ ./
RUN cargo chef prepare --recipe-path recipe.json

# ============================================
# Stage 4: 依赖编译（仅当 Cargo.toml/Cargo.lock 变化时重跑）
# ============================================
FROM chef AS builder

ENV CARGO_NET_RETRY=5
ENV CARGO_HTTP_TIMEOUT=120
ENV CARGO_BUILD_JOBS=8
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

# 复制 recipe 并编译依赖
COPY --from=planner /app/recipe.json recipe.json

# 编译依赖（持久化 cargo 编译缓存到 BuildKit cache mount）
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo chef cook --release --recipe-path recipe.json 2>/dev/null || true

# --- 到这里为止，所有依赖已编译好 ---
# 下面只编译业务代码（增量编译，通常 5-15s）

COPY backend/src/ ./src/
RUN touch src/main.rs

# 编译最终二进制（只重编译 src/ 变化的部分）
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release && \
    cp /app/target/release/wrench-backend /tmp/wrench-backend

# 验证二进制
RUN BINARY_SIZE=$(stat -c%s /tmp/wrench-backend) && \
    echo "Binary size: ${BINARY_SIZE} bytes" && \
    if [ "$BINARY_SIZE" -lt 1000000 ]; then \
        echo "Binary too small (${BINARY_SIZE} bytes)" && exit 1; \
    fi && \
    echo "Binary size OK"

# ============================================
# Stage 5: 运行时镜像（不变时 100% 缓存命中）
# ============================================
FROM debian:12-slim

ARG BUILD_HASH=0

ENV FRONTEND_DIST=/app/frontend/dist \
    RUST_LOG=backend=info,tower_http=info \
    DATABASE_URL=/data/wrench.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl curl tini && \
    rm -rf /var/lib/apt/lists/*

ENV TZ=Asia/Shanghai
RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN groupadd -r wrench && useradd -r -g wrench -m -d /app wrench
WORKDIR /app
RUN mkdir -p /data plugins && chown wrench:wrench /app /app/plugins /data

COPY --from=builder /tmp/wrench-backend /app/wrench
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/
COPY plugins/ ./plugins
COPY backend/.env.example /app/.env.example
COPY docker-entrypoint.sh /app/

RUN chmod +x /app/docker-entrypoint.sh /app/wrench && \
    chown -R wrench:wrench /app

RUN echo "BUILD_HASH=${BUILD_HASH}" > /app/.build-info && \
    echo "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /app/.build-info

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3001/api/health || exit 1

ENTRYPOINT ["tini", "--"]
USER wrench
EXPOSE 3001
CMD ["/app/docker-entrypoint.sh"]
