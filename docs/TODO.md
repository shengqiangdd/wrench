# 棘轮工具箱 (Wrench) — TODO 开发任务清单

> 优先级: 🔴 高  🟡 中  🟢 低
> 状态: ⬜ 待办  🟦 进行中  ✅ 完成

---

## 阶段 M3: SSH + SFTP 核心功能 — 🎉 100% 完成

### 🔴 SSH 连接管理器

- [x] ✅ 连接 CRUD（新建/编辑/删除/搜索/过滤）
- [x] ✅ 密码认证（输入/加密保存/自动填充）
- [x] ✅ 密钥认证（粘贴私钥 / 上传 `.pem` 文件）
- [x] ✅ 连接分组管理（分组标签 + 文件夹分类）
- [x] ✅ **快速连接** — 输入临时地址一键连接，不保存凭据
- [x] ✅ **连接测试 (ping)** — WebSocket `test` 命令 + 前端测试按钮/状态指示

### 🔴 xterm.js 终端

- [x] ✅ 终端初始化 + WebSocket 双向数据流（base64）
- [x] ✅ xterm-addon-fit 自动适配窗口大小
- [x] ✅ 多 Tab 终端管理 + 状态指示灯 + 清屏/断开
- [x] ✅ 快捷键: Ctrl+C 复制/SIGINT、Ctrl+V 粘贴、Ctrl+Shift+C/V
- [x] ✅ 终端分屏（SplitContainer 递归分屏，水平/垂直混合）
- [x] ✅ 分屏多主机独立终端实例
- [x] ✅ 主题色匹配（深色终端配色）
- [x] ✅ 搜索终端内容（SearchAddon + 底部搜索面板 + Ctrl+Shift+F 快捷键）
- [x] ✅ 分屏窗口拖拽合并（SplitPane 拖拽 25% 边缘触发、实时 ref 避免 state 过期、4 方向插入）
- [x] ✅ **多主机同步命令** — `onTerminalData` 传透 + `syncGroup`/`syncGroups` 广播机制

### 🔴 SFTP 文件管理

- [x] ✅ 树形文件浏览器 + 面包屑导航
- [x] ✅ 文件图标（26 种扩展名智能识别）
- [x] ✅ 文件操作: 新建文件夹/上传/下载/重命名/删除
- [x] ✅ 右键菜单（复制路径 / 在编辑器中打开/上传）
- [x] ✅ chmod 权限显示（八进制+rwx 模式）
- [x] ✅ 右侧 CodeMirror 编辑器集成
- [x] ✅ 多标签页文件编辑 + 未保存指示
- [x] ✅ 加载状态和进度指示器
- [x] ✅ **拖拽上传**（系统文件拖入 + 工具栏按钮 + 右键菜单"上传到此"，含进度条 + 完成弹窗）
- [x] ✅ **大文件分块上传**（>50MB 自动分块 5MB 逐块上传，SFTP open/write/close + sudo mv）
- [x] ✅ **文件搜索**（本地过滤 + 递归搜索，搜索按钮 + Ctrl+F / Ctrl+Enter 快捷键）

### 🟡 连接状态管理

- [x] ✅ 活跃连接列表（导航栏指示器）
- [x] ✅ WebSocket 自动重连（指数退避，最多 10 次 + 心跳保活 ping）
- [x] ✅ 一键断开/重连
- [x] ✅ SSH 层面断连检测 → 自动重连（WebSocketService 内置 ping/heartbeat）

---

## 阶段 M4: AI + 插件系统 — 🎉 95% 完成

### 🔴 CodeMirror 6 编辑器

- [x] ✅ 完整 CodeMirror 6 组件 — 20+ 语言语法高亮
- [x] ✅ AI 代码操作菜单（选中代码 → ✨ 按钮 → 6 种操作 → 左右对比 → 一键应用）
- [x] ✅ 古腾堡暗色主题（跟随应用主题）
- [x] ✅ 自动括号匹配 + 自动缩进 + 自动补全
- [x] ✅ 行号、代码折叠、搜索替换
- [x] ✅ 多 Tab 文件编辑 + IndexedDB 自动保存
- [x] ✅ 未保存提示 (dot 指示器) + Ctrl+S / 双击保存到远程
- [x] ✅ 文件类型自动识别（内容嗅探 — shebang + magic bytes + 已知文件名）

### 🟡 文件格式化

