# 棘轮工具箱 (Wrench) 架构文档

> 本文档描述 Wrench 的整体架构、技术选型、模块划分和关键设计决策。
> **最后与代码核对：2026-09-13。文档与实现不一致时，以代码为准** —— 发现偏差请直接改本文档。

---

## 1. 整体架构概览

Wrench 采用 **前后端分离 + WebSocket 实时通道** 架构：后端是单个 Rust 进程，
同时提供 REST API、WebSocket 和前端静态文件；SSH / SFTP / Docker 等远程操作**全部由后端代理**。

```
┌──────────────────────────────────────────────────────────┐
│                     浏览器 (React SPA)                    │
│  SSH 终端 │ 文件管理 │ Docker │ Vault │ 通知 │ 审计 │ 插件  │
│        ┌───┴─────────┴────────┴───────┴──────┴─────┐      │
│        │ authedFetch: Bearer <会话JWT> + X-Space-Code│     │
│        │ WebSocketService: /ws?token=<ws-token>     │      │
│        └───────────────────┬───────────────────────┘      │
└────────────────────────────┼──────────────────────────────┘
                    HTTP / WebSocket
┌────────────────────────────┼──────────────────────────────┐
│             Rust 后端 (wrench-backend, axum + tokio)       │
│  中间件链：auth（scope 校验 + SpaceCtx 注入）→ 限流 → trace  │
│  ┌────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │ api/*      │ │ websocket/*  │ │ ssh/* (russh 会话池)  │ │
│  │ REST 分组  │ │ 终端/日志/stats│ │ SFTP / known_hosts   │ │
│  └────────────┘ └──────────────┘ └──────────────────────┘ │
│  ┌────────────────────┐ ┌───────────────────────────────┐ │
│  │ docker/* (bollard) │ │ db (rusqlite, 按 space_id 隔离) │ │
│  └────────────────────┘ └───────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
         │                              │
      SSH 主机                    Docker daemon
```

**核心原则**：

- **前端渲染、后端计算** — 前端只做 UI 与状态，SSH/SFTP/Docker 等远程操作一律经后端代理；
  连接凭据默认保存在浏览器本地（IndexedDB），服务端只另存 Vault 里的加密条目
- **REST 管配置、WS 管实时** — 连接管理/Vault/通知用 REST；终端交互、日志、容器指标用 WebSocket
- **隔离强制在 SQL 层** — 每张业务表都带 `space_id`，数据访问方法签名要求 `space_id`，漏传即编译失败

---

## 2. 技术栈

### 前端

| 技术 | 版本 | 用途 |
|---|---|---|
| **React** | 19 | UI 框架（含 React Compiler） |
| **Vite** | 8 | 构建工具 |
| **TypeScript** | 5.7 | 类型安全 |
| **TailwindCSS** | 4 | 样式（`@tailwindcss/vite` 插件） |
| **Zustand** | 5 | 状态管理（slice 模式） |
| **React Router** | 7 | 路由 |
| **CodeMirror** | 6 | 代码编辑器（多语言包） |
| **xterm.js** | 6 | 终端模拟器（fit/search/webgl 插件） |
| **sql.js / idb** | — | 浏览器侧数据（IndexedDB） |
| **Vitest / Playwright** | 4 / 1.x | 单元测试 / E2E |
| **vite-plugin-pwa** | — | PWA 离线缓存 |

### 后端

| 技术 | 版本 | 用途 |
|---|---|---|
| **Rust** | 1.96.1（`backend/rust-toolchain.toml`） | 运行时，edition 2024 |
| **axum** | 0.8 | HTTP / WebSocket 框架 |
| **tokio** | 1 | 异步运行时 |
| **tower-http** | 0.7 | trace / cors / gzip / request-id / fs |
| **rusqlite** | 0.40（bundled） | SQLite 持久化（WAL） |
| **russh / russh-sftp** | 0.62 / 2.3 | 纯 Rust SSH 客户端 + SFTP |
| **bollard** | 0.21 | Docker Engine API |
| **jsonwebtoken** | 10 | 会话 / WS 令牌（分 scope） |
| **aes-gcm + pbkdf2 + sha2 + hmac** | — | Vault 加密、口令哈希、空间码哈希 |
| **lettre / reqwest** | — | 邮件通知 / 外部 HTTP（AI、插件市场） |

---

## 3. 前端模块划分

