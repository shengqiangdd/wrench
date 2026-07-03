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

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Cargo manifests for dependency caching
COPY smartbox-backend/Cargo.toml smartbox-backend/Cargo.lock* ./

# Create dummy source files matching the actual module structure
# so cargo can resolve all workspace members and cache dependencies
RUN mkdir -p src && cat > src/main.rs << 'EOF'
fn main() {}
EOF
RUN cat > src/lib.rs << 'EOF'
pub mod app_state;
pub mod config;
pub mod error;
pub mod response;
pub mod api;
pub mod websocket;
pub mod ssh;
pub mod docker;
pub mod middleware;
pub mod utils;
pub mod db;
pub mod models;
pub mod notify;
EOF

# Create all module stub files so dependency resolution works fully
RUN mkdir -p src/api src/websocket src/ssh src/docker src/middleware src/utils src/db
RUN for mod in api/mod websocket/mod ssh/mod docker/mod middleware/mod utils/mod db/mod; do \
    echo "" > "src/$mod.rs"; \
    done
RUN echo "pub mod hello;" > src/api/mod.rs
RUN echo "" > src/api/hello.rs
RUN echo "pub mod crypto;" > src/utils/mod.rs
RUN echo "pub mod jwt;" > src/utils/jwt.rs
RUN echo "pub mod path;" > src/utils/path.rs
RUN echo "pub mod validator;" > src/utils/validator.rs

# Ensure Cargo.lock exists (for reproducible builds)
RUN if [ ! -f Cargo.lock ]; then cargo generate-lockfile; fi

# Copy the actual source code (overwrites dummies)
COPY smartbox-backend/src/ ./src/

# Force rebuild of the rust-builder crate with real source
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
