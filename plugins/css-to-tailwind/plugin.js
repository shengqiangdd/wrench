// CSS 转 Tailwind 插件
(function () {
  const api = Wrench.getPluginAPI()

  /** 常用 CSS → Tailwind 映射表 */
  var MAP = {
    // Display
    'display: flex': 'flex',
    'display: grid': 'grid',
    'display: block': 'block',
    'display: inline-block': 'inline-block',
    'display: none': 'hidden',
    'display: inline': 'inline',
    'display: inline-flex': 'inline-flex',

    // Flex
    'flex-direction: row': 'flex-row',
    'flex-direction: row-reverse': 'flex-row-reverse',
    'flex-direction: column': 'flex-col',
    'flex-wrap: wrap': 'flex-wrap',
    'justify-content: center': 'justify-center',
    'justify-content: flex-start': 'justify-start',
    'justify-content: flex-end': 'justify-end',
    'justify-content: space-between': 'justify-between',
    'justify-content: space-around': 'justify-around',
    'justify-content: space-evenly': 'justify-evenly',
    'align-items: center': 'items-center',
    'align-items: flex-start': 'items-start',
    'align-items: flex-end': 'items-end',
    'align-items: stretch': 'items-stretch',
    'gap: 0.25rem': 'gap-1',
    'gap: 0.5rem': 'gap-2',
    'gap: 0.75rem': 'gap-3',
    'gap: 1rem': 'gap-4',
    'gap: 1.5rem': 'gap-6',
    'gap: 2rem': 'gap-8',

    // Padding
    'padding: 0': 'p-0',
    'padding: 0.25rem': 'p-1',
    'padding: 0.5rem': 'p-2',
    'padding: 0.75rem': 'p-3',
    'padding: 1rem': 'p-4',
    'padding: 1.5rem': 'p-6',
    'padding: 2rem': 'p-8',
    'padding-top: 0.5rem': 'pt-2',
    'padding-top: 1rem': 'pt-4',
    'padding-bottom: 0.5rem': 'pb-2',
    'padding-bottom: 1rem': 'pb-4',
    'padding-left: 0.5rem': 'pl-2',
    'padding-left: 1rem': 'pl-4',
    'padding-right: 0.5rem': 'pr-2',
    'padding-right: 1rem': 'pr-4',

    // Margin
    'margin: 0': 'm-0',
    'margin: auto': 'm-auto',
    'margin: 0.25rem': 'm-1',
    'margin: 0.5rem': 'm-2',
    'margin: 1rem': 'm-4',
    'margin-top: 0.5rem': 'mt-2',
    'margin-top: 1rem': 'mt-4',
    'margin-bottom: 0.5rem': 'mb-2',
    'margin-bottom: 1rem': 'mb-4',

    // Border Radius
    'border-radius: 0.25rem': 'rounded',
    'border-radius: 0.5rem': 'rounded-lg',
    'border-radius: 9999px': 'rounded-full',
    'border-radius: 0': 'rounded-none',

    // Font
    'font-weight: bold': 'font-bold',
    'font-weight: semibold': 'font-semibold',
    'font-weight: medium': 'font-medium',
    'font-weight: normal': 'font-normal',
    'text-align: center': 'text-center',
    'text-align: left': 'text-left',
    'text-align: right': 'text-right',
    'text-transform: uppercase': 'uppercase',
    'text-transform: lowercase': 'lowercase',
    'text-decoration: underline': 'underline',
    'text-decoration: line-through': 'line-through',
    'text-decoration: none': 'no-underline',

    // Overflow
    'overflow: hidden': 'overflow-hidden',
    'overflow: auto': 'overflow-auto',
    'overflow: scroll': 'overflow-scroll',
    'overflow-x: auto': 'overflow-x-auto',
    'overflow-y: auto': 'overflow-y-auto',
    'white-space: nowrap': 'whitespace-nowrap',
    'text-overflow: ellipsis': 'text-ellipsis',

    // Position
    'position: relative': 'relative',
    'position: absolute': 'absolute',
    'position: fixed': 'fixed',
    'position: sticky': 'sticky',

    // Width/Height
    'width: 100%': 'w-full',
    'width: auto': 'w-auto',
    'width: 50%': 'w-1/2',
    'width: 33.333%': 'w-1/3',
    'width: 25%': 'w-1/4',
    'height: 100%': 'h-full',
    'height: 100vh': 'h-screen',
    'min-height: 100vh': 'min-h-screen',
    'max-width: 100%': 'max-w-full',

    // Opacity
    'opacity: 0': 'opacity-0',
    'opacity: 0.5': 'opacity-50',
    'opacity: 1': 'opacity-100',

    // Cursor
    'cursor: pointer': 'cursor-pointer',
    'cursor: not-allowed': 'cursor-not-allowed',
    'cursor: default': 'cursor-default',
    'cursor: move': 'cursor-move',
  }

  function convertCssToTailwind(css) {
    var lines = css.split('\n')
    var results = []

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim().replace(/;$/, '').trim()
      if (!line || line.startsWith('/*') || line.startsWith('*')) continue

      // 尝试精确匹配
      var twClass = MAP[line.toLowerCase()]
      if (twClass) {
        results.push(line + '  →  ' + twClass)
        continue
      }

      // 尝试模糊匹配
      var found = false
      for (var key in MAP) {
        if (line.toLowerCase().includes(key.split(': ')[0])) {
          results.push(line + '  →  ' + MAP[key] + ' (近似)')
          found = true
          break
        }
      }
      if (!found) {
        results.push(line + '  →  ?')
      }
    }

    return results
  }

  api.registerCommand('css-tw-convert', {
    label: '转换为 Tailwind',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 CSS 属性（每行一个）', 'warning')
        return
      }
      var results = convertCssToTailwind(content)
      var output = results.join('\n')
      api.setEditorContent(output)
      api.showNotification('已转换 ' + results.length + ' 条 CSS 属性', 'success')
    },
  })

  api.registerCommand('css-tw-preview', {
    label: 'CSS 对照表',
    execute: function () {
      var lines = ['━━━ CSS → Tailwind 对照表 ━━━', '']
      var lastCategory = ''
      for (var key in MAP) {
        var cat = key.split(':')[0]
        if (cat !== lastCategory) {
          lines.push('// ' + cat)
          lastCategory = cat
        }
        lines.push(key + '  →  ' + MAP[key])
      }
      api.setEditorContent(lines.join('\n'))
      api.showNotification('对照表已生成', 'success')
    },
  })

  // ── 面板注册: CSS 转 Tailwind ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('css-tw-panel', {
      title: 'CSS → Tailwind',
      icon: 'wind',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🌬️ CSS → Tailwind 转换</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<div class="pf-label">输入 CSS 属性（每行一个）</div>' +
          '<textarea class="pf-input" id="css-tw-input" rows="5" placeholder="display: flex\\njustify-content: center\\npadding: 1rem\\nborder-radius: 0.5rem"></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="css-tw-convert">转换 →</button>' +
          '<button class="pf-btn pf-btn-secondary" id="css-tw-load">📥 从编辑器加载</button>' +
          '</div>' +
          '<div class="pf-label">转换结果</div>' +
          '<div id="css-tw-result" class="pf-result">等待输入...</div></div>';

        var MAP = {
          'display: flex':'flex','display: grid':'grid','display: block':'block','display: inline-block':'inline-block','display: none':'hidden',
          'flex-direction: row':'flex-row','flex-direction: column':'flex-col','flex-wrap: wrap':'flex-wrap',
          'justify-content: center':'justify-center','justify-content: flex-start':'justify-start','justify-content: flex-end':'justify-end','justify-content: space-between':'justify-between',
          'align-items: center':'items-center','align-items: flex-start':'items-start','align-items: flex-end':'items-end',
          'gap: 0.5rem':'gap-2','gap: 1rem':'gap-4','gap: 1.5rem':'gap-6','gap: 2rem':'gap-8',
          'padding: 0.5rem':'p-2','padding: 1rem':'p-4','padding: 1.5rem':'p-6','padding: 2rem':'p-8',
          'margin: 0':'m-0','margin: auto':'m-auto','margin: 1rem':'m-4',
          'border-radius: 0.25rem':'rounded','border-radius: 0.5rem':'rounded-lg','border-radius: 9999px':'rounded-full',
          'font-weight: bold':'font-bold','font-weight: semibold':'font-semibold','font-weight: medium':'font-medium',
          'text-align: center':'text-center','text-align: left':'text-left','text-align: right':'text-right',
          'overflow: hidden':'overflow-hidden','overflow: auto':'overflow-auto',
          'position: relative':'relative','position: absolute':'absolute','position: fixed':'fixed',
          'width: 100%':'w-full','height: 100%':'h-full','height: 100vh':'h-screen',
          'opacity: 0':'opacity-0','opacity: 0.5':'opacity-50','opacity: 1':'opacity-100',
          'cursor: pointer':'cursor-pointer','cursor: not-allowed':'cursor-not-allowed',
          'white-space: nowrap':'whitespace-nowrap','text-overflow: ellipsis':'text-ellipsis'
        };

        var resultEl = container.querySelector('#css-tw-result');
        container.querySelector('#css-tw-load').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var c = api.getEditorContent();
            if (c) container.querySelector('#css-tw-input').value = c;
          }
        });
        container.querySelector('#css-tw-convert').addEventListener('click', function() {
          var lines = container.querySelector('#css-tw-input').value.split('\\n');
          var results = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim().replace(/;$/,'').trim();
            if (!line) continue;
            var tw = MAP[line.toLowerCase()];
            if (tw) { results.push(line + '  →  ' + tw); }
            else { var found = false; for (var k in MAP) { if (line.toLowerCase().indexOf(k.split(': ')[0]) !== -1) { results.push(line + '  →  ' + MAP[k] + ' (近似)'); found = true; break; } } if (!found) results.push(line + '  →  ?'); }
          }
          resultEl.textContent = results.length > 0 ? results.join('\\n') : '没有可转换的 CSS 属性';
        });
      }
    });
  }

  console.log('[插件] CSS 转 Tailwind 已加载')
})()
