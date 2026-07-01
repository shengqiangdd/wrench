# SmartBox Backend (Rust)

Rust 重写的 SmartBox 后端服务，替代原 Node.js/Express 实现。

## 架构概览

```
src/
├── main.rs           # 入口，启动服务
├── lib.rs            # 路由组合与中间件配置
├── config.rs         # 环境配置管理
├── app_state.rs      # 共享状态（连接池、SSH 会话等）
├── api/              # REST API 处理器
│   ├── health.rs     # 健康检查
│   ├── auth.rs       # 认证 & WS Token
│   ├── hosts.rs      # 主机管理
│   ├── alerts.rs     # 告警管理
│   ├── monitor.rs    # 监控指标
│   ├── scripts.rs    # 脚本模板
│   ├── ssh.rs        # SSH 命令执行
│   ├── docker.rs     # Docker 容器管理
│   ├── logs.rs       # 日志查询
│   ├── plugins.rs    # 插件管理
│   └── ai.rs         # AI 模型配置
├── websocket/        # WebSocket 处理器
│   ├── terminal.rs   # xterm.js 终端
│   ├── logs.rs       # 日志流
│   ├── batch.rs      # 批量命令
│   └── docker_stats.rs  # Docker 监控
├── ssh/              # SSH 核心模块
│   ├── client.rs     # SSH 连接管理
│   ├── session.rs    # 会话管理
│   ├── executor.rs   # 命令执行
│   └── sftp.rs       # SFTP 文件操作
├── docker/           # Docker 模块
│   ├── container.rs  # 容器 CRUD
│   ├── image.rs      # 镜像管理
│   ├── compose.rs    # Compose 管理
│   └── stats.rs      # 资源监控
├── middleware/        # HTTP 中间件
│   ├── cors.rs       # CORS 配置
│   └── logging.rs    # 请求日志
├── models/           # 数据模型
├── utils/            # 工具函数
│   ├── crypto.rs     # AES-256-GCM 加密
│   ├── path.rs       # 路径穿越防护
│   └── validator.rs  # 输入校验
└── db/               # 数据库（可选 PostgreSQL）
```

## 快速启动

```bash
# 1. 复制并配置环境变量
cp .env.example .env

# 2. 运行（需要 Rust 工具链）
cargo run --release

# 3. 访问
curl http://localhost:3001/api/health
```

## Docker 构建

```bash
docker build -t smartbox-backend .
docker run -p 3001:3001 smartbox-backend
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| BRIDGE_HOST | 0.0.0.0 | 监听地址 |
| BRIDGE_PORT | 3001 | 监听端口 |
| LOG_LEVEL | info | 日志级别 |
| CORS_ORIGINS | (空) | 允许的跨域来源，逗号分隔 |
| FRONTEND_DIST | ./frontend/dist | 前端构建产物目录 |
| PLUGINS_DIR | ./plugins | 插件目录 |
| JWT_SECRET | (自动) | JWT 密钥 |
| OPENROUTER_API_KEY | (空) | OpenRouter API Key |

## API 端点

与原 Node.js 后端100%兼容，参见原 `bridge/` 目录的 API 文档。

## 技术栈

- **Web 框架**: Axum 0.8 + Tokio
- **SSH 客户端**: russh (纯 Rust)
- **Docker API**: bollard
- **加密**: AES-256-GCM (aes-gcm crate)
- **序列化**: Serde + serde_json
- **日志**: Tracing

## 安全特性

- ✅ SSH 凭据 AES-256-GCM 加密存储
- ✅ 路径穿越防护（所有路径操作规范化检查）
- ✅ 命令注入检测
- ✅ 输入校验（主机地址、端口、用户名）
- ✅ 统一错误响应（不暴露内部细节）
- ✅ CORS 白名单配置
- ✅ 敏感信息不写入日志
