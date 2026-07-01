# ============================================
# Stage 1: Build Vue frontend
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

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests for dependency caching
COPY smartbox-backend/Cargo.toml smartbox-backend/Cargo.lock* ./

# Create dummy source to cache dependencies
RUN mkdir -p src && echo "fn main() {}" > src/main.rs && \
    mkdir -p src/api src/websocket src/ssh src/docker src/models src/middleware src/utils src/db/migrations && \
    touch src/api/mod.rs src/websocket/mod.rs src/ssh/mod.rs src/docker/mod.rs src/models/mod.rs src/middleware/mod.rs src/utils/mod.rs src/db/mod.rs

# Build dependencies
RUN cargo build --release 2>/dev/null || true

# Copy real source
COPY smartbox-backend/src/ ./src/

# Force rebuild
RUN touch src/main.rs

# Build release binary
RUN cargo build --release

# ============================================
# Stage 3: Runtime image
# ============================================
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create plugins directory
RUN mkdir -p plugins

# Copy Rust binary
COPY --from=rust-builder /app/target/release/smartbox-backend /app/smartbox-backend

# Copy frontend dist
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/

# Copy plugins
COPY plugins/ ./plugins/

# Copy default env config
COPY smartbox-backend/.env.example /app/.env.example

EXPOSE 3001

CMD ["/app/smartbox-backend"]