```
frontend/src/
├── components/          # 通用组件
│   ├── layout/          # Layout / Sidebar / MainContent
│   ├── AuthGate.tsx     # 入口网关：首次设置 / 登录 / 会话恢复
│   ├── CodeMirrorEditor.tsx, MarkdownPreview.tsx, CommandPalette.tsx
│   ├── ConfirmModal.tsx, ResizablePanel.tsx, Skeleton.tsx, Toast.tsx
│   ├── PluginSandbox.tsx, VirtualList.tsx, NetworkQualityIndicator.tsx
│   └── agent/           # AI 侧边栏相关
├── modules/             # 业务模块（React.lazy 懒加载）
│   ├── ssh/             # 连接管理 + xterm 终端 + SFTP + 分屏
│   ├── file-manager/    # 独立本地文件管理器
│   ├── docker/          # 容器 / 镜像 / Compose
│   ├── logs/            # 日志源浏览与检索
│   ├── monitor/         # 主机健康与指标
│   ├── notifications/   # 通知渠道与告警
│   ├── vault/           # Secret Vault（加密凭据）
│   ├── audit/           # 审计日志
│   ├── commands/        # 常用命令
│   ├── plugins/         # 插件管理 + 市场
│   └── settings/        # 设置（含「我的空间」：空间码/轮换/认领）
├── services/            # 数据/服务层
│   ├── auth.ts          # 会话、空间码、失效处理
│   ├── initAuthFetch.ts # 代理 window.fetch，为 /api/* 自动加头
│   ├── websocket.ts     # WS 客户端（重连/心跳/事件分发）
│   ├── client-db.ts     # sql.js 客户端数据库
│   ├── secure-store.ts  # 凭据的本地安全存储
│   ├── ssh-session-manager.ts, ssh-ensure.ts
│   ├── pluginManager.ts, pluginSandboxManager.ts
│   └── ai-operations.ts, importExport.ts, event-bus.ts
├── stores/              # Zustand
│   ├── slices/          # ui / theme / ssh-session / file-manager
│   ├── app-store.ts, ssh-store.ts, file-store.ts
│   ├── plugin-store.ts, ai-store.ts, alert-store.ts
│   └── types.ts
├── hooks/               # 复用逻辑（如 useSshHostSelector）
├── App.tsx, main.tsx, global-api.ts, index.css
└── test/                # Vitest（components/ services/ stores/ utils/）
```

### 3.1 关键模块职责

- **`components/AuthGate.tsx`** — 启动时先问 `/api/auth/status`：未配置口令 → 「首次设置」（要一次性
  setup token）；已配置 → 登录；已有有效会话 → 直接进入。登录后才挂载主应用。
- **`modules/ssh/`** — Wrench 核心：`ConnectionList`（CRUD/分组/搜索）、`ConnectionForm`、
  `Terminal`（xterm + WS，分屏与同步命令）、`SftpBrowser`/`SftpSidebar`、`AiSidebar`、
  `SshPlaceholder`（终端 Tab + 文件浏览器容器）。
- **`modules/settings/`** — 含 `AccountSection`：查看空间信息、粘贴空间码进入已有空间、
  轮换空间码、修改入口口令。

---

## 4. 后端模块划分

```
backend/src/
├── main.rs / lib.rs     # 入口与路由装配（build_app）
├── app_state.rs         # AppState 单例：db / config / 会话池 / 插件 / 认证运行时
├── config.rs            # 环境变量解析（含口令来源与 fail-closed 语义）
├── space.rs             # 空间：SpaceCtx、空间码生成/哈希/轮换、legacy 认领
├── db/mod.rs            # rusqlite：schema 迁移（V1..V7）、按 space_id 分域的数据访问
├── middleware/          # auth（scope + SpaceCtx）/ rate_limit / cors / logging
├── api/                 # REST handler，按业务域一文件一域
│   ├── auth.rs, space.rs, connections.rs, ssh.rs, sftp.rs
│   ├── docker.rs, logs.rs, hosts.rs, host_health.rs, monitor.rs
│   ├── vault.rs, notifications.rs, alerts.rs, scripts.rs
│   ├── plugins.rs, market.rs, ai.rs, system.rs, health.rs
├── websocket/           # terminal / logs / docker_stats（+ batch 聚合）
├── ssh/                 # client（连接）/ pool（会话池）/ session / executor
│                        # sftp / sftp_ops / known_hosts（原子写）
├── docker/              # container / image / compose / stats（bollard 封装）
├── notify.rs            # 邮件等通知发送
└── utils/               # crypto（PBKDF2/AES-GCM/恒定时间比较）、jwt、path、validator
```

