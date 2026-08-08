# 棘轮工具箱 (Wrench) — 项目规划书

> 一个可插拔、AI增强的网页版生产力工具箱
> 版本: v1.0 | 状态: 规划中

---

## 一、项目愿景

**棘轮工具箱 (Wrench)** 是一个纯浏览器端的智能工具集合平台，解决移动端缺乏好用 SSH 客户端和文件管理工具的核心痛点，同时通过热插拔插件系统承载丰富的生产力工具。所有用户数据仅存储在本地 IndexedDB，隐私至上。

> "你的口袋里的运维工作站。"

---

## 二、技术选型与理由

### 前端

| 技术 | 选型 | 理由 |
|------|------|------|
| **框架** | React 18 + TypeScript (strict mode) | 生态成熟，类型安全，社区活跃 |
| **构建工具** | **Vite 6** | 极速 HMR，Tree-shaking 优秀，比 Webpack 轻量 5x |
| **UI 框架** | **shadcn/ui + Tailwind CSS 4** | 按需编译实现零 JS 开销，移动端自适应优秀，体积控制在 50KB 以内 |
| **编辑器** | **CodeMirror 6** (`@codemirror/view`) | 重量仅 Monaco 的 **1/20** (~1MB vs ~20MB)，支持语法高亮、多语言、可扩展，移动端触摸优化更好 |
| **终端** | **xterm.js** + `xterm-addon-fit` | 行业标准网页终端，无替代品 |
| **状态管理** | **Zustand** | 仅 ~1KB，API 简洁，TypeScript 友好，比 Redux 轻量 20x |
| **路由** | **React Router v7** | 标准方案，懒加载支持好 |
| **PWA** | **vite-plugin-pwa** | 零配置 Workbox 集成，自动生成 Service Worker |
| **加密** | **Web Crypto API** (AES-GCM) | 浏览器原生，无需额外依赖，硬件加速 |
| **文件系统** | **File System Access API** + `idb` (IndexedDB 封装) | 原生文件读写 + 本地数据库持久化 |
| **插件引擎** | **动态 import()** + 自定义沙箱 | 符合 ESM 规范，零额外依赖 |

### 后端代理 (SSH Bridge)

| 技术 | 选型 | 理由 |
|------|------|------|
| **运行时** | **Node.js 20+** | LTS，原生 WebSocket 支持 |
| **WebSocket** | **ws** (原生) | 零依赖，纯 Node 实现，比 Socket.IO 轻量 10x |
| **SSH 库** | **ssh2** | 底层绑定 libssh2，性能最优，支持全部认证方式 |
| **进程管理** | 无框架，**纯入口文件** | 整个后端仅 ~200 行代码，极致轻量 |

---

## 三、系统架构

```
┌────────────────────────────────────────────────────────────┐
│                      🖥️ Browser (PWA)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Command  │ │  SSH     │ │  File    │ │   Plugins    │ │
│  │ Palette  │ │  Client  │ │  Manager │ │   (动态导入)  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │               Zustand Store (全局状态)                │ │
│  └──────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────┐ │
│  │           IndexedDB (加密存储 / idb 封装)             │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────┘
                       │ WebSocket
                       ▼
┌────────────────────────────────────────────────────────────┐
│              🖧 Node.js SSH Bridge (~200行)                │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐      │
│  │  ws 监听  │──▶│  ssh2    │──▶│  多连接管理+心跳  │      │
│  └──────────┘   └──────────┘   └──────────────────┘      │
└────────────────────────────────────────────────────────────┘
```

### 数据流

1. **SSH 连接**: Browser → WebSocket ↔ SSH Bridge ↔ SSH2 (C) → Remote Server
2. **SFTP 文件**: Browser → WebSocket ↔ SSH Bridge (sftp channel) → Remote Server
3. **AI 能力**: Browser → OpenRouter API (REST) → LLM Model
4. **本地文件**: Browser ↔ File System Access API ↔ Local Filesystem

---

