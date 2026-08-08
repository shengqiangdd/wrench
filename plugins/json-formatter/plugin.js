// JSON 格式化插件
(function () {
  const api = Wrench.getPluginAPI()

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

  // ── 面板注册: JSON 格式化 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('json-formatter-panel', {
      title: 'JSON 格式化',
      icon: 'braces',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>{ } JSON 格式化</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;resize:vertical;font-family:"Cascadia Code",monospace}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<div class="pf-label">输入 JSON</div>' +
          '<textarea class="pf-input" id="json-input" rows="8" placeholder=\'{"key": "value"}\'></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="json-format-btn">格式化</button>' +
          '<button class="pf-btn pf-btn-secondary" id="json-compress-btn">压缩</button>' +
          '<button class="pf-btn pf-btn-secondary" id="json-validate-btn">校验</button>' +
          '<button class="pf-btn pf-btn-secondary" id="json-load-btn">📥 从编辑器加载</button>' +
          '</div>' +
          '<div class="pf-label">结果</div>' +
          '<div id="json-result" class="pf-result">等待输入...</div></div>';

        var inputEl = container.querySelector('#json-input');
        var resultEl = container.querySelector('#json-result');

        container.querySelector('#json-load-btn').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var c = api.getEditorContent();
            if (c) inputEl.value = c;
          }
        });
        container.querySelector('#json-format-btn').addEventListener('click', function() {
          try {
            var parsed = JSON.parse(inputEl.value);
            resultEl.textContent = JSON.stringify(parsed, null, 2);
          } catch(e) { resultEl.textContent = 'JSON 解析错误: ' + e.message; }
        });
        container.querySelector('#json-compress-btn').addEventListener('click', function() {
          try {
            var parsed = JSON.parse(inputEl.value);
            resultEl.textContent = JSON.stringify(parsed);
          } catch(e) { resultEl.textContent = 'JSON 解析错误: ' + e.message; }
        });
        container.querySelector('#json-validate-btn').addEventListener('click', function() {
          try {
            JSON.parse(inputEl.value);
            resultEl.textContent = '✅ JSON 语法正确';
          } catch(e) { resultEl.textContent = '❌ 错误: ' + e.message; }
        });
      }
    });
  }

  console.log('[插件] JSON 格式化已加载')
})()
