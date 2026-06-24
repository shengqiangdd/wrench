# SmartBox 插件开发文档

> SmartBox 插件运行在 **iframe 沙箱** 中，代码与主应用完全隔离，通过 `postMessage` 异步通信。  
> 所有插件必须通过 `SmartBox.getPluginAPI()` 获取 API 对象，**不能访问主应用 DOM、全局变量或 Node.js API**。

---

## 目录

1. [插件结构](#1-插件结构)
2. [manifest.json 规范](#2-manifestjson-规范)
3. [插件 JS 编写规范](#3-插件-js-编写规范)
4. [PluginAPI 参考](#4-pluginapi-参考)
5. [完整示例](#5-完整示例)
6. [调试指南](#6-调试指南)
7. [发布到插件市场](#7-发布到插件市场)

---

## 1. 插件结构

一个插件由两个文件组成，放在 `plugins/<插件ID>/` 目录下：

```
plugins/
└── my-plugin/
    ├── manifest.json    # 插件元数据（必填）
    └── plugin.js        # 插件逻辑代码（必填）
```

| 文件 | 说明 |
|---|---|
| `manifest.json` | 插件名称、版本、命令列表等元信息 |
| `plugin.js` | 用 IIFE 包裹的 JS 代码，通过 `SmartBox.getPluginAPI()` 操作 |

---

## 2. manifest.json 规范

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "description": "简短的功能描述",
  "author": "作者名",
  "icon": "star",
  "commands": [
    {
      "id": "my-command",
      "label": "执行命令",
      "description": "命令的详细说明",
      "icon": "zap",
      "keywords": ["关键词1", "关键词2"]
    }
  ],
  "panels": [
    {
      "id": "my-panel",
      "title": "我的面板",
      "icon": "star"
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 唯一标识符，须与目录名一致，小写字母+连字符 |
| `name` | string | ✅ | 插件显示名称 |
| `version` | string | ✅ | 语义化版本号，如 `1.0.0` |
| `description` | string | ✅ | 一句话描述插件功能 |
| `author` | string | ✅ | 作者名称或组织名 |
| `icon` | string | 否 | Lucide 图标名称（如 `star`, `zap`, `git-compare`） |
| `commands` | array | 否 | 注册的命令列表，每条命令会显示在命令面板中 |
| `panels` | array | 否 | 注册的面板列表 |

### Command 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 命令标识符，插件内唯一 |
| `label` | string | ✅ | 显示在按钮/命令面板中的名称 |
| `description` | string | 否 | 命令的详细说明（显示为 tooltip） |
| `icon` | string | 否 | Lucide 图标名称 |
| `keywords` | string[] | 否 | 搜索关键词（帮助用户在命令面板中找到） |

### Panel 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✅ | 面板标识符 |
| `title` | string | ✅ | 面板标题 |
| `icon` | string | 否 | Lucide 图标名称 |

---

## 3. 插件 JS 编写规范

### 3.1 基础模板

```javascript
// plugins/my-plugin/plugin.js
(function () {
  'use strict'

  const api = SmartBox.getPluginAPI()

  // 注册命令
  api.registerCommand(
    { id: 'hello', label: '打招呼', description: '向用户问好' },
    function (args) {
      api.showNotification('你好！插件运行正常 🎉', 'success')
    }
  )

  console.log('[插件] my-plugin 已加载')
})()
```

### 3.2 编写规则

1. **必须使用 IIFE**（立即执行函数表达式）包裹代码，避免污染全局作用域
2. **必须使用 `'use strict'`** 启用严格模式
3. **不得访问** `window.parent`、`top`、`document.cookie`、`fetch`（直接调用）
4. **网络请求** 应使用 `api.fetch()` 而非原生 `fetch`（通过主应用代理，带超时支持）
5. **DOM 操作** 仅限于 `document.getElementById('plugin-root')` 内的元素
6. **不要使用** `alert`、`prompt`、`confirm`（无效果）

---

## 4. PluginAPI 参考

通过 `SmartBox.getPluginAPI()` 获取 API 对象，所有方法如下：

### 4.1 注册命令

```javascript
api.registerCommand(commandDef, handler)
```

- `commandDef`: `{ id: string, label: string, description?: string, icon?: string, keywords?: string[] }`
- `handler`: `function(args: any[])` — 用户执行命令时的回调

注册后，命令会自动出现在 **命令面板**（Ctrl+K）中。

### 4.2 注册面板

```javascript
api.registerPanel(panelDef, renderFunction)
```

- `panelDef`: `{ id: string, name: string, icon?: string, position: 'sidebar' | 'main' | 'modal' }`
- `renderFunction`: `function(rootElement: HTMLElement)` — 在此函数中渲染面板内容

### 4.3 编辑器操作

```javascript
// 获取编辑器当前内容
const content = api.getEditorContent()

// 设置编辑器内容
api.setEditorContent('新的文件内容')

// 获取当前文件语言
const lang = api.getCurrentFileLanguage()  // 如 'javascript', 'python', null
```

### 4.4 通知

```javascript
api.showNotification(message, type)
```

- `message`: 通知文本
- `type`: `'info'` | `'success'` | `'error'`

### 4.5 隔离存储

每个插件拥有独立的、带前缀的 localStorage 空间，最多 50KB。

```javascript
const storage = api.storage

storage.get('key')        // 获取值（string | null）
storage.set('key', '值')  // 存储值
storage.remove('key')     // 删除值
storage.clear()           // 清空当前插件的所有存储
```

### 4.6 网络请求

```javascript
// 通过主应用代理的 fetch，支持超时
const response = await api.fetch(url, options)
const data = JSON.parse(response.body)
```

> ⚠️ `api.fetch` 返回的是 `{ status, headers, body }` 对象，`body` 为字符串。如需 JSON 需手动 `JSON.parse`。

### 4.7 面板根元素

```javascript
const root = api.getRootElement()  // <div id="plugin-root">
root.innerHTML = '<p>Hello from plugin!</p>'
```

### 4.8 环境信息

```javascript
api.getPluginId()          // 插件 ID
api.getPluginInfo()        // 完整 manifest 对象（只读）
```

---

## 5. 完整示例

### 示例 1: 最小可用插件

<details>
<summary>manifest.json</summary>

```json
{
  "id": "hello-world",
  "name": "你好世界",
  "version": "1.0.0",
  "description": "一个打招呼的示例插件",
  "author": "SmartBox",
  "commands": [
    {
      "id": "say-hello",
      "label": "打招呼",
      "description": "在通知栏显示问候语",
      "keywords": ["hello", "greeting", "你好"]
    }
  ]
}
```

</details>

<details>
<summary>plugin.js</summary>

```javascript
(function () {
  'use strict'

  const api = SmartBox.getPluginAPI()

  api.registerCommand(
    { id: 'say-hello', label: '打招呼', description: '在通知栏显示问候语' },
    function () {
      const name = api.getPluginInfo().name
      api.showNotification(`你好！我是 ${name} 插件 🎉`, 'success')
    }
  )

  console.log('[插件] hello-world 已加载')
})()
```

</details>

### 示例 2: 编辑器内容处理

详见 `plugins/timestamp-convert/plugin.js`：

- 读取编辑器内容
- 处理数据（时间戳转日期）
- 写回编辑器
- 显示结果通知

### 示例 3: 文本对比

详见 `plugins/diff-checker/plugin.js`：

- 读取编辑器内容和剪贴板
- 执行 LCS 差异算法
- 格式化输出差异结果到编辑器

---

## 6. 调试指南

### 控制台日志

插件可以使用 `console.log`、`console.warn`、`console.error`，输出会显示在主应用的控制台中，前缀为 `[Plugin:<插件ID>]`。

### 通知调试

在代码的关键步骤插入 `api.showNotification('消息', 'info')` 可在界面看到执行流程。

### 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| 插件不显示 | manifest.json 格式错误 | 检查 JSON 格式，确保 `id`/`name` 字段存在 |
| 命令点不动 | 沙箱未就绪 | 检查 iframe 是否成功加载，查看控制台有无错误 |
| `SmartBox is not defined` | 插件代码直接执行而非通过沙箱 | 确保用 `SmartBox.getPluginAPI()` 而非直接引用 |
| 存储没有生效 | 超出 50KB 配额 | 使用 `storage.remove` 清理不再需要的数据 |

---

## 7. 发布到插件市场

要将插件发布到 SmartBox 官方市场：

1. **Fork 仓库**：`github.com/shengqiangdd/smartbox-plugins`
2. **创建插件目录**：`plugins/your-plugin/`
3. **添加文件**：
   - `manifest.json`
   - `plugin.js`
4. **更新市场索引**：在根目录 `index.json` 中添加你的插件条目
5. **提交 PR**

市场索引格式：

```json
{
  "plugins": [
    {
      "id": "your-plugin",
      "name": "你的插件",
      "version": "1.0.0",
      "description": "功能描述",
      "author": "作者",
      "tags": ["工具"],
      "manifestUrl": "https://raw.githubusercontent.com/shengqiangdd/smartbox-plugins/main/plugins/your-plugin/manifest.json",
      "pluginUrl": "https://raw.githubusercontent.com/shengqiangdd/smartbox-plugins/main/plugins/your-plugin/plugin.js"
    }
  ]
}
```

> ⚠️ 所有 URL 必须是 **raw.githubusercontent.com** 的原始文件链接，不能是 GitHub 页面链接。

---

## 附录: 全局对象参考

沙箱内可用的全局对象：

| 对象 | 说明 |
|---|---|
| `SmartBox` | 插件 API 入口，唯一全局对象 |
| `SmartBox.getPluginAPI()` | 返回 `PluginAPI` 对象 |
| `document` | 受限 DOM，仅能操作 `#plugin-root` 内部 |
| `console` | 受限控制台（仅 debug 级别） |
| `localStorage` | 受前缀隔离的存储（不建议直接使用，用 `api.storage` 代替） |

**不可用**：`window.parent`、`window.top`、`fetch`（直接）、`XMLHttpRequest`、`WebSocket`、`Worker`、`SharedWorker`。

---

> **提示**：本地开发时，将插件文件放入 `plugins/` 目录后，点击插件页面的「刷新」按钮即可重新加载。
