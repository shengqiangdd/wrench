# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

ARG BUILD_HASH

WORKDIR /app

# Cache npm dependencies
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN --mount=type=cache,target=/root/.npm cd frontend && npm ci

# Inject build hash to bust cache when needed
RUN echo "$BUILD_HASH" > /tmp/build-hash.txt

# Copy and build frontend
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

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

# Copy all source code
COPY backend/ ./

# Build with cargo cache mount (reuses downloaded crates across builds)
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
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
RUN chmod +x /app/docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf http://localhost:3001/api/health || exit 1

ENTRYPOINT ["tini", "--"]

USER wrench

EXPOSE 3001

CMD ["/app/docker-entrypoint.sh"]
