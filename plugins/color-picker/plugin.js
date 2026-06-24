// 颜色转换工具插件
(function () {
  const api = SmartBox.getPluginAPI()

  /** 解析 HEX 颜色为 RGB 分量 */
  function hexToRgb(hex) {
    const clean = hex.replace(/^#/, '').trim()
    let r, g, b
    if (clean.length === 3) {
      r = parseInt(clean[0] + clean[0], 16)
      g = parseInt(clean[1] + clean[1], 16)
      b = parseInt(clean[2] + clean[2], 16)
    } else if (clean.length === 6) {
      r = parseInt(clean.slice(0, 2), 16)
      g = parseInt(clean.slice(2, 4), 16)
      b = parseInt(clean.slice(4, 6), 16)
    } else {
      return null
    }
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null
    return { r, g, b }
  }

  /** RGB → HEX */
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('')
  }

  /** RGB → HSL */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    let h, s, l = (max + min) / 2

    if (max === min) {
      h = s = 0
    } else {
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
        case g: h = ((b - r) / d + 2) / 6; break
        case b: h = ((r - g) / d + 4) / 6; break
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    }
  }

  /** 提取编辑器中被选中或第一行的颜色值 */
  function extractColor(text) {
    const trimmed = text.trim()
    // HEX
    const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    if (hexMatch) return { type: 'hex', value: '#' + hexMatch[1] }
    // RGB / RGBA
    const rgbMatch = trimmed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (rgbMatch) return { type: 'rgb', value: { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] } }
    return null
  }

  /** 构建输出预览 */
  function buildColorOutput(hex, rgb, hsl) {
    const rows = [
      `HEX:   ${hex}`,
      `RGB:   rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      `HSL:   hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      ``,
      `预览: [${hex}]`,
    ]
    return rows.join('\n')
  }

  api.registerCommand('color-hex-to-rgb', {
    label: 'HEX → RGB',
    description: '将 #FF0000 格式转为 rgb(255, 0, 0)',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入颜色值', 'warning'); return }

      const lines = content.trim().split('\n')
      const results = []

      for (const line of lines) {
        const hexMatch = line.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
        if (hexMatch) {
          const rgb = hexToRgb(line.trim())
          if (rgb) results.push(`${line.trim()} → rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)
        }
      }

      if (results.length === 0) {
        api.showNotification('未找到有效的 HEX 颜色值', 'warning')
        return
      }

      api.setEditorContent(results.join('\n\n'))
      api.showNotification(`转换完成: ${results.length} 个颜色`, 'success')
    }
  })

  api.registerCommand('color-rgb-to-hex', {
    label: 'RGB → HEX',
    description: '将 rgb(255, 0, 0) 转为 #FF0000',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入颜色值', 'warning'); return }

      const lines = content.trim().split('\n')
      const results = []

      for (const line of lines) {
        const rgbMatch = line.trim().match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (rgbMatch) {
          const hex = rgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3])
          results.push(`${line.trim()} → ${hex}`)
        }
      }

      if (results.length === 0) {
        api.showNotification('未找到有效的 RGB 颜色值', 'warning')
        return
      }

      api.setEditorContent(results.join('\n\n'))
      api.showNotification(`转换完成: ${results.length} 个颜色`, 'success')
    }
  })

  api.registerCommand('color-to-hsl', {
    label: '转为 HSL',
    description: '将 HEX/RGB 转为 HSL 格式',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入颜色值', 'warning'); return }

      const lines = content.trim().split('\n')
      const results = []

      for (const line of lines) {
        const trimmed = line.trim()
        let r, g, b

        // HEX
        const hexMatch = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
        if (hexMatch) {
          const rgb = hexToRgb(trimmed)
          if (rgb) { r = rgb.r; g = rgb.g; b = rgb.b }
        }

        // RGB
        const rgbMatch = trimmed.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
        if (rgbMatch) {
          r = +rgbMatch[1]; g = +rgbMatch[2]; b = +rgbMatch[3]
        }

        if (r !== undefined) {
          const hsl = rgbToHsl(r, g, b)
          results.push(`${trimmed} → hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`)
        }
      }

      if (results.length === 0) {
        api.showNotification('未找到有效的颜色值', 'warning')
        return
      }

      api.setEditorContent(results.join('\n\n'))
      api.showNotification(`转换完成: ${results.length} 个颜色`, 'success')
    }
  })

  console.log('[插件] 颜色转换工具已加载')
})()
