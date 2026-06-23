# 智盒 (SmartBox) — 开发进度日志

## 2026-06-23 — M1 初始化阶段完成 🚀

### 本日完成

#### M1 脚手架搭建（全部完成 ✅）
- ✅ Vite 6 + React 18 + TypeScript strict 项目初始化
- ✅ Tailwind CSS 3 + 自定义 smartbox 主题色配置
- ✅ ESLint + Prettier 配置
- ✅ 4 个核心 TypeScript 类型模块（ssh/file/plugin/ai）
- ✅ 完整目录结构 + @/ 路径别名

#### M2 核心骨架（部分完成 ✅）
- ✅ 三栏布局系统（Sidebar + Main + RightPanel）
- ✅ 移动端底部导航（< 768px）
- ✅ 深色/浅色/跟随系统主题切换
- ✅ 5 个 Zustand Stores（app/ssh/file/ai/plugin）
- ✅ SSH Bridge 后端服务（WebSocket + ssh2 + SFTP）
  - SSH 连接（密码/密钥认证）
  - 终端数据流（base64 编码）
  - SFTP 全部操作（list/read/write/rename/delete/mkdir/chmod）
  - 心跳检测 + 错误处理 + 优雅关闭

#### 构建验证
- ✅ `vite build` 构建成功（2.49s）
- 产物: JS 344KB / CSS 20.6KB / gzip < 90KB

### 技术决策
1. Tailwind 3.4.19 + PostCSS 方案（Tailwind 4 native 绑定与 Node 18 不兼容）
2. vite-plugin-pwa 在 M5 阶段启用（避免 Node 18 的 terser 兼容问题）
3. 消息协议使用 JSON + base64 编码（兼容二进制数据）
4. 后端使用纯 ES module 语法（Node 18 原生支持）

## 2026-06-23 — M2 SSH + SFTP 核心骨架完成 🚀

### 新增完成

#### M2 网络层
- ✅ WebSocket 客户端（services/websocket.ts）
  - 自动重连（指数退避 1s→30s，最多10次）
  - requestId 请求-响应匹配模式
  - 心跳检测（25s），状态监听器

#### M2 SSH 连接管理
- ✅ ConnectionForm 新建/编辑弹窗
- ✅ ConnectionList 分组列表 + 搜索过滤 + 一键连接
- ✅ 密码认证/密钥认证（私钥粘贴）

#### M2 xterm.js 终端
- ✅ 完整终端组件（深色主题配色）
- ✅ WebSocket ↔ xterm 双向数据流（base64）
- ✅ FitAddon + ResizeObserver 自适应
- ✅ 多 Tab 终端管理 + 状态指示灯 + 清屏

#### M2 SFTP 侧边栏
- ✅ SftpSidebar 树形文件浏览器（目录/文件列表）
- ✅ 面包屑导航（可点击跳转）
- ✅ 文件图标（按扩展名智能识别）
- ✅ 文件和目录预览（权限/大小/时间）
- ✅ 右键菜单（下载/编辑/上传/复制路径/删除）
- ✅ 路径导航（根/上级/刷新）

#### M2 数据持久化（IndexedDB）
- ✅ services/db.ts — 基于 idb 的类型安全封装
- ✅ 4 张表：connections / plugin_data / settings / ai_sessions
- ✅ 自动迁移（数据库版本管理）
- ✅ 快捷函数：saveConnection/listConnections/getSetting/setSetting

#### M2 加密层
- ✅ services/crypto.ts — AES-GCM + PBKDF2 100k 迭代
- ✅ encrypt / decrypt / verifyPassword / createMasterPassword
- ✅ 兼容浏览器和 Node 环境

### 项目状态
- 构建 ✅ 1614 模块 / 3.43s / 0 错误
- 整体进度: 完成 **42/88 任务 (47.7%)**

### 待开始
- M2: 命令面板（Ctrl+P 模糊搜索）
- M2: 加密存储装饰器
- M2: SFTP 文件操作功能串联（新建/删除/重命名调用后端）
- M3: 智能文件管理器
