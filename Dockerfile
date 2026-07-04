# ============================================
# Stage 1: Build React frontend
# ============================================
FROM node:22-alpine AS frontend-builder

ARG BUILD_HASH

WORKDIR /app

# Cache npm dependencies
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

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
# Use single-threaded linker for memory-constrained env
ENV CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
ENV CARGO_PROFILE_RELEASE_LTO=fat

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
RUN cargo build --release 2>&1 || true

# ── 然后覆盖真实源码，只重新编译 app 代码 ──
COPY smartbox-backend/src/ ./src/

# 增量编译：依赖已缓存，只编译 smartbox-backend 自身的代码
RUN cargo build --release

# ============================================
# Stage 3: Runtime image
# ============================================
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl curl && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r smartbox && useradd -r -g smartbox -m -d /app smartbox

WORKDIR /app

# Create plugins directory
RUN mkdir -p plugins && chown smartbox:smartbox /app /app/plugins

# Copy Rust binary
COPY --from=rust-builder /app/target/release/smartbox-backend /app/smartbox-backend

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/

# Copy plugins
COPY plugins/ ./plugins/

# Copy default env config
COPY smartbox-backend/.env.example /app/.env.example

# Set ownership
RUN chown -R smartbox:smartbox /app

USER smartbox

EXPOSE 3001

CMD ["/app/smartbox-backend"]
