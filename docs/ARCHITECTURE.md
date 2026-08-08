# 棘轮工具箱 (Wrench) 架构文档

> 本文档描述 Wrench 的整体架构、技术选型、模块划分和关键设计决策。

---

## 1. 整体架构概览

Wrench 采用 **前后端分离 + WebSocket 实时通道** 的架构模式。

```
┌─────────────────────────────────────────────────┐
│                   浏览器 (SPA)                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  SSH 模块│ │ 文件管理  │ │  AI + 插件系统   │  │
│  └────┬────┘ └────┬─────┘ └────────┬─────────┘  │
│       │           │                │              │
│  ┌────┴───────────┴────────────────┴─────────┐   │
│  │          WebSocketService                  │   │
│  └───────────────────┬───────────────────────┘   │
└──────────────────────┼───────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────┼───────────────────────────┐
│          Node.js 后端 (bridge/index.js)           │
│  ┌────────┐ ┌──────────────┐ ┌────────────────┐  │
│  │ Express│ │ SSH2 (ssh2)  │ │ SFTP (ssh2)    │  │
│  │ REST   │ │ 会话管理      │ │  文件操作      │  │
│  │ API    │ │ 终端通道      │ │  分块上传      │  │
│  └────────┘ └──────────────┘ └────────────────┘  │
│  ┌────────────────────────────────────────────┐   │
│  │              插件市场 API                  │   │
│  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────┘
```

**核心原则**：

- **前端渲染、后端计算** — 前端只做 UI 渲染和状态管理，所有 SSH/SFTP 操作由后端代理
- **单一 WebSocket 通道** — SSH 终端和 SFTP 操作共用一条 WebSocket 连接，通过 `type` 字段路由
- **REST for 配置, WS for 实时** — 插件市场、连接管理用 REST API；终端交互、文件传输用 WebSocket

---

## 2. 技术栈

### 前端

| 技术 | 用途 |
|---|---|
| **React 18** | UI 框架 |
| **Vite 6** | 构建工具 |
| **TypeScript** | 类型安全 |
| **TailwindCSS 3.19** | 样式 |
| **Zustand** | 状态管理 |
| **React Router 7** | 路由 |
| **CodeMirror 6** | 代码编辑器 |
| **xterm.js** | 终端模拟器 |
| **lucide-react** | 图标库 |
| **idb** | IndexedDB 封装 |
| **vite-plugin-pwa** | PWA 支持 |

### 后端

| 技术 | 用途 |
|---|---|
| **Node.js (v22)** | 运行时 |
| **Express 5** | HTTP 框架 |
| **express-ws** | WebSocket 集成 |
| **ssh2** | SSH 客户端 + SFTP 协议实现 |
| **cors** | 跨域支持 |

---

## 3. 前端模块划分

```
frontend/src/
├── components/          # 通用组件
│   ├── layout/          # 布局组件（Layout, Sidebar, MainContent...）
│   ├── CodeMirrorEditor.tsx
│   ├── CommandPalette.tsx
│   ├── ConfirmModal.tsx
│   ├── PluginSandbox.tsx
│   ├── ResizablePanel.tsx
│   ├── ShortcutHelpModal.tsx
│   ├── Toast.tsx
│   └── VirtualList.tsx   # 通用虚拟滚动列表
├── modules/             # 业务模块（懒加载）
│   ├── ssh/             # SSH 终端 + SFTP 文件管理
│   ├── file-manager/    # 独立文件管理器（纯本地文件操作）
│   ├── plugins/         # 插件系统 + 插件市场
│   └── settings/        # 设置面板
├── services/            # 数据/服务层
│   ├── websocket.ts     # WebSocket 客户端（封装连接/重连/心跳）
│   ├── db.ts            # IndexedDB 读写
│   ├── crypto.ts        # AES-GCM 加密解密
│   ├── pluginManager.ts # 插件管理器
│   ├── pluginSandboxManager.ts # 插件沙箱管理器
│   ├── ai-operations.ts # AI 代码操作
│   └── importExport.ts  # 数据导入导出
├── stores/              # Zustand 状态管理
│   ├── app-store.ts     # 全局应用状态（主题/导航/面板）
│   ├── ssh-store.ts     # SSH 连接 + 会话状态
│   ├── file-store.ts    # 文件编辑器 Tab 状态
│   ├── plugin-store.ts  # 插件启用/禁用状态
│   └── ai-store.ts      # AI 配置 + 对话状态
├── types/               # TypeScript 类型定义
│   ├── ssh.ts
│   ├── plugin.ts
│   ├── file.ts
│   └── ai.ts
├── App.tsx              # 应用入口（主题管理/路由/全局组件）
├── main.tsx             # 渲染入口
├── global-api.ts        # 插件全局 API (Wrench.getPluginAPI)
└── index.css            # 全局样式 + Tailwind
```

