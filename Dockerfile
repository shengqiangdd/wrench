# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

ARG BUILD_HASH=0
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm cd frontend && npm ci

COPY frontend/ ./frontend/
ENV VITE_BUILD_HASH=${BUILD_HASH}
RUN BUILD_HASH=${BUILD_HASH} cd frontend && npm run build

# ============================================
# Stage 2: Build Rust backend（依赖预编译 + 增量源码编译）
# ============================================
FROM rust:1.96-slim-bookworm AS rust-builder

ENV CARGO_NET_RETRY=5
ENV CARGO_HTTP_TIMEOUT=120
ENV CARGO_BUILD_JOBS=8
ENV CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Step 1: 仅复制依赖清单，预编译依赖 ---
COPY backend/Cargo.toml backend/Cargo.lock* ./

# 创建 dummy src 用于 cargo 解析依赖树
RUN mkdir -p src/api src/websocket src/ssh src/docker src/models src/middleware src/utils src/db/migrations && \
    echo 'fn main() {}' > src/main.rs && \
    for d in api websocket ssh docker models middleware utils db db/migrations; do \
      touch "src/$d/mod.rs"; \
    done

# 编译依赖（依赖不变时此层命中缓存，~0s）
# 去掉 || true，让错误暴露出来
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release 2>/dev/null

# --- Step 2: 复制实际源码，增量编译 ---
COPY backend/src/ ./src/

# 仅重编译业务代码（依赖已缓存，cargo 自动检测文件变化）
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
# Stage 3: 运行时镜像
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

COPY --from=rust-builder /tmp/wrench-backend /app/wrench
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
