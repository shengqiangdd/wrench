# 智盒 (SmartBox) — TODO 开发任务清单

> 优先级: 🔴 高  🟡 中  🟢 低
> 状态: ⬜ 待办  🟦 进行中  ✅ 完成

---

## 阶段 M1: 项目初始化 (Day 1)

### 🔴 脚手架搭建

- [x] ✅ Vite 6 + React 18 + TypeScript strict 项目初始化
- [x] ✅ Tailwind CSS 3 + 自定义 smartbox 主题配置
- [x] ✅ ESLint + Prettier 配置
- [x] ✅ 后端子项目 `bridge/` 初始化 (package.json + index.js)

### 🔴 项目结构

- [x] ✅ 创建完整目录结构 (src/modules, src/stores, src/services, src/types 等)
- [x] ✅ 定义核心 TypeScript 接口 (ssh.ts, file.ts, plugin.ts, ai.ts)
- [x] ✅ 配置路径别名 (@/ → src/)

### 🟡 构建配置

- [x] ✅ Vite 代理配置 (开发时代理 /ws 到 SSH Bridge)
- [ ] ⬜ pnpm 工作空间配置 (monorepo)

---

## 阶段 M2: 核心骨架 (Week 1)

### 🔴 布局系统

- [x] ✅ 三栏布局组件 (Sidebar + Main + RightPanel)
- [ ] ⬜ 可拖拽调整面板宽度
- [x] ✅ 侧边栏导航 (SSH / 文件 / 插件 / 设置)
- [x] ✅ 深色/浅色/跟随系统主题切换
- [x] ✅ 移动端底部导航栏 (屏幕 < 768px)

### 🔴 状态管理 (Zustand)

- [x] ✅ `ssh-store.ts` — SSH 连接列表、活跃连接、终端实例
- [x] ✅ `file-store.ts` — 打开的文件、当前目录、文件树状态
- [x] ✅ `ai-store.ts` — AI API Key、模型选择、对话历史
- [x] ✅ `plugin-store.ts` — 已加载插件列表、插件命令注册表
- [x] ✅ `app-store.ts` — 主题、面板布局、命令面板开关

### 🔴 数据持久化 (IndexedDB)

- [x] ✅ `idb` 封装 `services/db.ts` — 通用 CRUD + 索引查询 + 批量操作
- [x] ✅ SSH 连接配置表 (id, name, host, port, username, authType, ...)
- [x] ✅ 插件数据表 (插件各自的持久化数据, by-plugin 索引)
- [x] ✅ 用户设置表 (主题、AI 配置等, 快捷 get/set/deleteSetting)
- [x] ✅ AI 对话历史表 (ai_sessions, 含消息列表)
- [x] ✅ 自动迁移机制 (版本 1, upgrade 创建 4 个表)

### 🔴 加密层

- [x] ✅ `services/crypto.ts` — AES-GCM 加密/解密工具 (PBKDF2 100k 迭代)
- [x] ✅ 主密码设置/验证流程 (createMasterPassword/verifyPassword)
- [ ] ⬜ 加密存储装饰器 (写入时自动加密，读取时自动解密)
- [ ] ⬜ 闲置锁屏 (检测无操作 → 锁定 → 需输入主密码)

### 🔴 SSH Bridge (后端)

- [x] ✅ `bridge/index.js` — WebSocket 服务，消息路由
- [x] ✅ SSH 连接池管理 (密码/密钥认证)
- [x] ✅ 消息协议定义 (JSON 格式): connect / disconnect / exec / resize / sftp
- [x] ✅ 心跳检测 (30s ping/pong)
- [x] ✅ SFTP 通道转发: list / read / write / rename / delete / chmod
- [x] ✅ 错误处理: 连接超时、认证失败、断连清理

### 🔴 网络层 (前端)

- [x] ✅ `services/websocket.ts` — WebSocket 客户端封装
- [x] ✅ 自动重连 (指数退避: 1s, 2s, 4s, 8s..., 最大10次)
- [x] ✅ 请求-响应匹配 (requestId 模式)
- [x] ✅ 连接状态指示器 (已连接/断开/重连中)

### 🟡 命令面板

- [x] ✅ `CommandPalette` 组件 (Ctrl+P / Cmd+P) — 已实现
- [x] ✅ 模糊搜索 (拼音+英文+驼峰匹配) — 已实现
- [x] ✅ 命令注册机制 (`registerCommand()` / `getCommands()`) — 已实现
- [x] ✅ 内置命令: 导航/主题切换/侧栏 — 已实现

---

## 阶段 M3: SSH + SFTP 核心功能 (Week 2-3)

### 🔴 SSH 连接管理器

- [x] ✅ `ConnectionList` + `ConnectionForm` 组件 — 连接列表 CRUD
- [x] ✅ 新建连接表单: 主机、端口、用户名、认证方式、分组标签
- [x] ✅ 密码认证 (输入/保存)
- [x] ✅ 密钥认证 (粘贴私钥 / 上传 `.pem` 文件)
- [ ] ⬜ 连接测试 (ping)
- [x] ✅ 连接分组管理 (文件夹分类)
- [ ] ⬜ 快速连接 (输入临时地址)

### 🔴 xterm.js 终端

