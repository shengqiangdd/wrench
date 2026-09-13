# TESTING_STRATEGY.md — Wrench 测试策略

> 本文档规定前端（Vitest）和后端（Rust）的测试规范、Mock 方法与隔离原则。

---

## 1. 前端测试 (Vitest)

### 1.1 Mock WebSocket 和 IndexedDB

#### WebSocket Mock（来自 `src/test/setup.ts`）

```ts
// src/test/setup.ts
import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock WebSocket 全局类
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  url = ''

  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((ev: { error: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    setTimeout(() => this.onopen?.(), 0)
  }

  send(data: string) {
    const msg = JSON.parse(data)
    if (msg.type === 'ping') {
      this.onmessage?.({ data: JSON.stringify({ type: 'pong' }) })
    }
  }

  close() {
    setTimeout(() => this.onclose?.(), 0)
  }
}

global.WebSocket = MockWebSocket as unknown as typeof global.WebSocket
```

#### IndexedDB Mock（来自 `src/services/db.ts`）

```ts
// services/db.ts 单元测试 mock
import { vi } from 'vitest'

// Mock idb 库
vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue([]),
    clear: vi.fn().mockResolvedValue(undefined),
  }),
}))
```

### 1.2 React 组件测试（来自 `components/Toast.test.tsx`）

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Toast from '@/components/Toast'