### 4.1 HTTP 路由（按认证层级分组）

| 分组 | 前缀 | 认证 | 代表路由 |
|---|---|---|---|
| **Public** | `/api` | 无 | `/health`、`/auth/status`（供前端判断显示「首次设置」还是「登录」） |
| **Login / Setup** | `/api` | 无会话，但独立限流（8 次/分钟/IP） | `/auth/login`、`/auth/setup` |
| **Protected** | `/api` | 会话 JWT（`scope=api`）+ `SpaceCtx` | `/auth/me`、`/auth/password`、`/ws-token`、`/audit-logs`、`/hosts*`、`/connections*`、`/vault*`、`/notifications*`、`/sftp/*`、`/docker/*`、`/logs/*`、`/plugins*`、`/ai/*`、`/space/{me,rotate,attach}`、`/system/db-info` |
| **WebSocket** | `/ws` | 会话 JWT 或短时 ws token（`scope=ws`） | `/ws`、`/ws/terminal`、`/ws/logs`、`/ws/docker/stats` |
| **Static** | `/*` | 无 | `frontend/dist` 静态资源 + SPA fallback |

未匹配的 `/api/*` 一律 **404 JSON**（不会被 SPA fallback 兜成 `200 + index.html`，避免打错路径被误判为成功）。

### 4.2 WebSocket 消息协议

所有消息为 JSON，含 `type` 字段路由。

**客户端 → 服务器**：`auth`（password / privateKey）、`resize`（调整终端尺寸，含 cols/rows）、
`data`（终端输入，base64）、`exec`、`ping`、`test`、`sftp`（见下）、`sftp-ready`、`sftp-close`。

**SFTP 子操作（`sftp.operation`）**：`list`、`stat`、`read`、`write`、`mkdir`、`rmdir`、`unlink`、
`rename`、`chmod`、`chunk_start` / `chunk_append` / `chunk_finish`（大文件分块上传，每块 ≤5MB）。

**服务器 → 客户端**：`auth-result`、`data`（终端输出，base64）、`exec-result`、`test-result`、
`sftp-result`、`error`。

> 终端的 PTY 尺寸由前端在 `connect`/`resize` 时带上 cols/rows，后端用窗口变更接口同步给远端 —— 
> 尺寸不同步会让 `docker compose` 之类的进度重绘在窄终端里错位（历史踩坑，见 CHANGELOG）。

---

## 5. 数据流

### 5.1 SSH 终端连接

```
xterm.js ──键入──► WebSocketService ──► /ws?token=<ws-token>
                                          │ 中间件：校验 scope=ws + 解析 SpaceCtx
                                          ▼
                                   websocket/terminal.rs
                                          │ 复用/新建会话
                                          ▼
                                   ssh/pool.rs（russh 会话池，空闲 5 分钟回收）
                                          │
                                     远端 SSH 主机
                                          │ 输出
xterm.js ◄── base64 输出帧 ◄── terminal.rs ◄┘
```

### 5.2 分屏同步命令

```
┌────────┐   ┌────────┐   ┌────────┐
│TerminalA│  │TerminalB│  │TerminalC│
└───┬────┘   └───┬────┘   └───┬────┘
    │ 同组       │            │
    └────────────┴────────────┘
        onTerminalData(data) 广播到同组所有实例
```

每个分屏保持独立的 WebSocket 连接，仅输入层按 `syncGroup` 广播。

### 5.3 AI 代码操作

```
选中代码 → AI 操作菜单 → POST /api/ai/chat（后端代理）→ OpenRouter
                                                   │ 流式
用户 ← 流式 diff 对比 ← 一键应用
```

后端持有 `OPENROUTER_API_KEY`，浏览器不接触第三方密钥。

---

## 6. 状态管理

Zustand，按业务域拆分（`stores/`）：

- **`app-store.ts`** — 合并各 slice：`theme`、`activeNav`、`sidebarCollapsed`、命令面板、toast
- **`ssh-store.ts`** — `connections`（本地 IndexedDB 持久化 + `Map` 索引）、`sessions`、`currentSftpPath`
- **`file-store.ts`** — 编辑器 Tab、内容自动保存
- **`plugin-store.ts` / `ai-store.ts` / `alert-store.ts`** — 插件启停、AI 配置与对话、告警

持久化分两层：

