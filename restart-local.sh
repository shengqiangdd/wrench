#!/bin/bash
# Wrench 快速重启（增量编译）

set -e

echo "🔄 快速重建..."

cd backend

# 增量编译（依赖已缓存，只需编译改动的文件）
cargo build --release 2>&1 | tail -3

echo ""
echo "✅ 编译完成，启动..."

JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

JWT_SECRET="$JWT_SECRET" \
FRONTEND_DIST="../frontend/dist" \
RUST_LOG="backend=info,tower_http=info" \
./target/release/wrench-backend
