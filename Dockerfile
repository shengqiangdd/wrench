# ============================================
# 构建阶段：编译前端
# ============================================
FROM node:22-alpine AS builder

WORKDIR /app

# 先只复制 lockfile 和 package.json → 利用 layer 缓存 npm ci
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# 复制源码并构建
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ============================================
# 运行阶段：极简生产镜像
# ============================================
FROM node:22-alpine

WORKDIR /app

# 安装后端依赖（语义化版本 lock）
COPY bridge/package.json bridge/package-lock.json ./bridge/
RUN cd bridge && npm ci --omit=dev

# 复制后端源码 + 前端构建产物 + 插件
COPY bridge/ ./bridge/
COPY --from=builder /app/frontend/dist/ ./frontend/dist/
COPY plugins/ ./plugins/

EXPOSE 3001

CMD ["node", "bridge/index.js"]
