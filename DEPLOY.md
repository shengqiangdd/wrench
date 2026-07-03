# 🚀 智盒 SmartBox 部署指南

## 📋 部署方案对比

| 方案 | 复杂度 | 适用场景 |
|------|--------|---------|
| **Docker Compose** | ⭐ 低 | 推荐，一键部署 |
| **手动部署** | ⭐⭐ 中 | 调试或自定义配置 |
| **Nginx + Systemd** | ⭐⭐⭐ 中高 | 生产环境高可用 |

---

## 🐳 方案一：Docker Compose（推荐）

### 快速启动

```bash
# 首次使用请先设置 JWT_SECRET 环境变量
export JWT_SECRET=$(openssl rand -hex 32)

docker compose up -d
# 访问 http://localhost:3001
```

`docker-compose.yml` 已预配置：
- 命名数据卷 `smartbox-data` 自动挂载到 `/data`，SQLite 数据库持久化不丢失
- `JWT_SECRET` 从环境变量注入（必填，用于令牌签发和 Vault 加密）
- 健康检查每 30s 探测 `/api/health`

### 数据持久化（SQLite）

SmartBox 使用 SQLite 存储审计日志、告警、凭据保险箱、通知渠道和 SSH 连接配置。
使用 `docker-compose.yml` 中的命名数据卷 `smartbox-data`，重启或升级容器后数据不丢失。

备份 SQLite 数据库：

```bash
docker run --rm -v smartbox_smartbox-data:/data -v $(pwd):/backup alpine cp /data/smartbox.db /backup/smartbox-$(date +%Y%m%d).db
```

手动运行（不依赖 docker-compose）：

```bash
# 创建持久化目录
mkdir -p /data/smartbox

# 运行容器并挂载数据卷
docker run -d \
  -p 3001:3001 \
  --name smartbox \
  --restart unless-stopped \
  -v /data/smartbox:/data \
  -e DATABASE_URL=/data/smartbox.db \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/shengqiangdd/smartbox:latest

# 停止后数据保留在 /data/smartbox/smartbox.db
# 备份: cp /data/smartbox/smartbox.db backup-$(date +%Y%m%d).db
```

### 构建并运行

```bash
# 仅构建
docker build -t smartbox .

# 运行
docker run -d -p 3001:3001 --name smartbox --restart unless-stopped smartbox
```

---

## 🔧 方案二：手动部署

### 1. 构建前端

```bash
cd frontend
npm install
npm run build     # 输出到 frontend/dist/
```

### 2. 构建 Rust 后端（生产模式）

```bash
cd smartbox-backend
# 首次构建需要安装 Rust 工具链
# curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo build --release
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 设置以下变量：
# API_KEY=your-secret-key         # 用于客户端认证
# DATABASE_URL=smartbox.db        # SQLite 数据库路径
# HOST=0.0.0.0
# PORT=3001
```

### 4. 启动后端

```bash
./target/release/smartbox-backend
# 后端自动托管 frontend/dist/ 静态文件，监听端口 3001
```

### 5. 使用 Systemd 实现进程守护（Linux）

创建 `/etc/systemd/system/smartbox.service`：

```ini
[Unit]
Description=SmartBox Web IDE
After=network.target

[Service]
Type=simple
User=smartbox
WorkingDirectory=/opt/smartbox
ExecStart=/opt/smartbox/smartbox-backend/target/release/smartbox-backend
Restart=always
RestartSec=10
Environment=API_KEY=your-secret-key
Environment=DATABASE_URL=/opt/smartbox/smartbox-backend/smartbox.db
Environment=HOST=0.0.0.0
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable smartbox
sudo systemctl start smartbox
sudo systemctl status smartbox
```

---

## 🌐 方案三：Nginx 反向代理

```nginx
server {
    listen 80;
    server_name smartbox.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name smartbox.example.com;

    ssl_certificate     /etc/letsencrypt/live/smartbox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/smartbox.example.com/privkey.pem;

    # 静态资源缓存
    location /assets/ {
        proxy_pass http://127.0.0.1:3001;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket 连接
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 前端页面
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3001` | 后端监听端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `BRIDGE_PORT` | `3001` | Bridge 服务端口 |
| `DATABASE_URL` | `无` (Docker 内默认 `/data/smartbox.db`) | SQLite 数据库路径 |
| `LOG_LEVEL` | `info` | 日志级别 (trace/debug/info/warn/error) |
| `JWT_SECRET` | 自动生成 | 用于 WebSocket 认证令牌签名 |
| `OPENROUTER_API_KEY` | 无 | AI 功能 API Key |

---

## 📊 健康检查

```bash
curl http://localhost:3001/api/health
# 返回: {"status":"ok","uptime":123}
```

## 🛡️ 安全建议

1. **生产环境务必使用反向代理**（Nginx / Caddy）
2. **启用 HTTPS**（Let's Encrypt 免费证书）
3. 配置 **IP 白名单**或**基础认证**
4. 定期更新依赖：`npm audit`
5. 使用非 root 用户运行服务