## 四、功能模块详情

### 📁 模块 A: SSH 客户端 (MVP)

- 连接管理器：增删改查，支持分组
- 认证方式：密码、密钥（粘贴或上传私钥文件）
- 终端：xterm.js 全功能终端，支持 Ctrl+C/V 复制粘贴
- 连接状态：活跃连接列表，断连自动重连
- SFTP 侧边栏：树形文件浏览器，操作列（下载、上传、重命名、删除、权限 chmod）

### 📁 模块 B: 智能文件管理器 (MVP)

- 双源模式：本地（File System Access API）| 远程（SFTP）
- CodeMirror 6 编辑器：30+ 语言语法高亮，自动缩进
- 自动格式识别：JSON/YAML/XML/Markdown → 一键格式化
- 文件树：目录折叠，面包屑导航

### 📁 模块 C: AI 辅助 (MVP)

- 选中文本 → 弹出 AI 操作菜单（解释 / 重构 / 修复 / 翻译 / 优化）
- OpenRouter API 统一适配
- 用户可自由配置 API Key 和模型
- 默认模型: `meta-llama/llama-3.1-8b-instruct:free`（免费模型）
- 修改结果 Diff 对比 → 一键应用/撤销
- Streaming 打字机效果

### 📁 模块 D: 插件系统 (MVP)

- 自动扫描 `plugins/` 目录，读取 manifest.json
- 插件 API：`Wrench.registerPanel()`, `Wrench.registerCommand()`, `Wrench.getFileContent()`
- 插件沙箱：iframe + postMessage 隔离
- 内置 5 示例插件

### 📁 模块 E: 命令面板 (MVP)

- Ctrl+P / Cmd+P 唤起
- 模糊搜索所有命令
- 命令来源：原生命令 + 插件注册命令

### 📁 模块 F: 数据安全 (MVP)

- IndexedDB 存储所有连接配置和密钥
- AES-GCM 主密码加密
- 首次使用提示设置主密码
- 会话锁定：闲置自动锁屏

---

## 五、目录结构

```
wrench/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── index.html
├── public/
│   └── icons/              # PWA 图标
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css            # Tailwind 入口
│   ├── components/          # 共享 UI 组件
│   │   ├── ui/              # shadcn/ui 组件
│   │   ├── layout/
│   │   ├── sidebar/
│   │   └── command-palette/
│   ├── modules/             # 功能模块
│   │   ├── ssh/             # SSH 客户端
│   │   │   ├── index.tsx
│   │   │   ├── ConnectionManager.tsx
│   │   │   ├── Terminal.tsx
│   │   │   ├── SftpSidebar.tsx
│   │   │   └── hooks.ts
│   │   ├── file-manager/    # 文件管理器
│   │   │   ├── index.tsx
│   │   │   ├── FileTree.tsx
│   │   │   ├── Editor.tsx
│   │   │   └── Formatters.ts
│   │   ├── ai/              # AI 辅助
│   │   │   ├── index.tsx
│   │   │   ├── AiMenu.tsx
│   │   │   ├── DiffView.tsx
│   │   │   └── openrouter.ts
│   │   └── plugins/         # 插件引擎
│   │       ├── index.ts
│   │       ├── loader.ts
│   │       ├── sandbox.ts
│   │       └── api.ts
│   ├── stores/              # Zustand 状态
│   │   ├── ssh-store.ts
│   │   ├── file-store.ts
│   │   ├── ai-store.ts
│   │   └── plugin-store.ts
│   ├── services/            # 基础设施
│   │   ├── db.ts            # IndexedDB 封装
│   │   ├── crypto.ts        # 加密工具
│   │   └── websocket.ts     # WebSocket 客户端
│   └── types/               # TypeScript 类型
│       ├── ssh.ts
│       ├── file.ts
│       ├── plugin.ts
│       └── ai.ts
├── plugins/                 # 内置示例插件目录
│   ├── json-formatter/
│   │   ├── manifest.json
│   │   └── index.tsx
│   ├── base64-encode/
│   ├── timestamp-convert/
│   ├── regex-tester/
│   └── qrcode/
├── bridge/                  # SSH Bridge 后端代理
│   ├── package.json
│   ├── index.ts
│   ├── ssh-manager.ts
│   └── ws-handler.ts
└── docs/
    ├── ARCHITECTURE.md
    └── PLUGIN_API.md
```

