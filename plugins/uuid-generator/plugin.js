// UUID 生成器插件
(function () {
  const api = Wrench.getPluginAPI()

  function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  api.registerCommand('uuid-generate', {
    label: '生成 UUID',
    description: '生成一个标准 UUID v4',
    execute: function () {
      var id = uuidv4()
      api.setEditorContent(id)
      api.showNotification('UUID 已生成: ' + id, 'success')
    },
  })

  api.registerCommand('uuid-generate-batch', {
    label: '批量生成',
    description: '一次生成 10 个 UUID',
    execute: function () {
      var ids = []
      for (var i = 0; i < 10; i++) {
        ids.push(uuidv4())
      }
      api.setEditorContent(ids.join('\n'))
      api.showNotification('已生成 10 个 UUID', 'success')
    },
  })

  api.registerCommand('uuid-format', {
    label: '格式化 UUID',
    description: '将选中文本转为大写无连字符格式',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 UUID', 'warning')
        return
      }
      var stripped = content.replace(/-/g, '').toUpperCase()
      api.setEditorContent(stripped)
      api.showNotification('UUID 格式已转换为无连字符大写', 'success')
    },
  })

  // ── 面板注册: UUID 生成器 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('uuid-panel', {
      title: 'UUID 生成',
      icon: 'fingerprint',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🆔 UUID 生成器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap}</style>' +
          '<div class="pf-row">' +
          '<div style="flex:1;min-width:80px"><div class="pf-label">生成数量</div><input class="pf-input" id="uuid-count" type="number" value="1" min="1" max="100" /></div>' +
          '<div style="flex:2"><div class="pf-label">格式</div>' +
          '<label style="font-size:12px;margin-right:12px"><input type="radio" name="uuid-fmt" value="standard" checked> 标准 (带连字符)</label>' +
          '<label style="font-size:12px"><input type="radio" name="uuid-fmt" value="nodash"> 无连字符</label>' +
          '</div></div>' +
          '<div class="pf-row">' +
          '<button class="pf-btn" id="uuid-gen">生成 UUID</button>' +
          '<button class="pf-btn pf-btn-secondary" id="uuid-copy">📋 复制全部</button>' +
          '</div>' +
          '<div id="uuid-result" class="pf-result">点击生成...</div></div>';

        var resultEl = container.querySelector('#uuid-result');

        function uuidv4() {
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = (Math.random()*16)|0, v = c==='x'?r:(r&0x3)|0x8;
            return v.toString(16);
          });
        }

        container.querySelector('#uuid-gen').addEventListener('click', function() {
          var count = parseInt(container.querySelector('#uuid-count').value) || 1;
          var fmt = container.querySelector('input[name="uuid-fmt"]:checked').value;
          var ids = [];
          for (var i = 0; i < count; i++) {
            var id = uuidv4();
            if (fmt === 'nodash') id = id.replace(/-/g, '').toUpperCase();
            ids.push(id);
          }
          resultEl.textContent = ids.join('\\n');
        });

        container.querySelector('#uuid-copy').addEventListener('click', function() {
          var text = resultEl.textContent;
          if (text && text !== '点击生成...') navigator.clipboard.writeText(text);
        });

        // Auto-generate
        container.querySelector('#uuid-gen').click();
      }
    });
  }

  console.log('[插件] UUID 生成器已加载')
})()
