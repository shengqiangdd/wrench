# CI/CD Workflows

> 这份表是**逐个文件从 `on:` 块里读出来的**，不是凭印象写的。
> 改 workflow 的触发条件时请一并更新这里 —— 之前这张表把「push 触发」错记在
> `docker-build.yml`（它其实是手动合并 manifest）上，而真正 push 触发的是 `docker-amd64.yml`。

## 自动触发（push / PR）

| Workflow | 触发条件 | 说明 |
|----------|----------|------|
| `ci-frontend.yml` | push / PR：`frontend/**`、`browser-iwa/**`、`docs/BROWSER-IWA.md` | ESLint、Prettier、`tsc`、Vitest、IWA 清单/隔离/WASM 测试、构建、打包 |
| `ci-backend.yml` | push / PR：`backend/**` | 模块树门禁、rustfmt、`check --locked`、Clippy（`-D warnings`）、`test --all-targets` |
| `ci-audit.yml` | push / PR：`frontend/package-lock.json`、`backend/Cargo.lock` | `npm audit --audit-level=critical`、`cargo audit`、bundle size 门禁 |
| `ci-docker-size.yml` | push / PR：`Dockerfile`、`docker-entrypoint.sh` | 构建 amd64 镜像并报告体积（超 200MB 只警告） |
| `ci-secrets.yml` | push（所有分支）/ PR | 明文凭据扫描（已跟踪文件） |
| `docker-amd64.yml` | push 到 `main`：`backend/**`、`frontend/**`、`plugins/**`、`Dockerfile`、`docker-entrypoint.sh` | 构建并推送 `:latest` / `:amd64` / `:sha-*` 到 ghcr.io（`no-cache`） |
| `ci-e2e.yml` | PR（无路径过滤，即每个 PR） | 起真实 SSH/SFTP 栈 + Playwright E2E |

## 定时任务

| Workflow | 频率 | 说明 |
|----------|------|------|
| `ci-audit.yml` | 每周一 10:00 | 同上的安全审计 |
| `ci-secrets.yml` | 每周一 09:00 | 扫**全历史对象**（比扫工作区重得多，所以不随每次 push 跑） |
| `ci-e2e.yml` | 每周二、五 04:17 | 真实链路 E2E |
| `cleanup.yml` | 每周日 03:00 | 清理旧 workflow runs 与旧镜像版本 |

## 手动触发（`workflow_dispatch`）

| Workflow | 参数 | 说明 |
|----------|------|------|
| `ci-e2e.yml` | `test_filter` | 只跑某个 Playwright project（如 `chromium`） |
| `ci-audit.yml` / `ci-secrets.yml` / `ci-docker-size.yml` | — | 需要时手动重跑 |
| `cleanup.yml` | `dry_run`、`keep_days`、`keep_min_runs` | 先 `dry_run` 预览再真删 |
| `docker-amd64.yml` / `docker-arm64.yml` | — | 手动构建（arm64 目前只手动，功能稳定后再开 push 触发） |
| `docker-build.yml` | `skip_arm64_check` | 把 `:amd64` + `:arm64` 合并成多架构 `:latest`（需先构建好 arm64） |
| `package-local-ssh-agent.yml` | — | 为 linux/macOS/Windows 打包本地 SSH agent（先跑 `cargo test --bin wrench-agent`） |
| `test-iwa-signed-smoke.yml` | — | 在真实 Chromium（xvfb）里装签名 IWA 冒烟；脚本自带临时 Ed25519 密钥，不需要 secret |
| `release-iwa.yml` | `release_tag` | 打包并签名 IWA、挂到 Release 资产；**需要 `iwa-signing` environment 里的 `WRENCH_IWA_SIGNING_KEY` 与 `WRENCH_IWA_BUNDLE_ID`** |

## ⚠️ 为什么有些 workflow 在 Actions 页面里看不到、也不能手动触发

GitHub **只注册默认分支（`main`）上的 workflow 文件**。只在功能分支上的 workflow：

- 不出现在 `GET /repos/{owner}/{repo}/actions/workflows` 列表里；
- `POST .../workflows/{file}/dispatches` 返回 **404** —— 也就是说**手动触发不了**；
- 但 PR 事件仍会按 PR 分支上的文件运行（`ci-e2e.yml` 就是这么第一次跑起来的）。

所以「新加的 workflow 从未运行过」通常不是文件写错了，而是**还没合进默认分支**。
判断方法：把 `git ls-tree --name-only main -- .github/workflows/` 与
`GET .../contents/.github/workflows?ref=main` 对一下。

> 2026-10-06 记录：`package-local-ssh-agent.yml`、`release-iwa.yml`、`test-iwa-signed-smoke.yml`
> 三个文件当时只存在于尚未推到 `main` 的提交里，因此处于「已写好但既看不到、也触发不了」的状态。
> 它们本身没问题（YAML 合法、引用的脚本/文档都在、签名冒烟脚本自带临时密钥），
> 合入默认分支后即可正常派发 —— 但**首次运行**请当「首秀」对待：
> `ci-e2e.yml` 的首秀就是 16 个失败（测试假设和运行环境对不上），见 `docs/CHANGELOG.md`。

## 本地运行

```bash
# 前端 CI 检查
cd frontend
npm run lint          # ESLint
npm run format:check  # Prettier（覆盖 src、e2e、*.config.{ts,js}、scripts）
npm run type-check    # tsc --noEmit（覆盖 src、e2e、*.config.ts）
npm run test:unit     # Vitest
npm run build         # Vite build（生产构建会跑 React Compiler）
npm run test:iwa-manifest && npm run test:regular-build-isolation

# 后端 CI 检查
# 工具链版本由仓库根的 rust-toolchain.toml 决定（rustup 会自动装 1.96.1 + rustfmt/clippy）
cd backend
sh ../tools/check-rust-modules.sh             # 模块树门禁：backend/src 下不许有孤儿 .rs
cargo fmt --all --check                       # rustfmt
cargo check --locked                          # 编译检查（锁文件必须与 Cargo.toml 一致）
cargo clippy --all-targets --locked -- -D warnings  # CI 里另加 2 个 allow
cargo test --all-targets --locked             # 单元测试 + 集成测试

# 明文凭据扫描（提交前 / CI 共用同一份规则）
sh tools/check-secrets.sh            # 已跟踪文件
sh tools/check-secrets.sh --staged   # 只扫暂存区（pre-commit 用）

# E2E 测试
cd frontend
npx playwright install chromium

# (a) 只跑「后端不可达」类用例：不需要后端，用 preview server 起静态站点即可。
#     basic.spec.ts 的错误页用例自己会 route.abort('/api/**')，不依赖环境是否恰好没后端。
npm run build && npx vite preview --port 4173 &
npx playwright test --project=chromium

# (b) 跑真实链路（与 ci-e2e.yml 一致）：需要 docker；必须把 BASE_URL 指向真实栈，
#     否则 ssh-sftp.spec.ts 会因为缺 WRENCH_E2E_SSH_* 而 skip。
docker compose -f ../docker-compose.e2e.yml up -d --build
BASE_URL=http://localhost:3001 \
WRENCH_E2E_SSH_HOST=172.30.0.10 WRENCH_E2E_SSH_USER=e2e \
WRENCH_E2E_SSH_PASSWORD=e2e-password WRENCH_E2E_SSH_PORT=22 \
  npx playwright test --project=chromium
docker compose -f ../docker-compose.e2e.yml down --volumes
```
