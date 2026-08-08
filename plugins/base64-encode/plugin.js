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

  // ── 面板注册: Base64 工具 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('base64-panel', {
      title: 'Base64 工具',
      icon: 'file-digit',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🔐 Base64 编解码</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<textarea class="pf-input" id="b64-input" rows="4" placeholder="输入要编码或解码的文本..."></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="b64-encode">编码 →</button>' +
          '<button class="pf-btn pf-btn-secondary" id="b64-decode">← 解码</button>' +
          '<button class="pf-btn pf-btn-secondary" id="b64-load">📥 从编辑器加载</button>' +
          '</div>' +
          '<div class="pf-label">结果</div>' +
          '<div id="b64-result" class="pf-result">等待输入...</div></div>';

        var resultEl = container.querySelector('#b64-result');
        var inputEl = container.querySelector('#b64-input');

        container.querySelector('#b64-load').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var content = api.getEditorContent();
            if (content) { inputEl.value = content; }
          }
        });

        container.querySelector('#b64-encode').addEventListener('click', function() {
          var text = inputEl.value;
          if (!text) { resultEl.textContent = '请输入文本'; return; }
          try {
            var encoded = btoa(unescape(encodeURIComponent(text)));
            resultEl.textContent = encoded;
          } catch(e) { resultEl.textContent = '编码失败: ' + e.message; }
        });

        container.querySelector('#b64-decode').addEventListener('click', function() {
          var text = inputEl.value;
          if (!text) { resultEl.textContent = '请输入 Base64 文本'; return; }
          try {
            var decoded = decodeURIComponent(escape(atob(text)));
            resultEl.textContent = decoded;
          } catch(e) { resultEl.textContent = '解码失败: 不是有效的 Base64'; }
        });
      }
    });
  }

  console.log('[插件] Base64 编解码已加载')
})()
