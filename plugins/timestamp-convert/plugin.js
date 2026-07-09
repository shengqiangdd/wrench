// 时间戳转换插件
(function () {
  const api = Wrench.getPluginAPI()

  api.registerCommand('ts-to-date', {
    label: '时间戳 → 日期',
    description: '将 Unix 时间戳（毫秒/秒）转为可读日期',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入时间戳', 'warning')
        return
      }

      const input = content.trim()
      // 尝试解析输入（支持毫秒和秒级时间戳）
      let ts = parseInt(input, 10)
      if (isNaN(ts)) {
        api.showNotification('输入内容不是有效数字', 'error')
        return
      }

      // 秒级时间戳转为毫秒
      if (ts < 10000000000) {
        ts = ts * 1000
      }

      const date = new Date(ts)
      if (isNaN(date.getTime())) {
        api.showNotification('无法解析为有效日期', 'error')
        return
      }

      const results = [
        `输入: ${input}`,
        `━━━━━━━━━━━━━━━━━━`,
        `UTC:     ${date.toUTCString()}`,
        `本地:    ${date.toLocaleString()}`,
        `ISO:     ${date.toISOString()}`,
        `日期:    ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        `时间:    ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
        `星期:    ${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`,
        `━━━━━━━━━━━━━━━━━━`,
        `毫秒戳:  ${ts}`,
        `秒戳:    ${Math.floor(ts / 1000)}`,
      ].join('\n')

      api.setEditorContent(results)
      api.showNotification('时间戳转换完成', 'success')
    }
  })

  api.registerCommand('date-to-ts', {
    label: '日期 → 时间戳',
    description: '将日期字符串转为 Unix 时间戳（毫秒）',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入日期文本', 'warning')
        return
      }

      const input = content.trim()
      const date = new Date(input)

      if (isNaN(date.getTime())) {
        api.showNotification('无法解析输入为日期，请使用 YYYY-MM-DD 或 ISO 格式', 'error')
        return
      }

      const ms = date.getTime()
      const s = Math.floor(ms / 1000)

      const results = [
        `输入: ${input}`,
        `━━━━━━━━━━━━━━━━━━`,
        `毫秒时间戳:  ${ms}`,
        `秒时间戳:    ${s}`,
        `━━━━━━━━━━━━━━━━━━`,
        `UTC:  ${date.toUTCString()}`,
        `本地: ${date.toLocaleString()}`,
        `ISO:  ${date.toISOString()}`,
      ].join('\n')

      api.setEditorContent(results)
      api.showNotification('日期转时间戳完成', 'success')
    }
  })

  console.log('[插件] 时间戳转换已加载')
})()
