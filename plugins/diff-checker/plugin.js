// 文本对比工具插件
(function () {
  const api = Wrench.getPluginAPI()

  /**
   * 简单 LCS 差分算法：返回逐行 diff 结果
   * @returns {Array<{type: 'same'|'add'|'remove', text: string}>}
   */
  function lineDiff(oldLines, newLines) {
    const m = oldLines.length
    const n = newLines.length

    // DP 表计算 LCS 长度
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }

    // 回溯得到 diff 结果
    const result = []
    let i = m, j = n
    const temp = []

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        temp.push({ type: 'same', text: oldLines[i - 1] })
        i--
        j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        temp.push({ type: 'add', text: newLines[j - 1] })
        j--
      } else {
        temp.push({ type: 'remove', text: oldLines[i - 1] })
        i--
      }
    }

    return temp.reverse()
  }

  function formatDiffResult(diff) {
    let output = ''
    let addCount = 0
    let removeCount = 0

    for (const d of diff) {
      if (d.type === 'same') {
        output += '  ' + d.text + '\n'
      } else if (d.type === 'add') {
        output += '+ ' + d.text + '\n'
        addCount++
      } else if (d.type === 'remove') {
        output += '- ' + d.text + '\n'
        removeCount++
      }
    }

    const stats = []
    if (removeCount > 0) stats.push(`-${removeCount} 行`)
    if (addCount > 0) stats.push(`+${addCount} 行`)
    const summary = stats.length > 0
      ? `\n━━━ 差异统计 ━━━\n删除: ${removeCount} 行  新增: ${addCount} 行`
      : '\n两个文本完全一致，无差异 ✓'

    return output + summary
  }

  api.registerCommand('diff-compare', {
    label: '比较差异',
    description: '与剪贴板内容进行行级对比',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }

      // 尝试读取剪贴板
      navigator.clipboard.readText().then(clipText => {
        if (!clipText) {
          api.showNotification('剪贴板为空，请先复制要对比的文本', 'warning')
          return
        }

        const oldLines = content.split('\n')
        const newLines = clipText.split('\n')

        const diff = lineDiff(oldLines, newLines)
        const result = formatDiffResult(diff)

        api.setEditorContent(result)
        api.showNotification('差异对比完成', 'success')
      }).catch(() => {
        api.showNotification('无法读取剪贴板，请在编辑器中手动输入对比文本', 'error')
      })
    }
  })

  console.log('[插件] 文本对比工具已加载')
})()
