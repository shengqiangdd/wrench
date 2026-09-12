# 🧊 棘轮工具箱 Wrench

[![Build](https://github.com/shengqiangdd/wrench/actions/workflows/ci.yml/badge.svg)](https://github.com/shengqiangdd/wrench/actions)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

> 基于 Web 的一体化开发工具箱 — 集代码编辑器、SSH 终端、AI 助手、文件管理和插件系统于一体。

---

## ✨ 功能特性

| 功能 | 状态 | 说明 |
|------|------|------|
| 🖥️ **SSH 终端** | ✅ | xterm.js + WebSocket，多连接/多Tab/分屏/同步命令/搜索 |
| 📁 **SFTP 文件管理器** | ✅ | 树形浏览/拖拽上传/大文件分块/递归搜索/右键菜单 |
| 📝 **CodeMirror 编辑器** | ✅ | 20+ 语言语法高亮，内容嗅探智能识别，Markdown 实时预览，IndexedDB 自动保存 |
| 🤖 **AI 侧边栏** | ✅ | OpenRouter API 集成，65+ 模型，选中代码→6 种 AI 操作（解释/重构/修复/优化/注释/翻译），流式取消 |
| 🔌 **插件系统** | ✅ | iframe 沙箱隔离，14 个内置插件（46 条命令），在线市场安装，热加载 |
| 🎨 **主题切换** | ✅ | 亮色/暗色/跟随系统，CSS 变量体系全局生效 |
| ⌨️ **命令面板** | ✅ | Ctrl+P 模糊搜索，快捷键列表（Shift+?），自定义命令 + 变量替换 + 分组管理 |
| 📡 **WebSocket 实时通信** | ✅ | 心跳保活/指数退避重连/单一通道复用 |
| 🐳 **Docker 管理** | ✅ | 容器/镜像/Compose 全生命周期管理 + 实时资源监控（CPU/内存折线图）+ 容器终端 |
| 📦 **PWA 支持** | ✅ | vite-plugin-pwa + Workbox 预缓存，离线体验优化 + 网络状态指示条 |
| 🖱️ **终端分屏** | ✅ | SplitContainer 递归分屏，拖拽合并（4 方向插入），多主机同步命令 |
| 🔒 **安全加固** | ✅ | SSH 凭据 AES-GCM 加密存储，CSP 头，路径穿越防护，插件 iframe 沙箱 |
| 📊 **主机性能看板** | ✅ | 多主机 CPU/内存/磁盘/网络/负载实时监控，SVG Sparkline，Mock 演示模式 |
| 📋 **日志聚合** | ✅ | 多服务器日志源配置，tail 实时跟踪 + grep 搜索，WebSocket 流式传输 |
| ⚡ **批量执行** | ✅ | 选中多台主机并发执行命令，结果汇总展示 |
| 📤 **批量文件分发** | ✅ | 文件上传/下载到多台主机，大文件分块传输 + 进度追踪 |
| 📚 **脚本模板库** | ✅ | 28 条内置命令 + 自定义 CRUD，变量占位符替换，收藏 + 分组管理 |

## 🛠️ 技术栈

```
前端: React 19 + TypeScript 5.9 + Vite 8.1 + CodeMirror 6 + xterm.js + Tailwind CSS 4 + Zustand + lucide-react
后端: Rust 1.96 (Axum + Tokio + russh + tower-http + Serde)
    ├── REST API — 认证 / SSH / SFTP / Docker / 日志 / 插件 / AI / 健康检查
    ├── WebSocket — 交互式终端 / Docker 容器 Shell / 日志尾随 / 心跳
    ├── SSH — 密码/公钥认证 / 会话池 + 空闲清理 / SFTP 缓存复用
    ├── Docker — 容器/镜像/Compose 管理 / docker exec Shell
    ├── 安全 — Bearer Token 认证 / 速率限制 / 命令注入防护 / CSP 头
    └── 日志 — tail 实时跟踪 + grep 搜索 / 1MB 缓冲区上限
部署: Docker + GitHub Actions (三阶段构建, 8.8MB 二进制)
CI: TypeScript 零错误 + ESLint 零错误 + rustfmt/Clippy 零告警 + 124 Rust 测试（107 单元 + 17 集成）+ 291 前端测试

## 🚀 快速开始

### 环境要求

- Node.js 22（与 CI 一致，见 `.github/workflows/ci-frontend.yml`）
- npm（前端唯一包管理器，依赖以 `frontend/package-lock.json` 为准）
- Rust 1.96.1（由仓库根的 `rust-toolchain.toml` 指定，rustup 会自动安装）

### 安装和启动

```bash
# 1. 克隆仓库
git clone https://github.com/shengqiangdd/wrench.git
cd wrench

# 2. 安装前端依赖
cd frontend && npm install

# 3. 配置后端环境变量
cd ../backend && cp .env.example .env
# 编辑 .env：至少设置 JWT_SECRET 与登录密码 WRENCH_AUTH_PASSWORD（openssl rand -base64 32）
# 不设密码也可以：后端会生成随机密码写入数据目录的 auth_password，用 cat 查看即可

# 4. 启动后端（Rust，终端 1）
cargo run

# 5. 启动前端（终端 2）
cd ../frontend && npm run dev

# 6. 访问
open http://localhost:5173
```

### 生产构建

```bash
cd frontend && npm run build
# 输出到 frontend/dist/
# Rust 后端通过 ServeDir 自动托管静态文件
# 之后构建 Rust 后端：cd backend && cargo build --release
```

## 🐳 Docker 一键部署

### 前提条件

- 安装 [Docker](https://docs.docker.com/engine/install/) 和 [Docker Compose](https://docs.docker.com/compose/install/)

### 启动服务

```bash
# 拉取镜像并启动
docker compose pull
docker compose up -d

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

### 访问地址

- 前端：http://localhost:3001
- 健康检查：http://localhost:3001/api/health（与 `/api/auth/login` 并列的公开接口，不需要登录；其余接口与 WebSocket 都要先登录）

> 💡 Docker 镜像由 GitHub Actions 自动构建并推送至 **ghcr.io/shengqiangdd/wrench**，每次推送 `main` 分支都会自动更新 `latest` 标签。

## 🔐 登录认证

Wrench **默认拒绝匿名访问**：除 `/api/health` 外，所有 REST 接口与 WebSocket（终端、日志、Docker 监控）
都要求先登录。因此即使端口直接暴露到公网，未登录的请求也拿不到任何数据或终端。

**密码来源（按优先级）**

1. 环境变量 `WRENCH_AUTH_PASSWORD`
2. 环境变量 `WRENCH_AUTH_PASSWORD_FILE` 指向的文件
3. 数据目录下的 `auth_password` 文件（不存在则自动生成 256 位随机密码并写盘）

```bash
# 自定义密码（写入 .env，不要提交到仓库）
echo "WRENCH_AUTH_PASSWORD=$(openssl rand -base64 32)" >> .env
docker compose up -d

# 查看自动生成的密码
docker exec wrench sh -c 'grep WRENCH_AUTH_PASSWORD /data/.env'
```

**安全特性**

- 登录接口按 IP 限流（8 次/分钟），口令校验使用恒定时间比较，失败只返回统一的 401
- 会话令牌有效期 7 天，仅通过 `POST /api/auth/login` 签发；口令变更后所有旧令牌立即失效（全局登出）
- WebSocket 使用独立的短时令牌（`scope=ws`，10 分钟），不能用于调用 REST 接口
- 未配置密码时后端保持 fail-closed：受保护接口统一返回 503，不会放行匿名请求

> ⚠️ 通过公网访问时请务必使用 HTTPS 反向代理（Caddy/Nginx），否则密码与令牌会以明文经过网络。

## 🧩 插件开发

### 示例插件

```
plugins/
└── my-plugin/
    ├── manifest.json    # 插件清单
    └── plugin.js         # 插件主文件
```

### manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "我的插件",
  "commands": [
    { "id": "my-plugin.run", "name": "运行插件", "icon": "code" }
  ],
  "panels": [
    { "id": "my-plugin.panel", "title": "我的面板", "icon": "folder" }
  ]
}
```

### plugin.js

```javascript
(function() {
  const api = Wrench.getPluginAPI();
  api.registerCommand('my-plugin.run', {
    name: '运行插件',
    execute: () => api.showNotification('插件已运行！', 'success')
  });
  api.registerPanel('my-plugin.panel', {
    title: '我的面板',
    render: (container) => { container.innerHTML = '<h1>Hello!</h1>'; }
  });
})();
```

## 📁 项目结构

```
wrench/
├── backend/       # Rust 后端服务 (Axum + Tokio)
│   ├── src/
│   │   ├── api/           # REST API 路由 (SSH/SFTP/Docker/日志/插件/AI/认证)
│   │   ├── websocket/     # WebSocket handler (终端/Docker Shell/日志尾随)
│   │   ├── ssh/           # SSH 连接池 + SFTP 缓存复用
│   │   ├── docker/        # Docker Engine API 包装
│   │   ├── middleware/    # 认证 (Bearer Token) + 速率限制 (滑动窗口)
│   │   ├── utils/         # 命令转义/路径校验/密码学/验证器
│   │   ├── db/            # SQLite 存储 (插件/用户/AI 配置)
│   │   └── main.rs        # 应用入口 + 路由注册
│   ├── Cargo.toml
│   └── Cargo.lock
├── frontend/               # 前端应用（React SPA）
│   ├── src/
│   │   ├── components/    # 通用组件（CommandPalette, CodeMirrorEditor, PluginSandbox…）
│   │   ├── modules/       # 功能模块
│   │   │   ├── ssh/      #   SSH 终端 + SFTP + 批量执行 + 批量分发
│   │   │   ├── docker/   #   Docker 容器/镜像/Compose/监控
│   │   │   ├── monitor/  #   主机性能看板
│   │   │   ├── logs/     #   日志聚合面板
│   │   │   ├── commands/ #   命令面板 + 脚本模板库
│   │   │   ├── plugins/  #   插件管理 + 市场
│   │   │   ├── settings/ #   设置面板 + AI 配置
│   │   │   └── file-manager/ # 文件管理器
│   │   ├── services/     # 服务层（认证 auth, WebSocket, AI, 导入导出, 安全存储…）
│   │   ├── stores/       # Zustand 状态管理
│   │   └── types/        # TypeScript 类型
│   ├── vite.config.ts    # Vite 8 配置 + PWA + Chunk 分割
│   └── package.json
├── plugins/                # 14 个内置插件
├── docs/                   # 文档（架构/插件 API）
├── .github/                # CI/CD（构建 + Docker + 每周清理）
├── Dockerfile              # 三阶段构建 (Node → Rust → Debian slim)
├── docker-compose.yml      # Docker Compose
├── README.md
├── # docs/DEPLOY.md               # 部署指南
├── # docs/CHANGELOG.md            # 变更日志
├── # docs/CONTRIBUTING.md         # 贡献指南
└── LICENSE                 # MIT
```

## 📄 许可证

[MIT](LICENSE) © 2026 Wrench
