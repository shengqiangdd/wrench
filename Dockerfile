# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

# BUILD_HASH bust: pass --build-arg BUILD_HASH=$(date +%s) to force a full
# rebuild of the frontend, even when COPY cache is stale.
ARG BUILD_HASH=0

WORKDIR /app

# Cache npm dependencies (only registry cache, no build artifacts)
# NOTE: This cache can serve stale packages if package-lock.json hasn't changed
# but upstream has security fixes. Use --no-cache to force fresh resolution.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm cd frontend && npm ci

# Copy source and build
COPY frontend/ ./frontend/

# Inject BUILD_HASH into Vite env so it changes the build output when busting
# Note: ARG in RUN is expanded at build time; changing BUILD_HASH busts this layer
ENV VITE_BUILD_HASH=${BUILD_HASH}
RUN BUILD_HASH=${BUILD_HASH} cd frontend && npm run build

# ============================================
# Stage 2: Build Rust backend
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

# Copy all source code (no-cache ensures this layer always re-runs)
COPY backend/ ./

# Build — only mount cargo registry cache (downloaded crates)
# Do NOT mount /app/target: persistent compiled artifacts can cause
# stale binaries when source changes but cargo's mtime check misses it.
# With no-cache:true in CI, a full rebuild is fast enough and guaranteed correct.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release && \
    cp /app/target/release/wrench-backend /tmp/wrench-backend

# Verify binary
RUN BINARY_SIZE=$(stat -c%s /tmp/wrench-backend) && \
    echo "Binary size: ${BINARY_SIZE} bytes" && \
    if [ "$BINARY_SIZE" -lt 1000000 ]; then \
        echo "❌ Binary too small (${BINARY_SIZE} bytes)" && exit 1; \
    fi && \
    echo "✅ Binary size OK"

# ============================================
# Stage 3: Runtime image
# ============================================
FROM debian:12-slim

ARG BUILD_HASH=0

ENV FRONTEND_DIST=/app/frontend/dist \
    RUST_LOG=backend=info,tower_http=info \
    DATABASE_URL=/data/wrench.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl curl tini && \
    rm -rf /var/lib/apt/lists/*

RUN groupadd -r wrench && useradd -r -g wrench -m -d /app wrench

WORKDIR /app

RUN mkdir -p /data plugins && \
    chown wrench:wrench /app /app/plugins /data

COPY --from=rust-builder /tmp/wrench-backend /app/wrench
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/
COPY plugins/ ./plugins
COPY backend/.env.example /app/.env.example
COPY docker-entrypoint.sh /app/

# 设置所有文件权限和所有者（放在所有 COPY 之后，确保不被缓存覆盖）
RUN chmod +x /app/docker-entrypoint.sh /app/wrench && \
    chown -R wrench:wrench /app

# BUILD_HASH in RUN ensures this layer busts when BUILD_HASH changes,
# even if all COPY layers above are cached.
# We stamp it into the image so runtime can verify freshness.
RUN echo "BUILD_HASH=${BUILD_HASH}" > /app/.build-info && \
    echo "BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /app/.build-info

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3001/api/health || exit 1

ENTRYPOINT ["tini", "--"]

USER wrench

EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
