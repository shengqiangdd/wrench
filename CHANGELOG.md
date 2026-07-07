# 📋 变更日志

## [Unreleased] - 客户端 SQLite 架构 + Rust 后端重构

### 🗄️ 客户端 SQLite 架构 — 用户数据隔离 🚀
- **浏览器端 SQLite** — 使用 sql.js (WASM) 在浏览器中运行 SQLite 数据库，实现用户数据完全隔离
- **数据存储** — Vault 凭据、SSH 连接配置、告警规则/历史、通知渠道配置全部迁移至客户端 SQLite
- **IndexedDB 持久化** — SQLite 数据库通过 IndexedDB 持久化，刷新页面不丢失
- **本地化 WASM** — sql.js WASM 文件打包至 public 目录，支持离线使用
- **导入导出** — JSON 格式导出/导入所有客户端数据，支持跨设备迁移
- **数据库表结构**：
  - `vault_entries` — 凭据存储（id, name, kind, value, tags, created_at, updated_at）
  - `connections` — SSH 连接配置（id, name, host, port, username, auth_type, ...）
  - `alert_rules` — 告警规则（id, name, metric, condition, threshold, enabled, ...）
  - `alert_history` — 告警历史（id, rule_id, severity, message, value, resolved, ...）
  - `notification_channels` — 通知渠道（id, name, type, enabled, config, ...）

### ⚡ 后端重构: Node.js → Rust (Axum + Tokio) 🦀
- **全面功能对等重构** — SSH/SFTP/Docker/日志/插件/AI/WebSocket 认证等 14 个模块，54 个源文件，~8,200 LOC
- **性能与安全提升** — 单二进制部署 (8.8MB)，零内存安全漏洞，`cargo clippy -- -D warnings` 零警告通过
- **REST API 完全对等** — 原始 Node.js bridge 的 39 个 REST 端点全部覆盖，新增 17+ 增强端点
  - 最后补全：`GET /api/ssh/test-config`、`POST /api/docker/rm`、`POST /api/docker/exec`
  - Rust 独有：Secret Vault、通知渠道、主机健康看板、审计日志可视化、系统维护 CLI
- **SSH 核心** — russh 密码/公钥认证 + 会话池 + 空闲清理 (5min 定时) + SFTP 会话缓存复用
- **WebSocket** — 交互式终端 / Docker 容器 Shell / 日志尾随 / Docker stats 实时推送 / 心跳保活
- **认证与安全** — Bearer Token 中间件 (JWT 24h) + 速率限制 (60 req/60s 滑动窗口) + 统一 shell 转义函数 + CSP nonce 动态注入
- **SSH 凭据** — AES-256-GCM 加密存储，密钥从 `JWT_SECRET` 派生
- **Rust 单元测试** — 72 个 `#[test]`（app_state/error/response/utils/sftp/auth/rate_limit/db/notify），全部通过
- **遗留清理** — 移除 Node.js bridge 目录（`bridge/index.js` 2293 行 + security.js + package.json）共 4144 行死代码

### 🚀 新增
- 🖥️ **前端认证框架** — `AuthGate` 启动认证门控、`auth.ts` 服务 (getToken/refreshToken/authedFetch/buildWsUrl)
- 🤖 **AI 多服务商支持** — 后端 `fetch-all-models?provider=` 端点，OpenRouter 完整免费/付费模型列表
- 📊 **审计日志扩展** — SSH 连接/断开、Docker 容器启动/停止/重启、插件安装/卸载记录
- 🧹 **代码质量三零里程碑** — TypeScript 零错误 + ESLint **零警告** + Clippy 零警告
  - `react-hooks/exhaustive-deps`: 27→0（17文件修复）
  - `react-refresh/only-export-components`: 3→0
  - `no-explicit-any`（生产代码）: 全面消除
  - `no-explicit-any`（测试代码）: 52→0（块注释策略兼容 Prettier）
  - CI 硬性门槛：`--max-warnings 0` 强制执行，任何新增警告导致构建失败

