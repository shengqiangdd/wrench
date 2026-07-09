// AI Agent 技能生成器插件
(function () {
  const api = Wrench.getPluginAPI()

  // ── 命令: 生成 Shell 脚本 ──
  api.registerCommand('ai-skill-generate', {
    label: '生成 Shell 脚本',
    description: '根据文本描述自动生成可执行的 Shell 脚本',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请在编辑器中输入任务描述，然后运行此命令生成脚本', 'info')
        return
      }

      const taskDesc = content.trim()
      const lines = taskDesc.split('\n')
      const safeDesc = lines[0].length > 80 ? lines[0].slice(0, 80) + '...' : lines[0]

      // 生成一个基本的 bash 脚本框架
      const script = generateShellScript(taskDesc)
      api.setEditorContent(script)
      api.showNotification('✅ Shell 脚本已生成，请检查并根据需要调整', 'success')
    }
  })

  // ── 命令: 提示词优化 ──
  api.registerCommand('ai-skill-format-prompt', {
    label: '提示词优化',
    description: '优化和格式化自然语言提示词',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请在编辑器中输入需要优化的提示词', 'info')
        return
      }

      const formatted = formatPrompt(content.trim())
      api.setEditorContent(formatted)
      api.showNotification('✅ 提示词已优化为结构化格式', 'success')
    }
  })

  // ── 命令: 命令向导 ──
  api.registerCommand('ai-skill-command-wizard', {
    label: '命令向导',
    description: '分步引导式创建自定义 AI Agent 技能',
    execute: () => {
      const content = api.getEditorContent()
      const template = `# AI Agent 技能定义模板
#
# 请根据以下模板填写您的技能信息
# ---

## 技能名称
${content ? extractTitle(content) : '请输入技能名称'}

## 触发条件
# 描述在什么情况下触发此技能
- 关键词: [关键词1], [关键词2]
- 输入来源: [编辑器 / 终端 / 通知]

## 执行逻辑
# 描述技能执行的步骤
1. 
2. 
3. 

## 输出格式
# 描述输出的格式（shell 命令 / 格式化文本 / 通知）
- 类型: 
- 格式: 

## 示例
\`\`\`
# 在此处添加示例
\`\`\`
`
      api.setEditorContent(template)
      api.showNotification('📋 技能模板已生成，请填写各部分内容', 'info')
    }
  })

  // ── 辅助函数 ──

  function generateShellScript(description) {
    const hasInstall = /安装|install|setup/i.test(description)
    const hasCheck = /检查|check|status|状态|health/i.test(description)
    const hasBackup = /备份|backup/i.test(description)
    const hasClean = /清理|clean|clear|delete|删除/i.test(description)
    const hasMonitor = /监控|monitor|watch/i.test(description)
    const hasDeploy = /部署|deploy|发布|release/i.test(description)

    const script = []
    script.push('#!/bin/bash')
    script.push('#')
    script.push(`# 自动生成脚本: ${description.split('\\n')[0]}`)
    script.push(`# 生成时间: ${new Date().toLocaleString('zh-CN')}`)
    script.push('#')
    script.push('')
    script.push('set -euo pipefail')
    script.push('')

    if (hasCheck) {
      script.push('# === 状态检查 ===')
      script.push('echo "📊 系统状态检查..."')
      script.push('echo ""')
      script.push('echo "--- CPU ---"')
      script.push('top -bn1 | head -5 2>/dev/null || echo "  (top not available)"')
      script.push('echo ""')
      script.push('echo "--- 内存 ---"')
      script.push('free -h 2>/dev/null || echo "  (free not available)"')
      script.push('echo ""')
      script.push('echo "--- 磁盘 ---"')
      script.push('df -h / 2>/dev/null || echo "  (df not available)"')
      script.push('')
    }

    if (hasInstall) {
      script.push('# === 安装 ===')
      script.push('echo "📦 开始安装..."')
      script.push('')
      script.push('if command -v apt-get &>/dev/null; then')
      script.push('  echo "  检测到 apt 包管理器"')
      script.push('  # TODO: 添加需要安装的包')
      script.push('  # sudo apt-get update && sudo apt-get install -y <包名>')
      script.push('elif command -v yum &>/dev/null; then')
      script.push('  echo "  检测到 yum 包管理器"')
      script.push('  # TODO: 添加需要安装的包')
      script.push('  # sudo yum install -y <包名>')
      script.push('elif command -v brew &>/dev/null; then')
      script.push('  echo "  检测到 Homebrew"')
      script.push('  # TODO: 添加需要安装的包')
      script.push('  # brew install <包名>')
      script.push('else')
      script.push('  echo "  ⚠️ 未检测到已知包管理器"')
      script.push('fi')
      script.push('')
    }

    if (hasBackup) {
      script.push('# === 备份 ===')
      script.push('echo "💾 开始备份..."')
      script.push('')
      script.push('BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"')
      script.push('mkdir -p "$BACKUP_DIR"')
      script.push('')
      script.push('# TODO: 指定需要备份的文件或目录')
      script.push('echo "  备份目标: $BACKUP_DIR"')
      script.push('# cp -r <源路径> "$BACKUP_DIR/"')
      script.push('')
      script.push('echo "✅ 备份完成"')
      script.push('')
    }

    if (hasClean) {
      script.push('# === 清理 ===')
      script.push('echo "🧹 开始清理..."')
      script.push('')
      script.push('echo "  清理临时文件..."')
      script.push('rm -rf /tmp/* 2>/dev/null || true')
      script.push('')
      script.push('echo "  清理 apt 缓存..."')
      script.push('sudo apt-get clean 2>/dev/null || true')
      script.push('')
      script.push('echo "✅ 清理完成"')
      script.push('')
    }

    if (hasMonitor) {
      script.push('# === 监控 ===')
      script.push('echo "👁️ 开始监控..."')
      script.push('')
      script.push('INTERVAL=${1:-2}  # 默认 2 秒')
      script.push('echo "  监控间隔: ${INTERVAL}s"')
      script.push('echo "  按 Ctrl+C 退出"')
      script.push('echo ""')
      script.push('while true; do')
      script.push('  clear')
      script.push('  echo "=== $(date) ==="')
      script.push('  echo ""')
      script.push('  echo "--- CPU 负载 ---"')
      script.push('  uptime')
      script.push('  echo ""')
      script.push('  echo "--- 进程 Top 5 ---"')
      script.push('  ps aux --sort=-%cpu | head -6')
      script.push('  sleep "$INTERVAL"')
      script.push('done')
      script.push('')
    }

    if (hasDeploy) {
      script.push('# === 部署 ===')
      script.push('echo "🚀 开始部署..."')
      script.push('')
      script.push('APP_NAME="${APP_NAME:-myapp}"')
      script.push('DEPLOY_DIR="${DEPLOY_DIR:-/opt/$APP_NAME}"')
      script.push('')
      script.push('echo "  应用: $APP_NAME"')
      script.push('echo "  目标: $DEPLOY_DIR"')
      script.push('')
      script.push('# 1. 拉取最新代码')
      script.push('if [ -d "$DEPLOY_DIR/.git" ]; then')
      script.push('  cd "$DEPLOY_DIR"')
      script.push('  git pull origin main')
      script.push('else')
      script.push('  echo "  ⚠️ 目录不存在或不是 Git 仓库"')
      script.push('  # git clone <仓库URL> "$DEPLOY_DIR"')
      script.push('fi')
      script.push('')
      script.push('# 2. 安装依赖')
      script.push('# cd "$DEPLOY_DIR"')
      script.push('# npm install  # 或 pip install, composer install 等')
      script.push('')
      script.push('# 3. 重启服务')
      script.push('# systemctl restart "$APP_NAME"')
      script.push('# pm2 restart "$APP_NAME"')
      script.push('')
      script.push('echo "✅ 部署完成"')
      script.push('')
    }

    // 通用 fallback
    if (!hasCheck && !hasInstall && !hasBackup && !hasClean && !hasMonitor && !hasDeploy) {
      script.push('# === 主逻辑 ===')
      script.push('echo "🔧 执行中..."')
      script.push('echo ""')
      script.push('# TODO: 根据实际需求添加命令')
      script.push('echo "  任务: ' + (description.split('\n')[0] || '未指定') + '"')
      script.push('')
      script.push('# 在此处添加您的命令')
      script.push('')
    }

    script.push('')
    script.push('echo "✅ 执行完毕"')

    return script.join('\n')
  }

  function formatPrompt(input) {
    const sentences = input.split(/[.。!！?？\n]+/).filter(s => s.trim())

    let result = '# 优化后的提示词\n'
    result += '# 结构清晰，便于 AI Agent 理解\n'
    result += '---\n\n'

    result += '## 角色设定\n'
    result += '你是一个专业的 AI 助手，擅长处理以下任务。\n\n'
    result += '## 任务目标\n'
    sentences.forEach((s, i) => {
      if (s.trim()) {
        result += `${i + 1}. ${s.trim()}\n`
      }
    })

    result += '\n## 约束条件\n'
    result += '- 基于事实回答，不确定时说明不确定性\n'
    result += '- 输出结构清晰，使用 Markdown 格式\n'
    result += '- 如果涉及代码，使用代码块标注语言\n'

    result += '\n## 输出格式\n'
    result += '请按照以下结构输出：\n'
    result += '1. 简要结论\n'
    result += '2. 详细分析\n'
    result += '3. 参考来源（如有）\n'

    return result
  }

  function extractTitle(content) {
    // 取第一段有意义的文字作为标题
    const lines = content.split('\n').filter(l => l.trim())
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[#*\-\s]+/, '')
      if (trimmed && trimmed.length < 50) return trimmed
    }
    return '自定义技能'
  }

  console.log('[插件] AI Agent 技能生成器已加载')
})()
