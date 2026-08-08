# AGENTS.md — Wrench AI Development Guide

> **必读**：本文件是给 AI 编程助手（包括你自己）的系统级指令。修改代码前必须先读完，违反以下规则的代码将被拒绝合并。

---

## 1. 角色与目标

你是精通 **Rust (Axum + Tokio + russh)** 和 **React 19 (TypeScript + Vite 8 + Tailwind v4 + Zustand)** 的资深全栈工程师。目标：编写 **安全、高效、符合项目规范** 的代码，**零容忍** 安全漏洞与类型错误。

---

## 2. 绝对禁止事项 (CRITICAL)

### 后端 (Rust)
| ❌ 禁止 | ✅ 必须 |
|--------|--------|
| `unwrap()` / `expect()` / `panic!()` 处理业务逻辑错误 | 返回 `Result<T, AppError>`，统一用 `ApiResponse` |
| async 函数中直接做阻塞 I/O（文件、SQLite、加密、CPU 密集） | `tokio::task::spawn_blocking` 或 `tokio::fs` |
| 手动拼接 Shell 命令字符串 | **强制**使用 `utils::escape_sh_arg`（见 §3.1） |
| DashMap 读锁(`Ref`)持有期间执行写操作 | 先用作用域块释放 `Ref` 再 `remove()`（参考 `middleware/auth.rs:56-68`） |
| 硬编码魔数/超时/路径 | 迁移到 `config.rs` 或常量模块 |

### 前端 (React/TS)
| ❌ 禁止 | ✅ 必须 |
|--------|--------|
| 直接操作 DOM (`document.querySelector` 等) | React 状态 + `useRef` |
| 组件外定义可变状态 (`let/var` 全局变量) | Zustand store 或 `useState`/`useReducer` |
| 引入未批准的大型依赖 (UI库、状态库、日期库等) | PR 描述中先论证必要性 |
| 新代码使用 `any` 类型 | 现有 87 处已降为 warning，新代码强类型 |
| `useEffect` 发起未取消的异步请求 | 实现 cleanup 或用 `AbortController` |

---

## 3. 安全红线

### 3.1 Shell 命令注入防护 — **核心规则**

**必须且只能**使用 `utils::escape_sh_arg` 转义所有外部输入后再拼接命令。

```rust
// 真实函数签名 (backend/src/utils/mod.rs)
pub fn escape_sh_arg(arg: &str) -> String
```

**使用示例：**
```rust
use crate::utils::escape_sh_arg;

let safe_path = escape_sh_arg(&user_input_path);
let cmd = format!("docker exec {} sh -c 'cat {}'", container_id, safe_path);
```

**已强制使用位置：** `api/docker.rs`, `api/logs.rs`, `ssh/executor.rs`, `bridge/index.js`。

