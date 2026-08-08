// XML 格式化插件
(function () {
  const api = Wrench.getPluginAPI()

  function formatXml(xml, indent) {
    indent = indent || 2
    var pad = 0
    var result = ''
    var tags = xml.replace(/>\s*</g, '>\n<').split('\n')

    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i].trim()
      if (!tag) continue

      // XML 声明
      if (tag.startsWith('<?')) {
        result += tag + '\n'
        continue
      }

      // 闭合标签
      if (tag.startsWith('</')) {
        pad = Math.max(0, pad - 1)
        result += ' '.repeat(pad * indent) + tag + '\n'
        continue
      }

      // 自闭合标签
      if (tag.endsWith('/>')) {
        result += ' '.repeat(pad * indent) + tag + '\n'
        continue
      }

      // 开始标签（可能带内容在同一行）
      var closingIndex = tag.indexOf('</')
      if (closingIndex > 0) {
        // <tag>content</tag> — 单行
        result += ' '.repeat(pad * indent) + tag + '\n'
      } else {
        // 开标签
        result += ' '.repeat(pad * indent) + tag + '\n'
        pad++
      }
    }

    return result.trimEnd()
  }

  function validateXml(xml) {
    var parser = new DOMParser()
    var doc = parser.parseFromString(xml, 'application/xml')
    var error = doc.querySelector('parsererror')
    if (error) {
      return { valid: false, message: error.textContent || '未知解析错误' }
    }
    return { valid: true, message: 'XML 语法正确 ✓' }
  }

  api.registerCommand('xml-format', {
    label: '格式化 XML',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入 XML', 'warning'); return }
      try {
        var formatted = formatXml(content, 2)
        api.setEditorContent(formatted)
        api.showNotification('XML 格式化完成', 'success')
      } catch (e) {
        api.showNotification('格式化失败: ' + e.message, 'error')
      }
    },
  })

  api.registerCommand('xml-compress', {
    label: '压缩 XML',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入 XML', 'warning'); return }
      var compressed = content.replace(/>\s+</g, '><').trim()
      api.setEditorContent(compressed)
      api.showNotification('XML 已压缩为单行', 'success')
    },
  })

  api.registerCommand('xml-validate', {
    label: '验证 XML',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) { api.showNotification('请先在编辑器中输入 XML', 'warning'); return }
      var result = validateXml(content)
      api.showNotification(result.message, result.valid ? 'success' : 'error')
    },
  })

  // ── 面板注册: XML 格式化 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('xml-panel', {
      title: 'XML 格式化',
      icon: 'code',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📄 XML 格式化</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;resize:vertical;font-family:"Cascadia Code",monospace}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<div class="pf-label">输入 XML</div>' +
          '<textarea class="pf-input" id="xml-input" rows="6" placeholder="<root><item>value</item></root>"></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="xml-format-btn">格式化</button>' +
          '<button class="pf-btn pf-btn-secondary" id="xml-compress-btn">压缩</button>' +
          '<button class="pf-btn pf-btn-secondary" id="xml-validate-btn">校验</button>' +
          '<button class="pf-btn pf-btn-secondary" id="xml-load-btn">📥 从编辑器加载</button>' +
          '</div>' +
          '<div class="pf-label">结果</div>' +
          '<div id="xml-result" class="pf-result">等待输入...</div></div>';

        var inputEl = container.querySelector('#xml-input');
        var resultEl = container.querySelector('#xml-result');

        function formatXml(xml, indent) {
          indent = indent || 2; var pad = 0, result = '';
          var tags = xml.replace(/>\s*</g, '>\n<').split('\n');
          for (var i = 0; i < tags.length; i++) {
            var tag = tags[i].trim();
            if (!tag) continue;
            if (tag.startsWith('<?')) { result += tag + '\\n'; continue; }
            if (tag.startsWith('</')) { pad = Math.max(0, pad-1); result += ' '.repeat(pad*indent) + tag + '\\n'; continue; }
            if (tag.endsWith('/>')) { result += ' '.repeat(pad*indent) + tag + '\\n'; continue; }
            if (tag.indexOf('</') > 0) { result += ' '.repeat(pad*indent) + tag + '\\n'; }
            else { result += ' '.repeat(pad*indent) + tag + '\\n'; pad++; }
          }
          return result.trimEnd();
        }

        container.querySelector('#xml-load-btn').addEventListener('click', function() {
          if (typeof api !== 'undefined') { var c = api.getEditorContent(); if (c) inputEl.value = c; }
        });
        container.querySelector('#xml-format-btn').addEventListener('click', function() {
          try { resultEl.textContent = formatXml(inputEl.value, 2); } catch(e) { resultEl.textContent = '格式化失败: ' + e.message; }
        });
        container.querySelector('#xml-compress-btn').addEventListener('click', function() {
          resultEl.textContent = inputEl.value.replace(/>\s+</g, '><').trim();
        });
        container.querySelector('#xml-validate-btn').addEventListener('click', function() {
          var parser = new DOMParser();
          var doc = parser.parseFromString(inputEl.value, 'application/xml');
          var error = doc.querySelector('parsererror');
          resultEl.textContent = error ? '❌ ' + (error.textContent || '解析错误') : '✅ XML 语法正确';
        });
      }
    });
  }

  console.log('[插件] XML 格式化已加载')
})()