| 数据 | 位置 | 隔离边界 |
|---|---|---|
| 界面偏好、插件启停 | 浏览器 local / IndexedDB | 浏览器 |
| 连接配置、编辑器内容 | 浏览器 IndexedDB（`client-db.ts`） | 浏览器 |
| 服务端业务数据（连接元数据、Vault、定时任务、通知渠道、告警、审计、执行历史） | 服务端 SQLite | **空间（`space_id`）** |

---

## 7. 安全设计

### 7.1 认证与令牌

- **入口口令**只负责挡住公网扫描者，不是权限模型。口令以 **PBKDF2-HMAC-SHA256（60 万次迭代 + 随机盐）**
  存库，明文不落盘；也可用 `WRENCH_AUTH_PASSWORD` 环境变量（legacy 覆盖，改它会让旧令牌立即失效）。
- 首次部署不设口令 → **首次设置模式**：启动日志打印一次性 `setup token`，网页粘贴即可设口令。
- **令牌分 scope**：会话 JWT（`api+ws`，7 天 / 记住设备 30 天）、WS 短时令牌（`ws`，10 分钟，
  降低 URL 查询串泄露的影响）；中间件按路径校验，`/ws*` 需 `ws`，其余 REST 需 `api`。
- 登录接口独立限流（8 次/分钟/IP），口令校验恒定时间比较，失败统一 401。
- 改口令 = `token_version` 递增 → 所有旧令牌立即失效，但**不影响任何人的空间数据**。
- **fail-closed**：口令未配置或数据库不可用时，受保护接口一律 503，绝不放行匿名请求。

### 7.2 空间隔离（多人共用，无角色）

- 每个浏览器首次访问自动获得**自己的空间**（`space_id`）；凡是能过入口口令的人一律平等，无管理员。
- 7 张业务表带 `space_id`（`SCHEMA_V6`）：`ssh_connections`、`vault_entries`、`scheduled_tasks`、
  `alerts`、`notification_channels`、`task_execution_history`、`audit_logs`；`SCHEMA_V7` 把
  `ssh_connections` / `vault_entries` / `notification_channels` 的主键改成复合 `(space_id, id)`，
  这样跨空间同名 id 不会互相覆盖。
- 隔离点在 **db 层**：数据访问方法签名强制 `space_id`，handler 从 `Extension<SpaceCtx>` 取，漏传即编译失败。
- **空间码** 256 bit 随机，服务端只存 SHA-256，明文只在创建/轮换时下发一次；Cookie 带
  `HttpOnly` + `SameSite=Lax`（HTTPS 下再加 `Secure`），同时支持 `X-Space-Code` 头。
- 升级前的历史行（`space_id = ''`）由 `legacy` 空间的一次性认领码交接。
- **不提供整库导出**：多人共用下 `/api/system/db-download` 之类的接口等于泄露所有人的凭据，已删除。

### 7.3 凭据与 Vault

- **Secret Vault** 条目以 **AES-256-GCM** 加密后存服务端（密钥由 `VAULT_KEY` 派生，
  未设置时回退到 `JWT_SECRET`），按空间隔离。
- SSH 连接记录（`ssh_connections`）保存主机/端口/用户名/`config` 等元数据。**注意**：
  `POST /api/connections` 会原样保存 `config` 里的 `password` / `private_key`（**不加密**）。
  当前前端只在 `useSshHostSelector` 里**读取**该接口，不写入 —— 也就是说这个写路径目前没有客户端在用。
  若将来要用它同步连接，请先改成只存 `vault_entry_id` 引用，不要把明文凭据交给服务端。
- 推荐 SSH 认证优先使用 **ed25519 密钥**（纯签名算法，不受 rsa 已知无补丁漏洞影响）。

### 7.4 插件沙箱

- 插件运行在 `<iframe sandbox="allow-scripts">` 中：无 DOM 访问、无全局变量、无 Node.js API。
- 通过 `postMessage` 与主应用通信；插件代码经 Blob URL 注入，无文件系统写入权限。
- 插件 ID/路径做校验，禁止路径穿越。

### 7.5 已知风险（接受并记录，不在本轮修）

1. 上面 7.3 提到的 `/api/connections` 明文 `config` 写路径（当前无调用方）。
2. `rsa` 的 `RUSTSEC-2023-0071`（Marvin 攻击）上游无补丁，已在 `backend/.cargo/audit.toml` 显式豁免，
   缓解措施是优先改用 ed25519。
3. 经公网访问必须配 HTTPS 反向代理，否则口令与令牌明文过网。

---

## 8. 性能设计

