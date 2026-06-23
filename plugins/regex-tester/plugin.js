// 正则表达式测试器插件
(function () {
  const api = SmartBox.getPluginAPI()

  api.registerCommand('regex-test', {
    label: '测试正则表达式',
    description: '使用当前编辑器内容测试正则匹配',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入要测试的文本', 'warning')
        return
      }

      // 弹出对话框让用户输入正则
      const pattern = prompt('请输入正则表达式（如：\\d+\\.\\d+）：')
      if (!pattern) return

      const flags = prompt('请输入修饰符（如：gi，回车即不使用）：') || ''
      try {
        const regex = new RegExp(pattern, flags)
        let match
        const results = []
        while ((match = regex.exec(content)) !== null) {
          results.push({
            index: match.index,
            match: match[0],
          })
          if (match.index === regex.lastIndex) regex.lastIndex++
        }

        if (results.length === 0) {
          api.showNotification('未找到匹配结果', 'warning')
        } else if (results.length <= 10) {
          const msg = results
            .map((r) => `#${results.indexOf(r) + 1} [位置 ${r.index}]: "${r.match}"`)
            .join('\n')
          api.showNotification(`找到 ${results.length} 个匹配:\n${msg}`, 'success')
        } else {
          api.showNotification(`找到 ${results.length} 个匹配（仅显示前10个）`, 'success')
        }
      } catch (e) {
        api.showNotification('正则表达式语法错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('regex-replace', {
    label: '正则替换',
    description: '使用正则表达式进行替换',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入文本', 'warning')
        return
      }

      const pattern = prompt('请输入要查找的正则表达式：')
      if (!pattern) return

      const flags = prompt('请输入修饰符（如：gi，回车即不使用）：') || ''
      const replacement = prompt('请输入替换文本（可使用 $1, $2 等引用分组）：')
      if (replacement === null) return

      try {
        const regex = new RegExp(pattern, flags)
        const result = content.replace(regex, replacement)
        const diffCount = (content.match(regex) || []).length

        api.setEditorContent(result)
        api.showNotification(`替换完成，共替换 ${diffCount} 处`, 'success')
      } catch (e) {
        api.showNotification('正则表达式语法错误: ' + e.message, 'error')
      }
    }
  })

  console.log('[插件] 正则测试器已加载')
})()