- [x] ✅ JSON 格式化/压缩/验证（通过插件 json-formatter）
- [x] ✅ Base64 编解码（通过插件 base64-encode）
- [x] ✅ YAML 格式化/验证/→JSON 转换（通过插件 yaml-formatter）
- [x] ✅ Markdown 预览（零外部依赖 MD→HTML 渲染器）

### 🔴 插件系统

- [x] ✅ PluginSandbox iframe 沙箱容器 — `allow-scripts` 隔离
- [x] ✅ postMessage 通信协议（sandbox-ready / registerCommand / setEditorContent / notification）
- [x] ✅ 插件代码通过 Blob URL 注入，无文件系统写入
- [x] ✅ 编辑器内容双向同步
- [x] ✅ 插件生命周期：load → enable → disable → destroy
- [x] ✅ 插件管理页面：启用/禁用/命令列表/一键执行
- [x] ✅ pluginSandboxManager 沙箱实例管理器
- [x] ✅ 13 个内置插件（共 42 条命令）
- [x] ✅ 后端 `/api/plugins` 自动扫描 + 静态提供 JS 文件
- [x] ✅ **插件市场** — 在线安装/更新插件（后端 market/install/uninstall API + 前端 PluginMarket 组件）
- [x] ✅ **插件热加载** — 开发模式 fs.watch 监听 + WebSocket 广播 plugins-changed + 前端自动重载

### 🔴 AI 辅助功能

- [x] ✅ AI 侧边栏（对话列表 + OpenRouter API + 预设助理）
- [x] ✅ AI 配置面板（API Key / 模型选择 / 自定义提示词）
- [x] ✅ 知识库文件选择（关联到 AI 对话上下文）
- [x] ✅ AI 代码操作菜单（选中代码 → ✨ 按钮 → 6 种操作）
- [x] ✅ ai-operations.ts 服务层（prompt 构建 / API 调用 / 流式解析 / diff 差异统计）

---

## 阶段 M5: 打磨与发布

### 🟢 PWA

- [x] ✅ vite-plugin-pwa 集成 + Workbox 预缓存
- [x] ✅ PWA 应用图标 + manifest + Apple meta
- [x] ✅ Service Worker + 离线缓存策略
- [x] ✅ **离线页面体验优化** — 网络状态指示条（在线/离线实时监测+提示）

### 🟢 性能优化

- [x] ✅ **路由级代码分割** — React.lazy + Suspense，4 个 Tab 模块独立 chunk
- [x] ✅ **Bundle 优化** — manualChunks 拆分 xterm / CodeMirror / router / zustand / lucide / idb 为独立 vendor chunk
- [x] ✅ **虚拟列表（文件树）** — VirtualList 组件，100 项阈值自动切换

### 🟢 用户体验

- [x] ✅ 亮色/暗色/跟随系统主题切换
- [x] ✅ 命令面板（Ctrl+P 模糊搜索）
- [x] ✅ 面板拖拽调整宽度 + 双击重置
- [x] ✅ Toast 通知系统
- [x] ✅ 快捷键列表展示（命令面板中「快捷键列表」命令 + Shift+? 快捷键打开模态框）
- [x] ✅ 数据导出/导入（SSH 连接 / AI 配置 / 插件列表 / UI 偏好，AES-GCM 加密 / 明文导出，去重合并导入）

### 🟢 文档

- [x] ✅ README.md / CHANGELOG.md / CONTRIBUTING.md / DEPLOY.md
- [x] ✅ docs/PLUGIN_API.md — 插件开发文档（9720 字）
- [x] ✅ docs/ARCHITECTURE.md — 全面架构文档（402行，含整体架构/模块划分/数据流/安全设计/ADR）

### 🟢 CI/CD

- [x] ✅ GitHub Actions CI（类型检查 + 构建）
- [x] ✅ Docker 构建 + 自动部署
- [x] ✅ 每周镜像清理策略

---

## 总计

| 阶段 | 完成 | 待办 | 合计 | 进度 |
|------|------|------|------|------|
| M3 SSH + SFTP | 27 | 0 | 27 | 🎉 100% |
| M4 AI + 插件 | 20 | 0 | 20 | 🎉 100% |
| M5 打磨发布 | 17 | 0 | 17 | 🎉 100% |
| **总计** | **64** | **0** | **64** | **🎉 100% 完工** |
