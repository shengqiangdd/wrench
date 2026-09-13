# 🤝 贡献指南

感谢您对棘轮工具箱 Wrench 的关注！欢迎参与贡献。

## 🐛 报告问题

1. 使用 [GitHub Issues](https://github.com/shengqiangdd/wrench/issues) 提交
2. 使用模板描述问题，包括：
   - 环境信息（操作系统、Node.js 版本、浏览器版本）
   - 复现步骤
   - 期望行为和实际行为
   - 截图（如适用）

## 💡 功能建议

同样通过 Issues 提交，标签选择 `enhancement`。

## 🛠️ 提交代码

### 前置要求

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | 22 | 与 CI（`.github/workflows/ci-frontend.yml`）一致 |
| npm | 随 Node | **前端唯一包管理器**：依赖以 `frontend/package-lock.json` 为准，CI 用 `npm ci` |
| Rust | 1.96.1 | 由仓库根的 `rust-toolchain.toml` 指定，rustup 会自动装上 rustfmt / clippy |

只想把服务跑起来，用 `docker compose up -d` 即可，不需要本地工具链。

### 分支规范

- `main` — 稳定版，也是 PR 的目标分支（仓库没有 `dev` 分支）
- `feature/xxx` — 新功能
- `fix/xxx` — 修复
- `docs/xxx` — 文档更新

### 开发流程

1. Fork 仓库并创建分支
2. 安装前端依赖：`cd frontend && npm install`
3. 起两个终端跑开发服务器（Vite dev server 默认 5173，并把 `/api`、`/ws` 代理到后端 3001）：
   ```bash
   # 终端 1：Rust 后端
   cd backend && cargo run

   # 终端 2：前端
   cd frontend && npm run dev
   ```
4. 提交 PR 到 `main` 分支

### 提交前门禁（与 CI 相同）

本地把下面这些命令跑一遍，CI 里跑的就是同一组：

```bash
# 前端
cd frontend
npm run lint          # ESLint（--max-warnings 0）
npm run format:check  # Prettier
npm run type-check    # tsc --noEmit
npm run test:unit     # Vitest
npm run build         # Vite 生产构建

# 后端（首次会由 rustup 自动装 1.96.1 工具链）
cd backend
cargo fmt --all --check                               # 格式化（配置见 backend/rustfmt.toml）
cargo clippy --all-targets --locked -- -D warnings -A clippy::needless_update -A clippy::field_reassign_with_default
                                                      # 告警即错误（后两个 -A 与 CI 保持一致，缺了会误报）
cargo test --all-targets --locked                     # 单元测试 + tests/ 集成测试
```

可选：装上仓库自带的 pre-commit 钩子，提交前自动跑前端 tsc / ESLint / Prettier / Vitest
和后端 rustfmt：

```bash
git config core.hooksPath .githooks
```

### 提交信息规范

```
<type>(<可选 scope>): <简短描述>

<详细描述（可选）>
```

- 类型：`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `ci`
- scope 写受影响的模块，如 `auth`、`ssh`、`terminal`、`api`、`frontend`、`backend`
- 破坏性变更在类型后面加 `!`，例如 `fix(auth)!: 关闭无认证签发全权 JWT`

## 📐 代码风格

- TypeScript：严格模式
- 组件：函数式组件 + Hooks
- 状态管理：Zustand
- 样式：Tailwind CSS
- Rust：以 `cargo fmt`（`backend/rustfmt.toml`）和 clippy 零告警为准

细节约定见 `docs/BACKEND_CONVENTIONS.md`、`docs/FRONTEND_CONVENTIONS.md` 和 `docs/TESTING_STRATEGY.md`。

## 📄 许可证

提交代码即表示您同意您的贡献基于 [MIT](LICENSE) 许可证发布。
