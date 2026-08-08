// 正则表达式测试器插件
(function () {
  const api = Wrench.getPluginAPI()

  api.registerCommand('regex-test', {
    label: '测试正则表达式',
    description: '使用当前编辑器内容测试正则匹配',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入要测试的文本', 'warning')
        return
      }

      // 弹出对话框让用户输入正则
      const pattern = prompt('请输入正则表达式（如：\\d+\\.\\d+）：')
      if (!pattern) return

      const flags = prompt('请输入修饰符（如：gi，回车即不使用）：') || ''
      try {
        const regex = new RegExp(pattern, flags)
        let match
        const results = []
        while ((match = regex.exec(content)) !== null) {
          results.push({
            index: match.index,
            match: match[0],
          })
          if (match.index === regex.lastIndex) regex.lastIndex++
        }

        if (results.length === 0) {
          api.showNotification('未找到匹配结果', 'warning')
        } else if (results.length <= 10) {
          const msg = results
            .map((r) => `#${results.indexOf(r) + 1} [位置 ${r.index}]: "${r.match}"`)
            .join('\n')
          api.showNotification(`找到 ${results.length} 个匹配:\n${msg}`, 'success')
        } else {
          api.showNotification(`找到 ${results.length} 个匹配（仅显示前10个）`, 'success')
        }
      } catch (e) {
        api.showNotification('正则表达式语法错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('regex-replace', {
    label: '正则替换',
    description: '使用正则表达式进行替换',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入文本', 'warning')
        return
      }

      const pattern = prompt('请输入要查找的正则表达式：')
      if (!pattern) return

      const flags = prompt('请输入修饰符（如：gi，回车即不使用）：') || ''
      const replacement = prompt('请输入替换文本（可使用 $1, $2 等引用分组）：')
      if (replacement === null) return

      try {
        const regex = new RegExp(pattern, flags)
        const result = content.replace(regex, replacement)
        const diffCount = (content.match(regex) || []).length

        api.setEditorContent(result)
        api.showNotification(`替换完成，共替换 ${diffCount} 处`, 'success')
      } catch (e) {
        api.showNotification('正则表达式语法错误: ' + e.message, 'error')
      }
    }
  })

  // ── 面板注册: 正则测试 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('regex-panel', {
      title: '正则测试',
      icon: 'regex',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🔍 正则表达式测试器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;align-items:center}</style>' +
          '<div class="pf-row"><div style="flex:3"><div class="pf-label">正则表达式</div><input class="pf-input" id="regex-pattern" placeholder="\\d+\\.\\d+" /></div>' +
          '<div style="flex:1"><div class="pf-label">修饰符</div><input class="pf-input" id="regex-flags" value="g" placeholder="gi" /></div></div>' +
          '<div class="pf-label">测试文本</div>' +
          '<textarea class="pf-input" id="regex-text" rows="4" placeholder="输入要测试的文本..."></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="regex-test-btn">测试匹配</button>' +
          '<button class="pf-btn pf-btn-secondary" id="regex-load-btn">📥 从编辑器加载</button>' +
          '</div>' +
          '<div id="regex-result" class="pf-result">输入正则和文本后点击测试</div></div>';

        var resultEl = container.querySelector('#regex-result');

        container.querySelector('#regex-load-btn').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var c = api.getEditorContent();
            if (c) container.querySelector('#regex-text').value = c;
          }
        });

        container.querySelector('#regex-test-btn').addEventListener('click', function() {
          var pattern = container.querySelector('#regex-pattern').value.trim();
          var flags = container.querySelector('#regex-flags').value.trim();
          var text = container.querySelector('#regex-text').value;
          if (!pattern) { resultEl.textContent = '请输入正则表达式'; return; }
          if (!text) { resultEl.textContent = '请输入测试文本'; return; }
          try {
            var regex = new RegExp(pattern, flags);
            var matches = [];
            var match;
            if (flags.indexOf('g') !== -1) {
              while ((match = regex.exec(text)) !== null) {
                matches.push({index: match.index, match: match[0], groups: match.slice(1)});
                if (match.index === regex.lastIndex) regex.lastIndex++;
              }
            } else {
              match = regex.exec(text);
              if (match) matches.push({index: match.index, match: match[0], groups: match.slice(1)});
            }
            if (matches.length === 0) {
              resultEl.textContent = '无匹配结果';
            } else {
              var output = '找到 ' + matches.length + ' 个匹配:\\n\\n';
              for (var i = 0; i < Math.min(matches.length, 50); i++) {
                output += '#' + (i+1) + ' [位置 ' + matches[i].index + ']: "' + matches[i].match + '"';
                if (matches[i].groups.length > 0) output += '  分组: [' + matches[i].groups.join(', ') + ']';
                output += '\\n';
              }
              if (matches.length > 50) output += '\\n... 仅显示前 50 个';
              resultEl.textContent = output;
            }
          } catch(e) {
            resultEl.textContent = '❌ 正则语法错误: ' + e.message;
          }
        });
      }
    });
  }

  console.log('[插件] 正则测试器已加载')
})()