### 🧪 浏览器功能测试 (Playwright + Chromium headless)
- **22/22 项测试全部通过** — 使用 Playwright 对 SmartBox 应用进行真实浏览器环境功能验证
- **扩展测试 21/21 通过** — SSH 全生命周期、Vault CRUD、通知渠道、导入导出、审计日志
- **App 加载与初始化** — 页面加载正常，无关键错误
- **Client DB (sql.js WASM) 初始化** — 浏览器端 SQLite 数据库正常创建
- **9 个页面导航** — SSH 连接、常用命令、Docker 管理、文件管理、日志聚合、凭据保险箱、通知渠道、审计日志、设置
- **SSH 连接** — 创建连接 → WebSocket 连接 → 终端渲染完整流程
- **SSH 命令执行** — 终端输入输出正常，命令执行结果正确
- **SSH 连接管理** — 创建、编辑（弹窗）、删除（React 状态更新 + 刷新验证）、快速连接
- **Vault 凭据管理** — 主密码创建、凭据添加与显示
- **通知渠道** — 页面加载正常
- **导入导出** — 设置页导出/导入功能可用
- **审计日志** — 页面加载正常
- **关键技术点**：
  - 使用 React Fiber 点击触发 UI 交互（绕过 `overflow-hidden` 阻止）
  - 使用 `nativeInputValueSetter` + `input event` 触发 React 状态更新
  - WebSocket 消息监控验证 SSH 连接流程

### 🏗️ 工程化
- Dockerfile 三阶段构建优化 (Node→Rust→Debian slim)，最终二进制 8.8MB
- **Rust 分层缓存**：虚拟空源码编译依赖 → 覆盖真实源码增量编译 app，冷构建从 ~60min 降至 ~5min
- **Registry 缓存后备**：`cache-from: type=registry` 兜底 GHA cache 被逐出场景
- **CI 加固**：`timeout-minutes: 120` 防任务卡死，`CARGO_NET_RETRY=5` + `CARGO_HTTP_TIMEOUT=120` 防网络超时
- **前端性能**
  - React Compiler（`babel-plugin-react-compiler`）生产环境启用自动记忆化
  - 生产环境关闭 Source Map（节省 ~5MB dist 体积）
  - 移除 3 个未使用生产依赖：`clsx`、`@xterm/addon-web-links`、`tailwind-merge`
  - 保留 `idb`（被 `src/services/db.ts` 使用）
- Swatinem/rust-cache@v2 加速 Rust CI 构建
- CHANGELOG.md、README.md、PROGRESS.md、DEPLOY.md 全面更新

---

## [0.3.0] - 2026-06-25

### ⚡ 依赖大升级
- **Vite 6 → 8** — 构建时间从 10.30s 降至 0.60s（**17x 提速**），esbuild minify 替代 terser
- **React 18 → 19** — 全家桶升级至 19.2.7
- **Tailwind CSS 3 → 4** — JS 配置迁移至 CSS `@theme` + `@utility`，移除 tailwind.config.js / postcss.config.js / autoprefixer
- **lucide-react 0.460 → 1.21** — 图标库全面更新
- **14 个存量 TypeScript 类型错误全部修复**，tsc 零错误零警告

### 🚀 新增
- 🐳 **Docker 管理面板** — 容器/镜像/Compose 全生命周期管理，11 个 REST API
- 🐳 **Docker 容器终端** — `docker exec -it` WebSocket 流式终端
- 🐳 **Docker 实时资源监控** — CPU/内存 SVG 折线图，多容器选择，2s 轮询/120 点历史窗口
- 📋 **日志聚合面板** — 多服务器日志源配置，tail 实时跟踪 + grep 搜索，WebSocket 流式传输
- ⚡ **跨服务器批量执行** — 选中多台主机并发执行命令，结果汇总展示
- 📤 **批量文件分发** — 文件上传/下载到多台主机，大文件分块传输 + 进度追踪
- 📚 **脚本模板库** — 28 条内置命令 + 自定义 CRUD，变量占位符替换，收藏 + 分组管理
- 📊 **主机性能看板** — 多主机 CPU/内存/磁盘/网络/负载实时监控，SVG Sparkline，Mock 演示模式
- 📝 **Markdown 实时预览** — 零外部依赖 MD→HTML 渲染器，CodeMirror 集成 👁️ 切换按钮
- 🔍 **内容嗅探** — shebang + magic bytes + 已知文件名，自动识别 40+ 种文件类型
- 🔒 **安全加固** — SSH 凭据 AES-GCM/PBKDF2 加密存储，CSP 头，路径穿越防护
- 🎨 **Docker Toast 交互反馈** — 浮动通知系统（成功/错误/信息三层样式）
- 📦 **Dependabot** — 自动监控前端/后端/npm 及 GitHub Actions 依赖更新
- 🏗️ **CI/CD 增强** — Docker 多架构构建，每周镜像清理，workflow_dispatch 手动触发

### 🏗️ 工程化
- `.dockerignore` 新增，构建上下文从 ~200MB 降至 ~3MB
- Dockerfile 多阶段构建优化：依赖缓存层分离 + `npm ci` + npm 官方源
- CodeMirror chunk 三分割：core / langs / langs-extra，首屏按需加载
- 分块上传远程临时文件兜底清理（断连/失败自动 `rm -f`）

