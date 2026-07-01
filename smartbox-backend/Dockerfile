# ============================================
# Build stage: Compile Rust binary
# ============================================
FROM rust:1.82-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./

# Create dummy src for dependency caching
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    mkdir -p src/api src/websocket src/ssh src/docker src/models src/middleware src/utils src/db/migrations && \
    touch src/api/mod.rs src/websocket/mod.rs src/ssh/mod.rs src/docker/mod.rs src/models/mod.rs src/middleware/mod.rs src/utils/mod.rs src/db/mod.rs

# Build dependencies
RUN cargo build --release 2>/dev/null || true

# Copy real source code
COPY src/ ./src/

# Touch main.rs to force rebuild
RUN touch src/main.rs

# Build release binary
RUN cargo build --release

# ============================================
# Runtime stage: Minimal Debian image
# ============================================
FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tzdata openssl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create plugins directory
RUN mkdir -p plugins

# Copy binary
COPY --from=builder /app/target/release/smartbox-backend /app/smartbox-backend

# Copy default config
COPY --from=builder /app/.env.example /app/.env.example

EXPOSE 3001

CMD ["/app/smartbox-backend"]
