// Markdown 预览插件
(function () {
  const api = Wrench.getPluginAPI()

  /** 极简 Markdown → HTML 转换器 */
  function mdToHtml(text) {
    var lines = text.split('\n')
    var html = []
    var inCode = false
    var codeBuffer = []

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]

      // 代码块
      if (line.trimStart().startsWith('```')) {
        if (inCode) {
          html.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>')
          codeBuffer = []
          inCode = false
        } else {
          inCode = true
        }
        continue
      }
      if (inCode) { codeBuffer.push(line); continue }

      // 空行
      if (line.trim() === '') { html.push(''); continue }

      // 标题
      var headingMatch = line.match(/^(#{1,6})\s+(.*)/)
      if (headingMatch) {
        var level = headingMatch[1].length
        html.push('<h' + level + '>' + inlineMd(headingMatch[2]) + '</h' + level + '>')
        continue
      }

      // 分隔线
      if (/^[-*_]{3,}$/.test(line.trim())) { html.push('<hr/>'); continue }

      // 列表
      var listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)/)
      if (listMatch) {
        html.push('<li style="margin-left:' + (listMatch[1].length * 8 + 16) + 'px">' + inlineMd(listMatch[3]) + '</li>')
        continue
      }

      // 引用
      if (line.startsWith('> ')) {
        html.push('<blockquote style="border-left:3px solid #64748b;padding-left:12px;color:#94a3b8;margin:8px 0;">' + inlineMd(line.slice(2)) + '</blockquote>')
        continue
      }

      // 普通段落
      html.push('<p style="margin:6px 0;line-height:1.7;">' + inlineMd(line) + '</p>')
    }

    if (inCode && codeBuffer.length > 0) {
      html.push('<pre><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>')
    }

    return html.join('\n')
  }

  function inlineMd(text) {
    var result = text
    // 粗体
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // 斜体
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // 行内代码
    result = result.replace(/`([^`]+)`/g, '<code style="background:#1e293b;padding:2px 6px;border-radius:4px;font-size:0.9em;">$1</code>')
    // 链接
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#60a5fa;text-decoration:underline;">$1</a>')
    // 图片
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8px;margin:8px 0;" />')
    return result
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  api.registerCommand('md-preview', {
    label: '预览 Markdown',
    description: '将 Markdown 渲染为 HTML 并在面板中显示',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 Markdown 文本', 'warning')
        return
      }
      var html = mdToHtml(content)
      api.openPanel('md-panel', { type: 'markdown-preview', html: html })
      api.showNotification('Markdown 预览已生成', 'success')
    },
  })

  api.registerCommand('md-to-html', {
    label: '转换为 HTML',
    description: '将 Markdown 转换为纯 HTML 源码',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 Markdown 文本', 'warning')
        return
      }
      var html = '<div class="markdown-body">\n' + mdToHtml(content) + '\n</div>'
      api.setEditorContent(html)
      api.showNotification('Markdown 已转换为 HTML', 'success')
    },
  })

  // ── 面板注册: Markdown 预览 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('md-panel', {
      title: 'Markdown 预览',
      icon: 'eye',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>👁️ Markdown 实时预览</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;resize:vertical;font-family:"Cascadia Code",monospace}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-size:13px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<textarea class="pf-input" id="md-input" rows="6" placeholder="# Hello\\n\\nThis is **bold** and *italic* text."></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="md-preview-btn">预览</button>' +
          '<button class="pf-btn pf-btn-secondary" id="md-load-btn">📥 从编辑器加载</button>' +
          '<button class="pf-btn pf-btn-secondary" id="md-html-btn">转 HTML</button>' +
          '</div>' +
          '<div class="pf-label">预览结果</div>' +
          '<div id="md-result" class="pf-result" style="color:#e2e8f0">输入 Markdown 后点击预览...</div></div>';

        var inputEl = container.querySelector('#md-input');
        var resultEl = container.querySelector('#md-result');

        function escHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
        function inlineMd(t){return t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code style="background:#1e293b;padding:2px 6px;border-radius:4px;">$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" style="color:#60a5fa;text-decoration:underline;">$1</a>');}
        function mdToHtml(text) {
          var lines = text.split('\\n'), html = [], inCode = false, codeBuf = [];
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (line.trimStart().startsWith('```')) { if(inCode){html.push('<pre><code>'+escHtml(codeBuf.join('\\n'))+'</code></pre>');codeBuf=[];inCode=false;}else{inCode=true;} continue; }
            if (inCode){codeBuf.push(line);continue;}
            if (line.trim()===''){html.push('');continue;}
            var hMatch = line.match(/^(#{1,6})\\s+(.*)/);
            if(hMatch){html.push('<h'+hMatch[1].length+'>'+inlineMd(hMatch[2])+'</h'+hMatch[1].length+'>');continue;}
            if(/^[-*_]{3,}$/.test(line.trim())){html.push('<hr/>');continue;}
            if(line.startsWith('> ')){html.push('<blockquote style="border-left:3px solid #64748b;padding-left:12px;color:#94a3b8;margin:8px 0;">'+inlineMd(line.slice(2))+'</blockquote>');continue;}
            html.push('<p style="margin:6px 0;line-height:1.7;">'+inlineMd(line)+'</p>');
          }
          if(inCode&&codeBuf.length>0) html.push('<pre><code>'+escHtml(codeBuf.join('\\n'))+'</code></pre>');
          return html.join('\\n');
        }

        container.querySelector('#md-load-btn').addEventListener('click', function() {
          if (typeof api !== 'undefined') { var c = api.getEditorContent(); if (c) inputEl.value = c; }
        });
        container.querySelector('#md-preview-btn').addEventListener('click', function() {
          resultEl.innerHTML = mdToHtml(inputEl.value);
        });
        container.querySelector('#md-html-btn').addEventListener('click', function() {
          var html = mdToHtml(inputEl.value);
          if (typeof api !== 'undefined') api.setEditorContent(html);
        });
        inputEl.addEventListener('input', function() {
          if (inputEl.value.trim()) resultEl.innerHTML = mdToHtml(inputEl.value);
        });
      }
    });
  }

  console.log('[插件] Markdown 预览已加载')
})()
