// AI 提示词模板库插件
(function () {
  const api = Wrench.getPluginAPI()

  // ── 命令: 代码审查 ──
  api.registerCommand('prompt-code-review', {
    label: '代码审查',
    description: '生成代码审查提示词，对当前代码进行全面审查',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'

      const prompt = `# 代码审查请求

请对以下 ${language} 代码进行全面代码审查。

## 审查要点

1. **代码质量**: 命名规范、代码结构、模块化程度
2. **性能问题**: 潜在的瓶颈、不必要的计算、内存泄漏风险
3. **安全性**: 输入验证、注入风险、敏感信息泄露
4. **可维护性**: 注释完整性、复杂度、重复代码
5. **最佳实践**: 是否符合 ${language} 社区最佳实践
6. **错误处理**: 异常捕获、边界情况处理

## 输出格式

| 问题类型 | 严重程度 | 行号 | 说明 | 建议修复 |
|---------|---------|------|------|---------|
| 性能 | 中 | 42 | ... | ... |

## 需要审查的代码

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\`

## 总结
- 总体评分（1-10）:
- 主要问题:
- 改进建议:`

      insertOrReplace(prompt, content)
    }
  })

  // ── 命令: 重构建议 ──
  api.registerCommand('prompt-refactor', {
    label: '重构建议',
    description: '生成代码重构优化建议提示词',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'

      const prompt = `# 代码重构分析请求

请分析以下 ${language} 代码并提供重构建议。

## 分析维度

1. **单一职责**: 函数/类是否承担了过多职责
2. **重复代码**: 识别 DRY 违反
3. **复杂度**: 圈复杂度分析，拆分建议
4. **依赖关系**: 耦合度评估
5. **可测试性**: 能否方便地编写单元测试
6. **扩展性**: 后续功能添加的难易程度

## 请提供

- **重构方案**: 给出 2-3 种可选的重构策略
- **代码示例**: 关键重构点的代码前后对比
- **风险提示**: 重构可能带来的影响
- **优先级**: 按重要性排序的重构建议

## 当前代码

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\`

## 输出格式
优先展示最关键的重构点，每个重构点包含：问题描述 → 方案 → 示例代码 → 预期效果`

      insertOrReplace(prompt, content)
    }
  })

  // ── 命令: Bug 修复 ──
  api.registerCommand('prompt-fix-bugs', {
    label: 'Bug 修复',
    description: '生成 Bug 分析和修复建议提示词',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'

      const prompt = `# Bug 分析与修复请求

请分析以下 ${language} 代码中的潜在 Bug。

## 分析方向

1. **空指针/未定义访问**: 变量是否为 null/undefined
2. **类型错误**: 类型不匹配、隐式转换
3. **边界条件**: 数组越界、除零、空集合
4. **竞态条件**: 异步操作顺序依赖
5. **资源泄漏**: 未关闭的连接/文件句柄
6. **逻辑错误**: 条件判断、循环终止条件
7. **错误处理**: catch 块是否被吞没

## 错误/异常信息（如有）

\`\`\`
请在此处粘贴错误信息和堆栈跟踪
\`\`\`

## 代码

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\``

      insertOrReplace(prompt, content)
    }
  })

  // ── 命令: 文档生成 ──
  api.registerCommand('prompt-generate-docs', {
    label: '文档生成',
    description: '生成代码文档注释和 README 提示词',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'

      const prompt = `# 文档生成请求

请为以下 ${language} 代码生成文档。

## 要求

1. **函数/方法注释**: 使用 ${language} 标准文档格式（JSDoc/Epydoc/等）
   - 参数说明（类型、用途）
   - 返回值说明
   - 异常说明
   - 使用示例
2. **复杂逻辑说明**: 对非直观的算法或业务逻辑做文字说明
3. **README 片段**: 模块/类的用途和使用方法
4. **代码内联注释**: 对关键行添加注释

## 输出格式

\`\`\`${language}
/**
 * [函数名] - [功能描述]
 * @param {[类型]} [参数名] - [说明]
 * @returns {[类型]} - [说明]
 * @throws {[错误类型]}
 * @example
 * // 使用示例
 */
\`\`\`

## 代码

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\``

      insertOrReplace(prompt, content)
    }
  })

  // ── 命令: 安全审计 ──
  api.registerCommand('prompt-security-audit', {
    label: '安全审计',
    description: '生成代码安全审计提示词',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'

      const prompt = `# 安全审计请求

请对以下 ${language} 代码进行安全审计。

## 审计清单

### 🔴 高风险项
- SQL 注入（拼接查询字符串）
- 命令注入（shell exec）
- 任意文件读写（路径遍历）
- 敏感信息硬编码（密码/密钥/Token）
- 不安全的反序列化

### 🟡 中风险项
- XSS 跨站脚本
- CSRF 防护缺失
- 不安全的直接对象引用
- 错误的认证/授权检查
- 不安全的加密/哈希算法

### 🟢 低风险项
- 信息泄露（详细错误信息）
- 缺少输入验证
- SSL/TLS 配置不当
- 不安全的 CORS 配置

## 代码

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\`

## 输出格式
每个安全问题需包含：**风险等级** | **问题位置** | **详细说明** | **修复建议** | **参考链接**`

      insertOrReplace(prompt, content)
    }
  })

  // ── 命令: 单元测试生成 ──
  api.registerCommand('prompt-unit-test', {
    label: '单元测试生成',
    description: '生成单元测试用例提示词',
    execute: () => {
      const content = api.getEditorContent()
      const language = api.getCurrentFileLanguage() || '未知'
      const testFramework = getTestFramework(language)

      const prompt = `# 单元测试生成请求

请为以下 ${language} 代码生成 ${testFramework} 单元测试。

## 测试覆盖要求

1. **正常路径**: 验证主要功能正确
2. **边界条件**: 空值、极值、特殊字符
3. **错误路径**: 异常输入、失败场景
4. **副作用**: 状态变更、外部调用验证
5. **覆盖率目标**: 分支覆盖率 ≥ 85%

## 测试框架

${testFramework}

## 源文件

\`\`\`${language}
${(content || '// 请先在编辑器中打开代码文件').slice(0, 3000)}
\`\`\`

## 输出格式
生成完整的测试文件，包含所有测试用例，每个用例包含 Arrange-Act-Assert 三段式注释。`

      insertOrReplace(prompt, content)
    }
  })

  // ── 辅助函数 ──

  function getTestFramework(language) {
    const lang = language.toLowerCase()
    if (lang.includes('javascript') || lang.includes('typescript') || lang.includes('js') || lang.includes('ts')) {
      return 'Vitest / Jest (describe/it/expect)'
    } else if (lang.includes('python')) {
      return 'pytest'
    } else if (lang.includes('java')) {
      return 'JUnit 5'
    } else if (lang.includes('go')) {
      return 'testing (go test)'
    } else if (lang.includes('rust')) {
      return '#[test] (cargo test)'
    } else if (lang.includes('c#') || lang.includes('csharp')) {
      return 'xUnit / NUnit'
    } else {
      return '标准测试框架'
    }
  }

  function insertOrReplace(text, existingContent) {
    if (existingContent && existingContent.trim()) {
      // 如果编辑器中已有内容，追加在现有内容下方
      api.setEditorContent(existingContent + '\n\n---\n\n' + text)
    } else {
      api.setEditorContent(text)
    }
    api.showNotification('✅ 提示词已生成，复制后发送给 AI Agent 使用', 'success')
  }

  console.log('[插件] AI 提示词模板库已加载')
})()
