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

### 分支规范

- `main` — 稳定版
- `dev` — 开发版
- `feature/xxx` — 新功能
- `fix/xxx` — 修复
- `docs/xxx` — 文档更新

### 开发流程

1. Fork 仓库并创建分支
2. 安装依赖：
   ```bash
   cd frontend && npm install
   cd ../bridge && npm install
   ```
3. 启动开发服务器：
   ```bash
   # 终端 1
   cd bridge && node index.js
   # 终端 2
   cd frontend && npm run dev
   ```
4. 提交前确保构建通过：
   ```bash
   cd frontend && npm run build
   ```
5. 提交 PR 到 `dev` 分支

### 提交信息规范

```
<type>: <简短描述>

<详细描述（可选）>
```

类型：`feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `ci`

## 📐 代码风格

- TypeScript：严格模式
- 组件：函数式组件 + Hooks
- 状态管理：Zustand
- 样式：Tailwind CSS

## 📄 许可证

提交代码即表示您同意您的贡献基于 [MIT](LICENSE) 许可证发布。
