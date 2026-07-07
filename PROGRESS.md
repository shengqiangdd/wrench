# 智盒 (SmartBox) — 开发进度日志

## 2026-07-07 — 客户端 SQLite 架构迁移 + WASM 修复 ✅

### 🗄️ 客户端 SQLite 架构 — 用户数据隔离

**目标**: 将 Vault、SSH 连接、告警、通知渠道数据从服务端 API 迁移至浏览器端 SQLite（sql.js WASM），实现用户数据完全隔离。

**完成工作**:

| 文件 | 说明 |
|------|------|
| `src/services/client-db.ts` | 核心数据库服务（sql.js WASM） |
| `src/services/client-db-init.ts` | 初始化与加载状态管理 |
| `src/stores/ssh-store.ts` | 重写：SQLite 持久化连接配置 |
| `src/stores/alert-store.ts` | 重写：SQLite 持久化规则与历史 |
| `src/modules/vault/VaultPage.tsx` | 重写：SQLite 存取凭据 |
| `src/modules/notifications/NotificationsPage.tsx` | 重写：SQLite 存取渠道配置 |
| `src/App.tsx` | 更新：启动时异步初始化客户端数据库 |
| `src/services/importExport.ts` | 重写：导出/导入功能适配新架构 |
| `frontend/public/sql-wasm.wasm` | 本地化 WASM 文件 |
| `frontend/public/sql-wasm-browser.wasm` | 浏览器专用 WASM 文件 |

**数据库表结构**:
- `vault_entries` — 凭据存储（id, name, kind, value, tags, created_at, updated_at）
- `connections` — SSH 连接配置（id, name, host, port, username, auth_type, ...）
- `alert_rules` — 告警规则（id, name, metric, condition, threshold, enabled, ...）
- `alert_history` — 告警历史（id, rule_id, severity, message, value, resolved, ...）
- `notification_channels` — 通知渠道（id, name, type, enabled, config, ...）

**验证结果**:
| 测试类型 | 状态 |
|----------|------|
| TypeScript | ✅ 零错误 |
| ESLint | ✅ 零警告 |
| Vitest | ✅ 243/243 |
| Vite Build | ✅ 成功 |
| Client DB 集成测试 | ✅ 34/34 |
| **浏览器基础测试** | ✅ **11/11 通过** |
| **浏览器功能测试** | ✅ **22/22 通过** (Playwright + Chromium headless) |
| **浏览器扩展测试** | ✅ **21/21 通过** (SSH 全生命周期、Vault CRUD、导入导出) |

**关键修复**:
- **WASM 加载失败**: sql.js 在浏览器中请求 `sql-wasm-browser.wasm`，SPA fallback 返回 HTML
- **解决方案**: 复制 `sql-wasm-browser.wasm` 到 `public/` 目录，更新 `locateFile` 使用本地路径

**Git 提交**:
- `dd301bb` fix: bundle sql.js WASM locally for offline browser support
- `57c9dfc` feat: client-side SQLite architecture + SSH fix

---

## 2026-07-04 — 前端三零目标达成 + 全 API 端点覆盖 ✅

### 🏆 前端代码质量里程碑

| 指标 | 结果 | 变化 |
|------|------|------|
| `npx tsc --noEmit` | **0 errors** | 维持 |
| `npx eslint 'src/**/*.{ts,tsx}'` | **0 warnings** | 52 → 0 🎉 |
| `npx vitest run` | **243/243 passed** | 维持 |

**清理清单**:
- `react-hooks/exhaustive-deps`: 27 → 0（17文件修复）
- `react-refresh/only-export-components`: 3 → 0
- `no-explicit-any`（生产代码）: 全面消除
- `no-explicit-any`（测试代码）: 52 → 0

### 🦀 Rust 后端完善 — API 端点 100% 覆盖

完成 Node.js bridge 所有 39 个 REST 端点的 Rust 重写，并额外新增 17+ 功能端点：

**最后补全的 3 个端点**:
- `GET /api/ssh/test-config` — SSH 测试配置（前端依赖）
- `POST /api/docker/rm` — 删除容器
- `POST /api/docker/exec` — 容器内单次命令执行

**Rust 后端全量统计**:
| 指标 | 值 |
|------|-----|
| 源文件 | 56 个 `.rs` 文件 |
| 代码行数 | ~8,151 LOC |
| 单元测试 | 72 个 `#[test]` |
| `cargo check` | ✅ 通过 |
| `cargo clippy -- -D warnings` | ✅ 零警告 |
| Docker 多架构 | ✅ linux/amd64 + arm64 |

**Rust vs Node.js 架构改进**:
| 方面 | Node.js | Rust |
|------|---------|------|
| 内存安全 | JavaScript 运行时 | ✅ 类型系统 + 所有权 |
| 并发 | 单线程 + 回调 | ✅ Tokio async + 多线程 |
| 凭据存储 | 内存明文 | ✅ AES-256-GCM (Secret Vault) |
| 审计日志 | 内存数组 | ✅ SQLite 持久化 |
| 数据库 | 无 | ✅ SQLite (WAL 模式，可选) |
| WebSocket 统计 | REST 轮询 | ✅ 实时推送 |
| CI 门控 | 无 | ✅ `--max-warnings 0` 强制执行 |