### 3.1 模块职责

#### SSH 模块 (`modules/ssh/`)

Wrench 最核心的模块，包含：
- **ConnectionList** — 连接管理 CRUD、分组、搜索、快速连接
- **ConnectionForm** — 新建/编辑连接的弹窗表单
- **Terminal** — xterm.js 终端 + WebSocket 通道（含分屏、同步命令）
- **SftpBrowser** — SFTP 文件浏览/上传/下载/编辑
- **SftpSidebar** — 侧边栏中的快速文件浏览器
- **AiSidebar** — AI 对话侧边栏
- **SshPlaceholder** — SSH 主面板容器（整合终端 Tab + 文件浏览器）

#### 插件系统 (`modules/plugins/`)

- **PluginsPage** — 插件管理页面（已安装/市场两个标签页）
- **PluginMarket** — 在线插件市场浏览和安装

#### 通用组件 (`components/`)

- **VirtualList** — 自研虚拟滚动列表，100 项阈值自动切换原生/虚拟化
- **ResizablePanel** — 可拖拽调整宽度的面板
- **PluginSandbox** — iframe 沙箱容器，用于隔离执行插件代码

---

## 4. 后端模块划分

```
bridge/
└── index.js          # 单一入口，约 1200 行
```

后端采用 **单文件架构**，按功能域组织：

### 4.1 HTTP 路由

| 路由 | 方法 | 功能 |
|---|---|---|
| `/api/plugins` | GET | 扫描并返回所有插件清单 |
| `/api/market/index` | GET | 拉取远程插件市场索引 |
| `/api/plugins/install` | POST | 从市场下载安装插件 |
| `/api/plugins/uninstall` | POST | 删除已安装插件 |
| `/<path>` | GET | 静态文件服务（前端 dist） |
| 其余 | GET | 回退到 index.html（SPA 支持） |

### 4.2 WebSocket 消息协议

所有消息为 JSON 格式，包含 `type` 字段路由：

**客户端 → 服务器：**

| type | 功能 |
|---|---|
| `auth` | 认证（password / privateKey） |
| `resize` | 调整终端尺寸 |
| `data` | 终端输入（base64） |
| `exec` | 执行命令并返回结果 |
| `ping` | 心跳保活 |
| `test` | SSH 连接测试 |
| `sftp` | SFTP 操作（见下方子类型） |
| `sftp-ready` | SFTP 通道就绪确认 |
| `sftp-close` | 关闭 SFTP 通道 |

**SFTP 操作子类型（`sftp.operation`）：**

| operation | 功能 |
|---|---|
| `list` | 列出目录内容 |
| `stat` | 获取文件/目录属性 |
| `read` | 读取文件内容 |
| `write` | 写入/上传文件 |
| `mkdir` | 创建目录 |
| `rmdir` | 删除目录 |
| `unlink` | 删除文件 |
| `rename` | 重命名/移动 |
| `chmod` | 修改权限 |
| `chunk_start` | 初始化大文件分块上传 |
| `chunk_append` | 追加文件分块（每块 ≤5MB） |
| `chunk_finish` | 完成分块上传并写入目标路径 |

**服务器 → 客户端：**

| type | 功能 |
|---|---|
| `auth-result` | 认证结果 |
| `data` | 终端输出（base64） |
| `exec-result` | 命令执行结果 |
| `test-result` | 连接测试结果 |
| `sftp-result` | SFTP 操作结果 |
| `error` | 错误信息 |

---

## 5. 数据流

### 5.1 SSH 终端连接

```
用户 → TerminalView → WebSocketService → WebSocket → bridge/index.js → ssh2 Client
                                                                              ↓
用户 ← TerminalView ← WebSocketService ← WebSocket ← bridge/index.js ← ssh2 Client
```

### 5.2 分屏同步命令

```
┌────────┐   ┌────────┐   ┌────────┐
│TerminalA│   │TerminalB│   │TerminalC│
└───┬────┘   └───┬────┘   └───┬────┘
    │ 同组        │            │
    └─────────────┴────────────┘
         onTerminalData(data)
             广播到同组所有实例
```

通过 `syncGroup` 属性标识分屏属于哪个同步组，`onTerminalData` 回调将输入广播到同组其他分屏。所有分屏保持自己独立的 WebSocket 连接，只是输入层做同步。

### 5.3 AI 代码操作

```
用户选中代码 → AI 操作菜单 → ai-operations.ts → OpenRouter API
                                                     ↓
用户 ← 流式返回 diff → 左右对比 → 一键应用
```

---

## 6. 状态管理

使用 Zustand，按业务域拆分：

**app-store.ts** — 全局应用状态
- `theme`: `'light' | 'dark' | 'system'`
- `activeNav`: `'ssh' | 'files' | 'plugins' | 'settings'`
- `sidebarOpen` / `rightPanelOpen`
- `commandPaletteOpen`
- `toasts`: Toast 消息队列