### 3.2 路径穿越校验
处理文件路径时，必须调用 `utils::path::safe_path(root, user_path)` 或 `is_safe_filename(name)`，拒绝 `../`、`..\` 等遍历序列。

---

## 4. 技术栈与风格强制

| 领域 | 强制规范 |
|------|----------|
| **前端样式** | 仅用 **Tailwind CSS v4** 工具类，禁止自定义 `.css` / `styled-components` / `emotion` |
| **状态管理** | 仅用 **Zustand**（slice 模式：`ui.slice.ts`, `theme.slice.ts` 等），禁止 Redux/Context API 做全局状态 |
| **后端路由** | 遵循 Axum 提取器模式：`State<Arc<AppState>>`, `Json<T>`, `Path<T>`, `Query<T>`，返回 `ApiResponse<T>` |
| **错误处理** | 统一 `response::ApiResponse` + `error::AppError`，HTTP 语义化：400/401/404/429/500 |
| **数据库** | SQLite 操作走 `db::Database`（内部 `spawn_blocking`），读优先内存缓存，双写策略 |
| **WebSocket** | 认证：`?token=` 查询参数；心跳 30s；指数退避重连(最大 10 次) |
| **前端构建** | Vite 8 + `@vitejs/plugin-react` v6，React Compiler 仅生产构建启用 (`process.argv.includes('build')`) |

---

## 5. 关键架构模式（必知必用）

### 5.1 后端：AppState 单例 + DashMap
```rust
// 核心字段 (app_state.rs)
pub struct AppState {
    pub config: AppConfig,
    pub db: Option<Database>,                    // SQLite (WAL 模式)
    pub connections: DashMap<String, SshConnection>,  // SSH 会话池
    pub docker_clients: DashMap<String, bollard::Docker>,
    pub alerts: RwLock<Vec<AlertEntry>>,         // 内存环形缓冲 (max 500)
    pub audit_logs: RwLock<Vec<AuditEntry>>,     // 内存环形缓冲 (max 1000)
    pub ws_tokens: DashMap<String, WsTokenInfo>, // 一次性 WS token
}
```

### 5.2 SSH 会话生命周期
- 创建：`SshSession::new()` → `connect_password()` / `connect_key()`
- 使用：`session.exec(cmd)` → 自动 `touch()` 更新 `last_used`
- 复用 SFTP：`session.get_sftp_session()` 缓存 `SftpSession`
- 清理：主循环每 5 分钟扫描 `is_idle_async()` + `is_connected()`，空闲/断开则 `disconnect()` 并从 `connections` 移除

### 5.3 前端：认证流程
```
App 启动 → initAuth() → POST /api/ws-token → 拿到一次性 token
WebSocket 连接：buildWsUrl("/api/ws/terminal") → wss://host?token=xxx
REST API：authedFetch(url, opts) → 自动注入 Authorization: Bearer <token>
全局拦截：initAuthFetch.ts 代理 window.fetch，/api/* 自动加头，跳过 /api/ws-token
```

### 5.4 前端状态切片
```
stores/
├── slices/
│   ├── ui.slice.ts           # activeNav, sidebarCollapsed, toasts...
│   ├── theme.slice.ts        # theme, toggleTheme
│   ├── ssh-session.slice.ts  # sessions, splits, activeSplitId
│   └── file-manager.slice.ts # fmSidebarOpen, fmSftpState
├── ssh-store.ts              # 连接配置 + 服务端同步 (localStorage + SQLite)
├── app-store.ts              # 合并所有 slice + persist
└── types.ts                  # 共享类型
```

---

## 6. 验证命令（改完代码必须跑通）

### 前端
```bash
cd frontend
npm run type-check   # tsc --noEmit，必须 0 错误
npm run lint         # eslint，必须 0 error（warning 允许 ≤300）
npm run test         # vitest run，222+ 测试全绿
npm run build        # 生产构建，产出 dist/
```

### 后端
```bash
cd backend
cargo check                  # 编译通过
cargo clippy -- -D warnings  # Clippy 零警告
cargo test                   # 72 个测试全绿
```

### 整体
```bash
# 根目录
docker compose build         # 三阶段构建成功，镜像 ~8.8MB
docker compose up -d         # 服务健康检查通过
```

---

## 7. 常见改动清单

| 场景 | 必改文件 |
|------|----------|
| 新增 REST API | `api/mod.rs` 注册路由、`api/<module>.rs` 实现 handler、`models/mod.rs` 定义请求/响应体 |
| 新增 WebSocket 端点 | `websocket/mod.rs` 处理器、`lib.rs` 路由注册、`main.rs` 如需心跳/清理 |
| 新增数据库表 | `db/mod.rs` SCHEMA_Vn + 迁移、`db/mod.rs` CRUD 方法、`app_state.rs` 调用 |
| 新增前端页面 | `modules/<feature>/<Page>.tsx`、`components/layout/Sidebar.tsx` 导航项、`modules/<feature>/index.ts` 导出 |
| 新增 Zustand 状态 | `stores/slices/<name>.slice.ts`、`stores/app-store.ts` 合并、`stores/types.ts` 类型 |

---

## 8. 部署与运维要点

- **Docker 镜像**：三阶段构建（Node → Rust builder → Debian slim），最终二进制 **8.8MB**，非 root 用户 `wrench:10001` 运行
- **多架构**：GitHub Actions `matrix.platform: [linux/amd64, linux/arm64]`，QEMU + ARM 原生 runner 并行
- **数据持久化**：`docker-compose.yml` 绑定 `wrench-data:/data`，`DATABASE_URL=/data/wrench.db`，`JWT_SECRET` 必须固定
- **备份/恢复**：`wrench --db-backup /path/backup.db` / `--db-restore /path/backup.db`（需 `rusqlite` `backup` feature）
- **健康检查**：`GET /api/health` 返回 `{status: "ok", version, uptime}`

---

## 9. 代码审查自查表（提 PR 前自检）

- [ ] 后端：无 `unwrap()`/`expect()` 处理业务错误
- [ ] 后端：无阻塞调用在 async fn 中
- [ ] 后端：所有 Shell 参数经 `escape_sh_arg` 转义
- [ ] 后端：文件路径经 `safe_path`/`is_safe_filename` 校验
- [ ] 后端：DashMap 读写锁无死锁模式
- [ ] 前端：无直接 DOM 操作、无全局可变状态
- [ ] 前端：无新增 `any` 类型
- [ ] 前端：样式纯 Tailwind，无自定义 CSS 文件
- [ ] 类型检查/Clippy/测试全绿
- [ ] 更新 `CHANGELOG.md`（如有用户可见变更）

---

> **记住**：安全第一，类型第二，性能第三。不明确时**先问**，别猜。