## 2026-07-03 — Rust 后端重构完成 ✅

### 🦀 后端重构：Node.js → Rust (Axum + Tokio)

**动机**: 性能提升、内存安全、零运行时依赖、单二进制部署

**完成工作**:

- **14 个功能模块完全对等覆盖**：SSH 会话池/SFTP 缓存复用/Docker 管理/日志系统/WebSocket 终端/插件安装/AI 模型/REST API/SPA 静态托管/认证中间件/速率限制/Shell 注入防护/空闲会话清理/审计日志
- **43 个源文件，~4005 LOC**，`cargo clippy` 零警告，`cargo test` 34 测试全部通过
- **Docker 三阶段构建** (Node→Rust→Debian slim)，最终二进制 **8.8MB**
- **代码质量三零**：TypeScript 零错误 + ESLint 零错误 + Clippy 零警告

**前端增强**:
- 认证框架：`AuthGate` 启动门控 + `auth.ts` 服务 (getToken/refreshToken/authedFetch/buildWsUrl)
- React 19 + Vite 8 + Tailwind v4 全套升级
- 116 个组件测试 + 3 E2E 测试全部通过
- React Compiler 生产启用

**当前状态**: ✅ 三零已实现，CI/CD 自动推送，可直接生产部署

## 2026-06-25 — 🎉 项目完全完工！64/64 (100%) ✅

### 最终归档

一路走来，项目从 0 开始构建，经历了 3 个阶段：

**M3 — SSH + SFTP 核心功能 (27 项)**
- SSH 连接管理 CRUD/分组/快速连接/连接测试
- xterm.js 终端 + 多 Tab/分屏/拖拽合并/同步命令/搜索
- SFTP 文件管理 + 大文件分块 + 递归搜索 + 拖拽上传
- WebSocket 自动重连/心跳保活

**M4 — AI + 插件系统 (20 项)**
- CodeMirror 6 编辑器 + 内容嗅探智能语言识别
- iframe 沙箱插件系统 + 14 个内置插件 + 市场 + 热加载
- AI 侧边栏 + 6 种代码操作 + 流式取消

**M5 — 打磨与发布 (17 项)**
- PWA + 离线优化 + 网络状态指示
- 性能优化（路由分割/Bundle 拆分/虚拟列表）
- 用户体验（主题/命令面板/快捷键/导出导入）
- 全部文档 + CI/CD + Docker 部署

### 代码库指标
- 总计 15+ 个前端模块，7 个 service 层文件，5 个 store
- 后端单文件约 1525 行，覆盖 REST + WebSocket + SSH/SFTP + Docker + 日志
- 14 个内置插件，46 条命令
- 最后 push: `8efd5f1` (日志聚合面板)

## 2026-06-25 — 新功能阶段

### 🐳 Docker 管理面板 ✅
- 后端新增 11 个 API（ps/images/stats/inspect/logs/start/stop/restart/rm/rmi/compose）
- 前端 6 个组件（主页面/容器列表/镜像列表/日志弹窗/详情/类型定义）
- 复用 SSH 连接，零额外依赖，~22kB 总大小（按需懒加载）
- commit: `3246939`

### 📋 日志聚合面板 ✅
- 后端新增 3 个 API（list-sources/tail/grep）
- 前端 4 个组件（主页面/LogViewer/SourceConfig/类型定义）
- 自动发现 20+ 常见系统日志（syslog/auth/nginx/mysql/redis 等）
- 自定义日志源管理（localStorage 持久化）
- 支持 tail 行数切换（50~5000行）、grep 搜索（上下文+大小写控制）、下载
- 双栏布局：左侧日志源树 + 右侧日志查看器
- 构建 9.31s，TypeScript 零错误，13.8kB chunk
- commit: `8efd5f1`

## 2026-06-24 — 搜索功能 + 快捷键列表完成，48/61 (79%) ✅

### 本日完成
- ✅ **SFTP 文件搜索**：本地过滤（输入即过滤）+ 递归搜索（遍历所有子目录匹配文件名），搜索按钮 + Ctrl+F / Ctrl+Enter 快捷键
- ✅ **终端搜索内容**：SearchAddon 搜索面板底部悬浮，Ctrl+Shift+F 打开，Enter/Shift+Enter 上下跳转
- ✅ **快捷键列表展示**：命令面板中「快捷键列表」命令 + Shift+? 快捷键打开模态框，6 组快捷键分类展示
- ✅ **大文件分块上传**：>50MB 自动分块（每块 5MB），后端 SFTP open/write/close + sudo mv，前端分块进度条
- ✅ **分屏窗口拖拽合并**：SplitPane 原生 HTML5 拖拽，25% 边缘检测高亮(cyan)，ref 避免 state 过期，左/右/上/下 4 方向插入