**ssh-store.ts** — SSH 连接管理
- `connections`: SshConnection[]（IndexedDB 持久化）
- `sessions`: Session[]（活跃会话）
- CRUD 操作方法
- 选中连接/添加会话/更新状态

**file-store.ts** — 文件编辑器
- `openTabs`: EditorTab[]
- `activeTabId`
- Tab 管理 / 内容自动保存到 IndexedDB

**plugin-store.ts** — 插件状态
- `enabledPlugins`: string[]
- `togglePlugin()` / `isEnabled()`

**ai-store.ts** — AI 配置与对话
- `conversations`: Conversation[]
- `activeConversationId`
- `apiKey`, `model`, `systemPrompt`

> 所有持久化数据通过 IndexedDB 保存（`services/db.ts`），应用启动时自动恢复。

---

## 7. 安全设计

### 7.1 SSH 凭据安全

- 密码/私钥通过 **AES-GCM** 加密后存入 IndexedDB
- 解密密钥从 URL hash 参数或环境变量获取
- 快速连接不保存任何凭据

### 7.2 插件沙箱

- 插件运行在 `<iframe>` 沙箱中，`sandbox="allow-scripts"`
- 无 DOM 访问、无全局变量、无 Node.js API
- 通过 `postMessage` 与主应用通信
- 插件代码经 Blob URL 注入，无文件系统写入权限

### 7.3 后端防护

- 路径穿越防护（所有文件路径校验）
- manifest.json 验证（格式/missing 字段检测）
- 空 JS 文件检测
- 安装失败自动清理

---

## 8. 性能设计

### 8.1 路由级代码分割

每个 Tab 模块（SSH / 文件管理 / 插件 / 设置）通过 `React.lazy` 懒加载，首次只加载当前激活模块的代码。

### 8.2 虚拟列表

文件浏览器（SftpBrowser）使用自研虚拟滚动组件 `VirtualList`，超过 100 项时仅渲染可见行 + 前后各 5 行缓冲。

### 8.3 PWA 离线缓存

- `vite-plugin-pwa` + Workbox 预缓存所有静态资源
- Service Worker 注册后支持离线访问（已缓存的页面和静态资源）

### 8.4 构建优化

- Terser 压缩（含 `drop_console`）
- CSS 通过 Tailwind 的 JIT 仅生成使用中的样式

---

## 9. 关键决策记录 (ADR)

### ADR-1: 单文件后端 vs 模块化

**决策**: 后端采用单文件 (`bridge/index.js`)。

**原因**: 后端功能域边界清晰（SSH/SFTP/REST/WS），单文件约 1200 行，复杂度可控。减少模块间通信成本。如后续增长可拆分。

### ADR-2: WebSocket 单一通道 vs 多通道

**决策**: SSH 终端和 SFTP 操作共用一条 WebSocket。

**原因**: 避免管理多条连接的开销，简化会话绑定。通过 `type` 字段区分消息类型，复杂度可接受。

### ADR-3: Zustand vs Redux/Context

**决策**: Zustand。

**原因**: 类型安全、零样板代码、性能优于 Context（避免不必要的重渲染），且支持 computed/selector。

### ADR-4: 原生虚拟滚动 vs 第三方库

**决策**: 自研 `VirtualList` 组件，零外部依赖。

**原因**: 实现简单（固定高度行），没有学习第三方库 API 的成本，与项目轻量化理念一致。

### ADR-5: iframe 沙箱 vs Web Worker

**决策**: iframe 沙箱。

**原因**: Web Worker 无法操作 DOM（部分插件可能需创建 UI 元素），iframe 提供完整 DOM 隔离且安全可控。通信延迟通过 `postMessage` 优化。

---

## 10. 插件系统架构

```
主应用 ←→ pluginSandboxManager (管理多个 iframe)
              │
              ├── PluginSandbox A (CodeMirror 编辑器插件)
              ├── PluginSandbox B (通知推送插件)
              └── PluginSandbox C (...
```

详细 API 文档见 [PLUGIN_API.md](./PLUGIN_API.md)。

**通信协议**：

```
┌──────────────┐          postMessage          ┌──────────────┐
│  主应用       │ ◄──────────────────────────► │  iframe 沙箱  │
│              │    sandbox-ready               │  插件代码    │
│              │    registerCommand             │              │
│              │    setEditorContent            │              │
│              │    getEditorContent            │              │
│              │    notification                │              │
└──────────────┘                                └──────────────┘
```

---

## 11. 部署架构

详细部署文档见 [DEPLOY.md](../DEPLOY.md)。

```
nginx/proxy → Wrench (Express) → SSH Server
                   │
            static files
            (frontend/dist)
```

- 单 Docker 容器部署
- 前端构建产物由后端静态托管
- 无额外依赖（无需数据库）
