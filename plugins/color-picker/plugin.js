// 颜色转换工具插件
(function () {
  const api = Wrench.getPluginAPI()

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

  // ── 面板注册: 颜色转换 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('color-panel', {
      title: '颜色转换',
      icon: 'palette',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🎨 颜色转换工具</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<div class="pf-row"><div style="flex:1"><div class="pf-label">颜色值</div><input class="pf-input" id="cp-hex" value="#3b82f6" placeholder="#FF0000" /></div>' +
          '<div style="width:48px"><div class="pf-label">预览</div><div id="cp-preview" style="height:34px;border-radius:6px;background:#3b82f6;border:1px solid #334155"></div></div></div>' +
          '<div class="pf-row"><input type="color" id="cp-picker" value="#3b82f6" style="width:48px;height:34px;border:none;cursor:pointer;background:transparent" /></div>' +
          '<div class="pf-label">转换结果</div>' +
          '<div id="cp-result" class="pf-result">HEX:   #3b82f6\nRGB:   rgb(59, 130, 246)\nHSL:   hsl(217, 91%, 60%)</div></div>';

        var hexInput = container.querySelector('#cp-hex');
        var preview = container.querySelector('#cp-preview');
        var resultEl = container.querySelector('#cp-result');
        var picker = container.querySelector('#cp-picker');

        function hexToRgb(hex) {
          var c = hex.replace(/^#/, '');
          if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
          if (c.length !== 6) return null;
          var r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
          if (isNaN(r)||isNaN(g)||isNaN(b)) return null;
          return {r:r,g:g,b:b};
        }

        function rgbToHsl(r,g,b) {
          r/=255;g/=255;b/=255;
          var max=Math.max(r,g,b),min=Math.min(r,g,b),h,s,l=(max+min)/2;
          if(max===min){h=s=0}else{var d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break}}
          return{h:Math.round(h*360),s:Math.round(s*100),l:Math.round(l*100)};
        }

        function update(hex) {
          var rgb = hexToRgb(hex);
          if (!rgb) return;
          var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
          preview.style.background = hex;
          resultEl.textContent = 'HEX:   ' + hex.toUpperCase() + '\nRGB:   rgb(' + rgb.r + ', ' + rgb.g + ', ' + rgb.b + ')\nHSL:   hsl(' + hsl.h + ', ' + hsl.s + '%, ' + hsl.l + '%)';
          picker.value = hex.length === 4 ? '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3] : hex;
        }

        hexInput.addEventListener('input', function() {
          var val = this.value.trim();
          if (/^#?[0-9a-fA-F]{3,6}$/.test(val)) {
            update(val.charAt(0) === '#' ? val : '#' + val);
          }
        });
        picker.addEventListener('input', function() {
          hexInput.value = this.value;
          update(this.value);
        });
      }
    });
  }

  console.log('[插件] 颜色转换工具已加载')
})()
