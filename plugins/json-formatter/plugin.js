// JSON 格式化插件
(function () {
  const api = SmartBox.getPluginAPI()

  api.registerCommand('json-format', {
    label: '格式化 JSON',
    description: '美化当前编辑器中的 JSON 内容',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        const parsed = JSON.parse(content)
        const formatted = JSON.stringify(parsed, null, 2)
        api.setEditorContent(formatted)
        api.showNotification('JSON 格式化完成', 'success')
      } catch (e) {
        api.showNotification('JSON 解析错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('json-compress', {
    label: '压缩 JSON',
    description: '压缩当前编辑器中的 JSON 为单行',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        const parsed = JSON.parse(content)
        const compressed = JSON.stringify(parsed)
        api.setEditorContent(compressed)
        api.showNotification('JSON 压缩完成', 'success')
      } catch (e) {
        api.showNotification('JSON 解析错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('json-validate', {
    label: '验证 JSON',
    description: '检查当前 JSON 是否有语法错误',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        JSON.parse(content)
        api.showNotification('JSON 语法正确 ✓', 'success')
      } catch (e) {
        api.showNotification('JSON 语法错误: ' + e.message, 'error')
      }
    }
  })

  console.log('[插件] JSON 格式化已加载')
})()