describe('Toast', () => {
  it('renders toast with message', () => {
    render(<Toast message="Hello" type="success" onClose={() => {}} />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    render(<Toast message="Test" type="info" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClose).toHaveBeenCalled()
  })
})
```

### 1.3 jsdom 环境补丁（来自 `src/test/setup.ts`）

```ts
// jsdom 缺失 API 补丁
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver as unknown as typeof window.ResizeObserver

class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
global.IntersectionObserver = IntersectionObserver as unknown as typeof window.IntersectionObserver

// React.act 补丁（CJS 兼容）
if (typeof (globalThis as any).act === 'undefined') {
  ;(globalThis as any).act = (cb: () => void) => cb()
}
```

---

## 2. 后端测试 (Rust)

### 2.1 Axum 集成测试（来自 `tests/` 目录）

```rust
// tests/api_test.rs
use axum::{
    body::Body,
    http::{Request, Method},
};
use axum::test::TestClient; // axum 0.8+ 使用 TestClient

#[tokio::test]
async fn test_ssh_connect_requires_auth() {
    let state = create_test_state().await;
    let app = build_app(state);
    let client = TestClient::new(app);

    // 不带认证头 → 401
    let resp = client
        .request(Request::builder()
            .uri("/api/ssh/connect")
            .method(Method::POST)
            .header("Content-Type", "application/json")
            .body(Body::empty())
            .unwrap())
        .send()
        .await
        .unwrap();
    
    assert_eq!(resp.status(), 401);
}

#[tokio::test]
async fn test_ssh_exec_returns_stdout() {
    let state = create_test_state_with_mock_ssh().await;
    let app = build_app(state);
    let client = TestClient::new(app);
    let token = create_test_token();

    let resp = client
        .request(Request::builder()
            .uri("/api/ssh/connect")
            .method(Method::POST)
            .header("Authorization", format!("Bearer {}", token))
            .body(Body::from(json!({
                "host": "localhost", "port": 22, "username": "test"
            }).to_string()))
            .unwrap())
        .send()
        .await
        .unwrap();
    
    let body: serde_json::Value = axum::body::to_bytes(resp.into_body().await.unwrap().into_data())
        .await
        .map(|b| serde_json::from_slice(&b).unwrap())
        .unwrap();
    
    assert!(body["success"].as_bool().unwrap());
}

fn create_test_state() -> Arc<AppState> {
    Arc::new(AppState::new(test_config()).await.unwrap())
}
```

### 2.2 单元测试（src/ 模块内 `#[cfg(test)]`)

```rust
// src/utils/mod.rs 单元测试
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_escape_sh_arg_safe() {
        assert_eq!(escape_sh_arg("hello"), "hello");
        assert_eq!(escape_sh_arg("/var/log/nginx/access.log"), "/var/log/nginx/access.log");
        assert_eq!(escape_sh_arg("USER=root"), "USER=root");
    }

    #[tokio::test]
    async fn test_escape_sh_arg_unsafe() {
        assert_eq!(escape_sh_arg("hello world"), "'hello world'");
        assert_eq!(escape_sh_arg("$(whoami)"), "'$(whoami)'");
        assert_eq!(escape_sh_arg("path; rm -rf /"), "'path; rm -rf /'");
    }
}
```

### 2.3 数据库测试（SQLite 内存）

```rust
// src/db/mod.rs 单元测试
#[tokio::test]
async fn test_audit_log_insert() {
    let db = Database::open_in_memory().await.unwrap();
    
    db.insert_audit_log("2024-01-01T00:00:00Z", "ssh_exec", 
        &serde_json::json!({"cmd": "ls"}), "127.0.0.1")
        .await.unwrap();
    
    let logs = db.load_recent_audit_logs(10).await.unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].action, "ssh_exec");
}
```

---

## 3. 测试隔离原则

### 3.1 前端隔离

| 原则 | 说明 |
|------|------|
| **Mock 外部依赖** | WebSocket、fetch、IndexedDB、localStorage 全部 mock |
| **重置状态** | 每个 `it` 前后 `useStore.setState(initialState)` 或清理 timers |
| **环境补丁** | `src/test/setup.ts` 全局补丁一次，组件测试可重复 |
| **JSDOM 补充** | ResizeObserver、IntersectionObserver、URL.createObjectURL 必须 mock |

### 3.2 后端隔离

| 原则 | 说明 |
|------|------|
| **内存数据库** | `Database::open_in_memory()`，每个测试隔离 |
| **DashMap 独立** | 每个 `#[tokio::test]` 拉起新的 `AppState` 实例 |
| **静态变量保护** | rate_limiter、RATE_LIMITER 使用 `LazyLock` 单例，但需 `Mutex` 保护 |
| **文件资源** | 测试结束后 `remove_dir_all` 清理临时目录 |

---

## 4. 测试覆盖目标

| 模块 | 当前覆盖（2026-09-13 实测） | 目标 |
|------|----------|------|
| Rust 测试 | **145** 全绿（113 单元 + `tests/api_test.rs` 22 + `tests/space_isolation_test.rs` 10） | 每个公共函数必须有测试 |
| 前端测试 | **321** 全绿（28 个测试文件） | 每个组件必须有渲染/交互测试 |
| E2E 测试 | 23/23（`frontend/e2e/basic.spec.ts`） | 核心用户流程覆盖（登录、SSH、SFTP、Docker） |

> 数字必然随用例增删变化 —— **以 `cargo test --all-targets` / `npm run test:unit` 的实际输出为准**，
> 不要把这些数字当成门禁值抄进别处；发现本表过时就顺手更新（或删掉具体数字，只留命令）。

`tests/space_isolation_test.rs` 是多人共用改造的**隔离回归**：跨空间读/写、同 id 覆盖、
按空间计数、legacy 行认领、空间码只存哈希、复合主键约束，任何人动 db 层都要先跑它。

---

## 5. 常见测试命令

```bash
# 前端
cd frontend
npm run test          # vitest run，跑一遍就退出（CI 用的是 npm run test:unit）
npm run test:unit     # 同上，verbose 输出
npm run test:watch    # vitest watch 模式
npm run test:coverage # vitest run + coverage
npm run test:e2e      # Playwright headless

# 后端（工具链版本见仓库根 rust-toolchain.toml，当前 1.96.1）
cd backend
cargo test --all-targets    # 全部 145 个测试（113 单元 + tests/api_test.rs 22 + tests/space_isolation_test.rs 10）
cargo test --no-run         # 只编译不跑
cargo test ssh::            # 按模块过滤
cargo fmt --all --check     # 格式化检查（backend/rustfmt.toml）
cargo clippy --all-targets --locked -- -D warnings -A clippy::needless_update -A clippy::field_reassign_with_default
                            # 告警即错误，与 CI 一致（后两个 -A 必须带上，否则会误报）

# 覆盖率（后端）
cargo tarpaulin --out Xml --output-dir target/coverage
```

> 说明：`cargo test` 不带 `--all-targets` 时也会跑 `tests/` 下的集成测试；加 `--all-targets`
> 是为了和 CI 完全一致（同时覆盖 benches/examples）。数字会随用例增删变化，不必死记。

---

> **记住**：每个 `it()` 都应**自包含**，不依赖其他测试顺序。Mock 应尽量还原真实 API 行为，错的 Mock 比没有 Mock 更可怕。