# ===== 构建阶段 =====
FROM node:22-alpine AS builder

WORKDIR /app

# 安装前端依赖
COPY frontend/package.json ./frontend/
RUN cd frontend && npm install

# 构建前端
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ===== 运行阶段 =====
FROM node:22-alpine

WORKDIR /app

# 安装后端依赖
COPY bridge/package.json ./bridge/
RUN cd bridge && npm install --production --registry=https://registry.npmmirror.com

# 复制后端源码
COPY bridge/ ./bridge/

# 复制前端构建产物
COPY --from=builder /app/frontend/dist/ ./frontend/dist/

# 复制插件
COPY plugins/ ./plugins/

# 暴露端口
EXPOSE 3001

# 启动
CMD ["node", "bridge/index.js"]