---

## 六、里程碑规划

```
M1 ─── M2 ────────── M3 ──────────────── M4 ─────────────── M5
 │      │              │                    │                  │
立项    框架骨架       SSH+SFTP核心        AI+插件系统        PWA+优化
        (Week 1)      (Week 2-3)          (Week 4-5)         (Week 6-7)
```

### M1 — 项目初始化 (Day 1)
- Vite + React + TypeScript 脚手架搭建
- Tailwind + shadcn/ui 配置
- 项目目录结构搭建
- SSH Bridge 基础框架

### M2 — 核心骨架 (Week 1)
- 布局系统（侧边栏 + 主内容区 + 命令面板）
- Zustand 状态管理层
- IndexedDB 存储层（加密基础设施）
- WebSocket 客户端/服务端通信
- 路由系统

### M3 — SSH + SFTP 核心功能 (Week 2-3)
- SSH 连接管理器（CRUD + 认证）
- xterm.js 终端组件（全功能）
- SFTP 文件浏览器侧边栏
- 文件操作（上传/下载/删除/重命名/chmod）
- 连接状态管理（心跳/断连重试）

### M4 — AI + 插件系统 (Week 4-5)
- CodeMirror 6 编辑器集成
- 文件自动格式化（JSON/YAML/MD/XML）
- OpenRouter AI 接口集成
- AI 上下文菜单（选中→操作）
- Diff 视图组件
- 插件加载引擎（动态 import）
- 插件 API 定义
- 5 个示例插件

### M5 — 打磨与发布 (Week 6-7)
- PWA 配置（离线缓存，安装到桌面）
- 响应式设计调优（移动端/触屏）
- 主密码加密完整流程
- 闲置锁屏
- 错误处理与边界情况
- 性能优化（代码分割，懒加载）
- 文档编写

---

## 七、开发任务优先级

| 优先级 | 任务 |
|--------|------|
| 🔴 **高** | SSH 连接管理器 + xterm 终端 |
| 🔴 **高** | IndexedDB 加密存储层 |
| 🔴 **高** | SSH Bridge 后端代理 |
| 🔴 **高** | SFTP 文件浏览和操作 |
| 🟡 **中** | CodeMirror 编辑器 + 语法高亮 |
| 🟡 **中** | 命令面板 (Ctrl+P) |
| 🟡 **中** | 插件引擎 + 示例插件 |
| 🟡 **中** | AI 辅助 (OpenRouter 集成) |
| 🟢 **低** | PWA 离线支持 |
| 🟢 **低** | 响应式移动端优化 |
| 🟢 **低** | 主密码加密 + 闲置锁屏 |
| 🟢 **低** | Diff 视图/流式输出 |
| 🟢 **低** | 文档和测试 |

---

## 八、风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| SSH 连接稳定性（WebSocket 断开） | 心跳检测 + 指数退避重连 |
| CodeMirror 大文件性能 | 虚拟行渲染，文件分块加载 |
| 插件安全（XSS） | iframe 沙箱 + postMessage 白名单 |
| File System Access API 兼容性 | 回退到传统 file input |
| OpenRouter API 延迟 | Streaming 响应 + 请求队列 |
| 移动端键盘与终端冲突 | 自定义虚拟键盘扩展键 |

---

## 九、非功能性目标

- **包体积**: 生产构建 < 500KB (gzip)
- **首次加载**: < 2s (3G网络)
- **终端延迟**: < 100ms (局域网)
- **PWA 评分**: Lighthouse > 90
- **兼容性**: Chrome 90+, Safari 15+, Firefox 90+
