// URL 编解码器插件
(function () {
  const api = Wrench.getPluginAPI()

  api.registerCommand('url-encode', {
    label: 'URL 编码',
    description: '将文本编码为 URL 安全格式',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        var encoded = encodeURI(content)
        api.setEditorContent(encoded)
        api.showNotification('URL 编码完成', 'success')
      } catch (e) {
        api.showNotification('编码失败: ' + e.message, 'error')
      }
    },
  })

  api.registerCommand('url-decode', {
    label: 'URL 解码',
    description: '将 URL 编码文本还原',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入 URL 编码文本', 'warning'); return }
      try {
        var decoded = decodeURI(content)
        api.setEditorContent(decoded)
        api.showNotification('URL 解码完成', 'success')
      } catch (e) {
        api.showNotification('解码失败: ' + e.message, 'error')
      }
    },
  })

  api.registerCommand('url-component-encode', {
    label: '组件编码',
    description: '使用 encodeURIComponent 编码',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入文本', 'warning'); return }
      try {
        var encoded = encodeURIComponent(content)
        api.setEditorContent(encoded)
        api.showNotification('组件编码完成', 'success')
      } catch (e) {
        api.showNotification('编码失败: ' + e.message, 'error')
      }
    },
  })

  // ── 面板注册: URL 编解码 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('url-panel', {
      title: 'URL 编解码',
      icon: 'link',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🔗 URL 编解码器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<textarea class="pf-input" id="url-input" rows="3" placeholder="输入 URL 或文本..."></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="url-encode-btn">encodeURI</button>' +
          '<button class="pf-btn pf-btn-secondary" id="url-decode-btn">decodeURI</button>' +
          '<button class="pf-btn pf-btn-secondary" id="url-component-encode">encodeURIComponent</button>' +
          '<button class="pf-btn pf-btn-secondary" id="url-component-decode">decodeURIComponent</button>' +
          '</div>' +
          '<button class="pf-btn pf-btn-secondary" id="url-load" style="margin-bottom:12px">📥 从编辑器加载</button>' +
          '<div class="pf-label">结果</div>' +
          '<div id="url-result" class="pf-result">等待输入...</div></div>';

        var inputEl = container.querySelector('#url-input');
        var resultEl = container.querySelector('#url-result');

        container.querySelector('#url-load').addEventListener('click', function() {
          if (typeof api !== 'undefined') { var c = api.getEditorContent(); if (c) inputEl.value = c; }
        });
        container.querySelector('#url-encode-btn').addEventListener('click', function() {
          try { resultEl.textContent = encodeURI(inputEl.value); } catch(e) { resultEl.textContent = '编码失败: ' + e.message; }
        });
        container.querySelector('#url-decode-btn').addEventListener('click', function() {
          try { resultEl.textContent = decodeURI(inputEl.value); } catch(e) { resultEl.textContent = '解码失败: ' + e.message; }
        });
        container.querySelector('#url-component-encode').addEventListener('click', function() {
          try { resultEl.textContent = encodeURIComponent(inputEl.value); } catch(e) { resultEl.textContent = '编码失败: ' + e.message; }
        });
        container.querySelector('#url-component-decode').addEventListener('click', function() {
          try { resultEl.textContent = decodeURIComponent(inputEl.value); } catch(e) { resultEl.textContent = '解码失败: ' + e.message; }
        });
      }
    });
  }

  console.log('[插件] URL 编解码器已加载')
})()
