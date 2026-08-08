# ============================================
# Build stage: Compile Rust binary
# ============================================
FROM rust:1.82-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Layer 1: 仅复制依赖清单，用于预编译依赖缓存 ---
COPY Cargo.toml Cargo.lock* ./

# 创建 dummy src，仅用于 cargo 解析依赖树并编译依赖
RUN mkdir -p src/api src/websocket src/ssh src/docker src/models src/middleware src/utils src/db/migrations && \
    echo 'fn main() {}' > src/main.rs && \
    for d in api websocket ssh docker models middleware utils db db/migrations; do \
      touch "src/$d/mod.rs"; \
    done

# 仅下载并编译依赖（依赖不变时此层命中缓存）
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release 2>/dev/null || true

# --- Layer 2: 复制实际源码 ---
COPY src/ ./src/

# 触发重编译
RUN touch src/main.rs

# 编译最终二进制
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release

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
COPY --from=builder /app/target/release/cloudhub-backend /app/cloudhub

# Copy default config
COPY --from=builder /app/.env.example /app/.env.example

EXPOSE 3001

CMD ["/app/cloudhub"]