- **路由级代码分割** — 各业务模块通过 `React.lazy` 懒加载，首屏只加载当前模块。
- **虚拟列表** — 自研 `VirtualList`，超过 100 项仅渲染可见行 + 前后缓冲（SFTP、日志、连接列表）。
- **静态资源缓存** — 后端按文件类型下发 `Cache-Control`：带内容哈希的资源长缓存，`index.html` 不缓存。
- **响应压缩** — API 响应 gzip（≥512B）；静态资源支持 br/gzip 预压缩文件。
- **PWA 离线缓存** — `vite-plugin-pwa` + Workbox 预缓存静态资源。
- **构建体积** — `target/` 通过 `.cargo/config.toml` 控制（关增量、strip 符号），避免历史峰值 21GB。

---

## 9. 关键决策记录 (ADR)

### ADR-1: 后端语言 —— Rust 模块化（取代早期 Node 单文件原型）

**决策**: 后端为 Rust（axum + tokio）按业务域分模块，单一二进制产物。

**原因**: SSH/SFTP/Docker 全是 IO 密集并发场景，需要可预测的内存与零 GC 抖动；多用户隔离要求
把「数据访问必须带 `space_id`」变成**编译期**约束，这在动态语言里做不到。早期 Node 单文件
（`bridge/index.js`）仅存在于原型阶段，已被完全替换。

### ADR-2: WebSocket 单一通道 vs 多通道

**决策**: 同一类实时能力（终端、日志、容器指标）各用一条专用 WS 路由，共用同一套鉴权中间件。

**原因**: 终端与 SFTP 复用同一条 `/ws` 连接（按 `type` 路由），避免连接爆炸；日志与容器指标
数据量大、频率高，单独路由便于各自限流与背压。

### ADR-3: Zustand vs Redux/Context

**决策**: Zustand（slice 模式）。

**原因**: 类型安全、零样板、selector 粒度订阅避免无谓重渲染。

### ADR-4: 原生虚拟滚动 vs 第三方库

**决策**: 自研 `VirtualList`，零外部依赖。

**原因**: 行高固定的场景实现简单，与项目轻量化理念一致。

### ADR-5: iframe 沙箱 vs Web Worker

**决策**: iframe 沙箱。

**原因**: Web Worker 无法操作 DOM；iframe 提供完整隔离且可用 `postMessage` 通信。

### ADR-6: 多人共用 —— 无角色、自动私有空间

**决策**: 不做用户/角色体系，首访自动建空间，靠 256 bit 空间码找回；隔离强制在 SQL 层。

**原因**: 需求是「能进门的人一律平等，各自用各自的机器」。引入账号体系会带来注册/找回/权限矩阵
等一堆运维负担，而空间码 + 哈希存储能以最小代价满足「互相看不见」，且部署者也无法进入他人空间。
入口口令与空间密钥解耦，改口令不掉任何人的数据。

### ADR-7: 未配置口令时 fail-closed

**决策**: 口令未配置（或数据库不可用）时，受保护接口一律 503，只放行 `/api/auth/status` 与 `/api/auth/setup`。

**原因**: 「默认放行」在公网等同于裸奔。宁可让部署者看着日志里的 setup token 走一次首次设置，
也不能出现匿名可用的窗口期。

---

## 10. 插件系统架构

```
主应用 ←→ pluginSandboxManager（管理多个 iframe）
              ├── PluginSandbox A
              ├── PluginSandbox B
              └── PluginSandbox C ...
```

通信协议（`postMessage`）：`sandbox-ready`、`registerCommand`、`setEditorContent`、
`getEditorContent`、`notification`。详细 API 见 [PLUGIN_API.md](./PLUGIN_API.md)。

---

## 11. 部署架构

```
浏览器 ──HTTPS──► 反向代理(Caddy/Nginx) ──► Wrench 容器 (axum) ──► SSH 主机 / Docker daemon
                                              │
                                     /data/wrench.db (SQLite, 卷 wrench-data)
                                     frontend/dist（后端静态托管）
```

- 单容器部署：`docker compose up -d`（镜像由 GitHub Actions 构建并推送到 GHCR）。
- 数据落在命名卷 `wrench-data`；`DATABASE_URL` 指向库文件，**没有可用数据库时空间隔离无法保证
  （受保护接口 503）**。
- 容器以最小权限运行（`cap_drop: ALL`），日志走 json-file 并限制大小（10MB × 3）。
- 健康检查：`/api/health`（`timeout: 10s` / `retries: 3` / `start_period: 15s`）。

详细部署步骤、环境变量表与安全建议见 [DEPLOY.md](./DEPLOY.md)。
