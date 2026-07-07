#!/bin/bash
# Wrench 本地开发启动脚本

set -e

echo "🔧 Wrench 本地开发模式"
echo ""

# 检查 Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ 未安装 Rust，请先安装: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# 编译后端
echo "📦 编译后端..."
cd backend
cargo build --release 2>&1 | tail -5
cd ..

# 生成随机密钥
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 64)

echo ""
echo "🚀 启动 Wrench..."
echo "   地址: http://localhost:3001"
echo "   JWT_SECRET: ${JWT_SECRET:0:8}..."
echo ""

# 启动
cd backend
JWT_SECRET="$JWT_SECRET" \
FRONTEND_DIST="../frontend/dist" \
RUST_LOG="backend=info,tower_http=info" \
./target/release/wrench-backend
