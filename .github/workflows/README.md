# CI/CD Workflows

## 自动触发

| Workflow | 触发条件 | 说明 |
|----------|----------|------|
| `ci-frontend.yml` | `frontend/**` 改动 | 前端 lint、格式化、类型检查、单元测试、构建 |
| `ci-backend.yml` | `backend/**` 改动 | 后端 rustfmt、编译、Clippy、单元测试 |
| `docker-build.yml` | `backend/**` 或 `frontend/**` 改动 | 多架构 Docker 镜像构建并推送 |
| `ci-audit.yml` | `package-lock.json` 或 `Cargo.lock` 改动 | npm audit、cargo audit、bundle size 检查 |
| `ci-docker-size.yml` | `backend/**` 或 `frontend/**` 改动 | Docker 镜像大小检查 |

## 手动触发

| Workflow | 参数 | 说明 |
|----------|------|------|
| `ci-e2e.yml` | `test_filter`, `base_url` | E2E 测试（Playwright） |
| `cleanup.yml` | `dry_run`, `keep_days`, `keep_min_runs` | 清理旧的 workflow runs |

## 定时任务

| Workflow | 频率 | 说明 |
|----------|------|------|
| `ci-audit.yml` | 每周一 10:00 | 安全审计 |
| `cleanup.yml` | 每周日 03:00 | 清理旧 runs |

## 本地运行

```bash
# 前端 CI 检查
cd frontend
npm run lint          # ESLint
npm run format:check  # Prettier
npm run type-check    # TypeScript
npm run test:unit     # Vitest
npm run build         # Vite build

# 后端 CI 检查
# 工具链版本由仓库根的 rust-toolchain.toml 决定（rustup 会自动装 1.96.1 + rustfmt/clippy）
cd backend
cargo fmt --all --check                       # rustfmt（配置见 backend/rustfmt.toml）
cargo check --locked                          # 编译检查（锁文件必须与 Cargo.toml 一致）
cargo clippy --all-targets --locked -- -D warnings  # 代码质量（CI 里另加 2 个 allow）
cargo test --all-targets --locked             # 单元测试 + 集成测试

# E2E 测试
cd frontend
npx playwright install chromium
npm run build
npx vite preview --port 4173 &
npx playwright test --project=chromium
```