- [x] ✅ `Terminal` 组件 — xterm.js 初始化
- [x] ✅ WebSocket ↔ xterm 双向数据流 (base64 编码)
- [x] ✅ `xterm-addon-fit` — 自动适配容器大小 (+ ResizeObserver)
- [ ] ⬜ 快捷键: Ctrl+C/V (复制/粘贴), Ctrl+Tab (切换)
- [ ] ⬜ 终端分屏 (水平/垂直)
- [x] ✅ 多 Tab 终端管理
- [x] ✅ 主题色匹配 (跟随应用主题，深色终端配色)
- [ ] ⬜ 搜索终端内容

### 🔴 SFTP 侧边栏

- [x] ✅ `SftpSidebar` 组件 — 树形文件浏览器（目录/文件列表）
- [x] ✅ 文件操作: 新建文件夹、上传文件、下载文件（UI 就位）
- [x] ✅ 文件操作: 重命名、删除、复制路径（右键菜单就位）
- [x] ✅ 文件操作: chmod 权限显示（八进制+rwx 模式）
- [ ] ⬜ 拖拽上传 (从系统文件管理器拖入)
- [x] ✅ 文件右键菜单 (上下文操作)
- [x] ✅ 路径面包屑导航 (可点击跳转)
- [x] ✅ 加载状态和进度指示器
- [ ] ⬜ 大文件分块上传/下载

### 🟡 连接状态管理

- [x] ✅ 活跃连接列表 (导航栏指示器)
- [ ] ⬜ 断连检测 → 自动重连 (SSH层面，WebSocket已支持)
- [ ] ⬜ 连接日志 (连接/断开/错误时间线)
- [x] ✅ 一键断开/重连

---

## 阶段 M4: AI + 插件系统 (Week 4-5)

### 🔴 CodeMirror 6 编辑器

- [ ] ⬜ `Editor` 组件 — CodeMirror 初始化
- [ ] ⬜ 30+ 语言语法高亮
- [ ] ⬜ 主题匹配 (跟随应用深色/浅色)
- [ ] ⬜ 自动括号匹配 + 自动缩进
- [ ] ⬜ 行号、代码折叠、搜索替换
- [ ] ⬜ 多 Tab 文件编辑
- [ ] ⬜ 未保存提示 (dot 指示器)

### 🟡 文件格式化

- [ ] ⬜ JSON 格式化/压缩
- [ ] ⬜ YAML 格式化
- [ ] ⬜ Markdown 预览 (实时渲染)
- [ ] ⬜ 文件类型自动识别 (基于扩展名 + 内容嗅探)

### 🔴 AI 辅助功能

- [ ] ⬜ `AiMenu` 组件 — 选中文本后弹出操作菜单
- [ ] ⬜ AI 操作: 解释代码、重构、修复 Bug、优化性能
- [ ] ⬜ OpenRouter API 封装 (`openrouter.ts`)
- [ ] ⬜ 流式输出 (SSE / fetch streaming)
- [ ] ⬜ `DiffView` 组件 — AI 修改前后对比
- [ ] ⬜ 一键应用 / 撤销修改
- [ ] ⬜ AI 配置面板: API Key, 模型选择, 自定义 prompt

### 🔴 插件引擎

- [ ] ⬜ `loader.ts` — 扫描 plugins/ 目录，读取 manifest.json
- [ ] ⬜ `api.ts` — 插件 API 定义
- [ ] ⬜ `sandbox.ts` — iframe + postMessage 隔离沙箱
- [ ] ⬜ 插件生命周期: load → init → enable → disable → destroy
- [ ] ⬜ 开发模式: 文件监听热加载

### 🟡 示例插件

- [x] ✅ JSON 格式化 (`plugins/json-formatter/`) — 格式化/压缩/验证
- [x] ✅ Base64 编解码 (`plugins/base64-encode/`) — 编码/解码
- [x] ✅ 时间戳转换 (`plugins/timestamp-convert/`) — 时间戳⇄日期
- [x] ✅ 正则测试器 (`plugins/regex-tester/`) — 匹配/替换
- [x] ✅ 二维码生成/解析 (`plugins/qrcode/`) — 生成/解析

---

## 阶段 M5: 打磨与发布 (Week 6-7)

### 🟢 PWA 支持

- [ ] ⬜ `vite-plugin-pwa` 配置
- [ ] ⬜ Service Worker 注册
- [ ] ⬜ 离线缓存策略
- [ ] ⬜ PWA 图标集

### 🟢 性能优化

- [ ] ⬜ 路由级代码分割
- [ ] ⬜ 虚拟列表
- [ ] ⬜ 大文件分块加载
- [ ] ⬜ Bundle 分析 + 优化

### 🟢 文档

- [ ] ⬜ `README.md`
- [ ] ⬜ `docs/ARCHITECTURE.md`
- [ ] ⬜ `docs/PLUGIN_API.md`

### 🟢 测试

- [ ] ⬜ SSH Bridge 单元测试
- [ ] ⬜ 前端 stores/services 测试

---

## 总计

| 阶段 | 完成 | 进行中 | 待办 | 合计 |
|------|------|--------|------|------|
| M1 项目初始化 | 10 | 0 | 2 | 12 |
| M2 核心骨架 | 13 | 0 | 10 | 23 |
| M3 SSH + SFTP | 0 | 0 | 19 | 19 |
| M4 AI + 插件 | 5 | 0 | 18 | 23 |
| M5 打磨发布 | 0 | 0 | 11 | 11 |
| **总计** | **28** | **0** | **60** | **88** |