---

## [0.2.0] - 2026-06-24

### 🚀 新增
- ✂️ **终端分屏** — SplitContainer 递归分屏，水平/垂直混合，拖拽合并（4 方向插入）
- 🔄 **多主机同步命令** — syncGroup 广播机制
- 🔍 **SFTP 文件搜索** — 本地过滤 + 递归搜索（深度限制 5 层），Ctrl+F / Ctrl+Enter 快捷键
- 🔍 **终端内容搜索** — SearchAddon + 底部搜索面板，Ctrl+Shift+F 快捷键
- ⌨️ **快捷键列表展示** — Shift+? 打开模态框，6 组快捷键分类
- 📤 **拖拽上传** — 系统文件拖入 + 进度条 + 完成弹窗
- 📦 **大文件分块上传** — >50MB 自动分 5MB 块，SFTP open/write/close + sudo mv
- 🎯 **命令面板增强** — 自定义命令 CRUD，变量占位符替换弹窗，导入导出
- 📐 **面板拖拽调整宽度** — 左右面板拖动调节 + 双击重置
- 💾 **配置导入/导出** — SSH 连接 / AI 配置 / 插件列表 / UI 偏好，AES-GCM 加密/明文导出
- 🔌 **插件热加载** — fs.watch 监听 + WebSocket 广播 plugins-changed + 前端自动重载
- 🛒 **插件市场** — 在线安装/更新/卸载插件
- 🤖 **AI 流式取消** — AbortController 中止，保留已生成内容
- 🔒 **上传重名确认** — 拖拽/点击上传前检查目标目录同名文件

### 🏗️ 工程化
- **路由级代码分割** — React.lazy + Suspense，所有页面模块独立 chunk
- **Bundle 优化** — manualChunks 拆分 xterm / CodeMirror / router / zustand / lucide / idb
- **虚拟列表** — VirtualList 组件，100 项阈值自动切换
- **离线体验优化** — 网络状态指示条（在线/离线实时监测 + 提示）

---

## [0.1.2] - 2026-06-23

### 🚀 新增
- **CodeMirror 6 编辑器组件** — 支持 8 种语言语法高亮、IndexedDB 自动保存、文件树集成
- **AI 侧边栏** — OpenRouter API 集成（默认 `google/gemma-4-27b-it:free`），选中代码一键 AI 优化
- **完善的插件系统** — 5 个示例插件（JSON 格式化、Base64 编解码、时间戳转换、正则测试器、二维码生成）
- **全局 SmartBox API** — `SmartBox.getPluginAPI()` 供插件调用

### 🐛 修复
- **插件页面** — 替换静态占位组件为真实 PluginsPage，从后端加载插件清单
- **WebSocket 升级冲突** — 使用 noServer 模式，只对 `/ws` 路径升级
- **终端快捷键冲突** — CommandPalette 增加 isTerminalFocused 检测

### 📚 文档
- 完善 README.md、DEPLOY.md、CHANGELOG.md
- 添加 CONTRIBUTING.md 贡献指南
- 添加 MIT LICENSE

### 🏗️ 工程化
- 添加 GitHub Actions CI（自动构建）
- Docker + Docker Compose 一键部署
- Dockerfile 优化（多阶段构建）
- .gitignore 完善

---

## [0.1.1] - 2026-06-23

### 🚀 新增
- **后端 HTTP API** — `/api/plugins`、`/api/health` 路由
- **全局 API** — `SmartBox.getPluginAPI()` 实现
- **插件管理器** — `pluginManager.ts` 加载器
- **插件页面** — 真实组件替换

### 🐛 修复
- 插件系统从后端加载插件清单

---

## [0.1.0] - 2026-06-23

### 🚀 初始发布

#### 核心功能
- 🖥️ **SSH 终端** — xterm.js + node-pty，多连接管理
- 📁 **文件管理器** — 文件树浏览、操作
- 🎨 **主题切换** — 亮色 / 暗色双主题
- ⌨️ **命令面板** — Ctrl+P 搜索和执行
- 📡 **WebSocket 实时通信** — 实时消息
- 🔌 **插件系统框架** — 插件目录扫描、manifest 定义

#### 示例插件
- JSON 格式化
- Base64 编解码
- 时间戳转换
- 正则测试器
- 二维码生成

#### 工程化
- 前端：React 18 + TypeScript + Vite 6 + Tailwind CSS 3
- 后端：Node.js + WebSocket + ssh2
- 状态管理：Zustand
