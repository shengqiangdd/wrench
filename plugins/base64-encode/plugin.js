// Base64 编解码插件
(function () {
  const api = Wrench.getPluginAPI()

  api.registerCommand('base64-encode', {
    label: 'Base64 编码',
    description: '将文本编码为 Base64',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开或输入文本', 'warning')
        return
      }
      try {
        const encoded = btoa(unescape(encodeURIComponent(content)))
        api.setEditorContent(encoded)
        api.showNotification('Base64 编码完成', 'success')
      } catch (e) {
        api.showNotification('编码失败: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('base64-decode', {
    label: 'Base64 解码',
    description: '将 Base64 解码为原始文本',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 Base64 内容', 'warning')
        return
      }
      try {
        const decoded = decodeURIComponent(escape(atob(content)))
        api.setEditorContent(decoded)
        api.showNotification('Base64 解码完成', 'success')
      } catch (e) {
        api.showNotification('解码失败: 内容不是有效的 Base64', 'error')
      }
    }
  })

  console.log('[插件] Base64 编解码已加载')
})()
