#!/bin/bash
# SmartBox CI 自动测试
# 在 CI 中运行（仅 vite preview，无 bridge）

BRIDGE_PORT=${1:-3100}
BASE_URL="http://localhost:$BRIDGE_PORT"
PASS=0
FAIL=0
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

green() { echo -e "\033[32m✓ $1\033[0m"; }
red()   { echo -e "\033[31m✗ $1\033[0m"; }
info()  { echo -e "\033[36m→ $1\033[0m"; }

info "============ SmartBox CI 测试 ============"

# 等待服务就绪
for i in $(seq 1 10); do
  if curl -sf -o /dev/null "$BASE_URL" 2>/dev/null; then green "服务 OK"; break; fi
  sleep 1
done

# 1. 首页
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL" 2>/dev/null || echo "000")
if [ "$CODE" = "200" ]; then green "HTTP 200"; PASS=$((PASS+1)); else red "HTTP $CODE"; FAIL=$((FAIL+1)); fi

# 2. 静态资源
for f in "/assets/index-" "/sw.js" "/favicon.svg"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$f" 2>/dev/null || echo "000")
  [ "$CODE" = "200" ] && green "$f" || { red "$f → $CODE"; FAIL=$((FAIL+1)); }
  PASS=$((PASS+1))
done

# 3. 构建产物
if [ -d "$ROOT_DIR/frontend/dist" ]; then
  JS=$(find "$ROOT_DIR/frontend/dist/assets" -name "*.js" | wc -l)
  CSS=$(find "$ROOT_DIR/frontend/dist/assets" -name "*.css" | wc -l)
  green "JS: $JS, CSS: $CSS"; PASS=$((PASS+1))
else
  red "dist 不存在"; FAIL=$((FAIL+1))
fi

# 4. TypeScript
cd "$ROOT_DIR/frontend"
if npx tsc --noEmit 2>/dev/null; then green "TypeScript OK"; PASS=$((PASS+1)); else red "TS 失败"; FAIL=$((FAIL+1)); fi

# 汇总
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then echo -e "\n\033[32m ✅ 全部通过 ($PASS/$TOTAL)\033[0m"
else echo -e "\n\033[31m ❌ $FAIL 项失败 ($PASS/$TOTAL)\033[0m"
fi
exit $FAIL