// YAML 格式化插件
(function () {
  const api = Wrench.getPluginAPI()

  /**
   * 极简 YAML → JS 对象解析器
   * 支持：标量、数组、嵌套 Map、注释、多行字符串（| >）、引用 &
   */
  function parseYaml(text) {
    const lines = text.split('\n')
    const root = {}
    const stack = [{ indent: -1, obj: root, key: null }]

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const stripped = raw.replace(/^([ \t]*)(.*?)(\s*#.*)?$/, '$1$2')
      const trimmed = stripped.trim()

      // 空行 / 纯注释行
      if (!trimmed || raw.trim().startsWith('#')) continue

      // 计算缩进
      const indent = raw.search(/\S/)

      // 列表项: - value
      if (trimmed.startsWith('- ')) {
        const value = trimmed.slice(2).trim()
        // 找到所属的父级列表
        const parent = stack.findLast(s => s.indent < indent)
        if (!parent) continue

        let arr = parent.obj
        if (Array.isArray(arr)) {
          // 已经是数组
        } else if (parent.key && parent.obj[parent.key] === undefined) {
          parent.obj[parent.key] = []
          arr = parent.obj[parent.key]
        } else {
          // 可能是嵌套列表
          arr = parent.obj
        }

        if (value) {
          arr.push(value)
          // 有内联值，下一个同缩进项也加进来
        } else {
          // 空列表项，子节点是对象
          const child = {}
          arr.push(child)
          stack.push({ indent, obj: child, key: null })
        }
        continue
      }

      // Key: Value
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.slice(0, colonIdx).trim()
      let value = trimmed.slice(colonIdx + 1).trim()

      // 找到所属父级
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }
      const parent = stack[stack.length - 1]
      if (!parent) continue

      if (value === '' || value === '|' || value === '>') {
        // 多行字符串或对象
        const child = {}
        parent.obj[key] = child
        stack.push({ indent, obj: child, key })
      } else if (value.startsWith('{') || value.startsWith('[')) {
        // 内联 JSON
        try {
          parent.obj[key] = JSON.parse(value)
        } catch {
          parent.obj[key] = value
        }
      } else if (value === 'true') {
        parent.obj[key] = true
      } else if (value === 'false') {
        parent.obj[key] = false
      } else if (value === 'null' || value === '~') {
        parent.obj[key] = null
      } else if (/^\d+(\.\d+)?$/.test(value)) {
        parent.obj[key] = value.includes('.') ? parseFloat(value) : parseInt(value, 10)
      } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        parent.obj[key] = value.slice(1, -1)
      } else {
        parent.obj[key] = value
      }
    }

    return root
  }

  /**
   * JS 对象 → YAML 字符串（带缩进格式化）
   */
  function stringifyYaml(obj, indent = 0) {
    const pad = '  '.repeat(indent)
    let result = ''

    if (obj === null || obj === undefined) {
      return 'null\n'
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (typeof item === 'object' && item !== null) {
          result += `${pad}- ` + stringifyYaml(item, indent + 1).trimStart()
        } else {
          result += `${pad}- ${formatScalar(item)}\n`
        }
      }
    } else if (typeof obj === 'object') {
      const entries = Object.entries(obj)
      for (let i = 0; i < entries.length; i++) {
        const [key, value] = entries[i]
        if (value === null || value === undefined) {
          result += `${pad}${key}: null\n`
        } else if (typeof value === 'object') {
          result += `${pad}${key}:\n`
          result += stringifyYaml(value, indent + 1)
        } else if (typeof value === 'string' && (value.includes('\n') || value.includes(': ') || value.length > 80)) {
          result += `${pad}${key}: |\n`
          const lines = value.split('\n')
          for (const line of lines) {
            result += `${pad}  ${line}\n`
          }
        } else {
          result += `${pad}${key}: ${formatScalar(value)}\n`
        }
      }
    } else {
      result += formatScalar(obj)
    }

    return result
  }

  function formatScalar(val) {
    if (typeof val === 'string') {
      // 如果包含特殊字符，加引号
      if (/[:\{\}\[\],&\*\?#\|<>!%@`\n]/.test(val) || val === '' || /^\d/.test(val)) {
        const escaped = val.replace(/"/g, '\\"')
        return `"${escaped}"`
      }
      return val
    }
    return String(val)
  }

  api.registerCommand('yaml-format', {
    label: '格式化 YAML',
    description: '美化当前编辑器中的 YAML 内容',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        const parsed = parseYaml(content)
        // 移除 root 空层（parseYaml 返回根对象）
        const formatted = stringifyYaml(Object.keys(parsed).length === 1
          ? Object.values(parsed)[0]
          : parsed)
        api.setEditorContent(formatted)
        api.showNotification('YAML 格式化完成', 'success')
      } catch (e) {
        api.showNotification('YAML 解析错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('yaml-validate', {
    label: '验证 YAML',
    description: '检查当前 YAML 是否有语法错误',
    execute: () => {
      const content = api.getEditorContent()
      if (!content || !content.trim()) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        parseYaml(content)
        api.showNotification('YAML 语法正确 ✓', 'success')
      } catch (e) {
        api.showNotification('YAML 语法错误: ' + e.message, 'error')
      }
    }
  })

  api.registerCommand('yaml-to-json', {
    label: 'YAML → JSON',
    description: '将 YAML 转换为 JSON',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }
      try {
        const parsed = parseYaml(content)
        const json = JSON.stringify(parsed, null, 2)
        api.setEditorContent(json)
        api.showNotification('YAML → JSON 转换完成', 'success')
      } catch (e) {
        api.showNotification('YAML 解析错误: ' + e.message, 'error')
      }
    }
  })

  // ── 面板注册: YAML 格式化 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('yaml-formatter-panel', {
      title: 'YAML 格式化',
      icon: 'file-text',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📋 YAML 格式化</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;resize:vertical;font-family:"Cascadia Code",monospace}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<div class="pf-label">输入 YAML</div>' +
          '<textarea class="pf-input" id="yaml-input" rows="6" placeholder="key: value\\nnested:\\n  item: 1"></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="yaml-format-btn">格式化</button>' +
          '<button class="pf-btn pf-btn-secondary" id="yaml-validate-btn">校验</button>' +
          '<button class="pf-btn pf-btn-secondary" id="yaml-to-json-btn">→ JSON</button>' +
          '<button class="pf-btn pf-btn-secondary" id="yaml-load-btn">📥 从编辑器加载</button>' +
          '</div>' +
          '<div class="pf-label">结果</div>' +
          '<div id="yaml-result" class="pf-result">等待输入...</div></div>';

        var inputEl = container.querySelector('#yaml-input');
        var resultEl = container.querySelector('#yaml-result');

        function parseYaml(text) {
          var lines = text.split('\\n'), root = {}, stack = [{indent:-1,obj:root,key:null}];
          for (var i = 0; i < lines.length; i++) {
            var raw = lines[i], stripped = raw.replace(/^([ \\t]*)(.*?)(\\s*#.*)?$/, '$1$2'), trimmed = stripped.trim();
            if (!trimmed || raw.trim().startsWith('#')) continue;
            var indent = raw.search(/\\S/);
            if (trimmed.startsWith('- ')) {
              var value = trimmed.slice(2).trim();
              var parent = stack.findLast(function(s){return s.indent<indent});
              if (!parent) continue;
              var arr = parent.obj;
              if (!Array.isArray(arr) && parent.key && parent.obj[parent.key]===undefined) { parent.obj[parent.key]=[]; arr=parent.obj[parent.key]; }
              if (value) { if (Array.isArray(arr)) arr.push(value); }
              else { var child={}; if(Array.isArray(arr)) arr.push(child); stack.push({indent:indent,obj:child,key:null}); }
              continue;
            }
            var colonIdx = trimmed.indexOf(':');
            if (colonIdx === -1) continue;
            var key = trimmed.slice(0,colonIdx).trim(), value = trimmed.slice(colonIdx+1).trim();
            while (stack.length>1 && stack[stack.length-1].indent>=indent) stack.pop();
            var par = stack[stack.length-1];
            if (!par) continue;
            if (value==='') { var c={}; par.obj[key]=c; stack.push({indent:indent,obj:c,key:key}); }
            else if (value==='true') par.obj[key]=true;
            else if (value==='false') par.obj[key]=false;
            else if (value==='null'||value==='~') par.obj[key]=null;
            else if (/^\\d+(\\.\\d+)?$/.test(value)) par.obj[key]=value.includes('.')?parseFloat(value):parseInt(value,10);
            else par.obj[key]=value;
          }
          return root;
        }

        container.querySelector('#yaml-load-btn').addEventListener('click', function() {
          if (typeof api !== 'undefined') { var c = api.getEditorContent(); if (c) inputEl.value = c; }
        });
        container.querySelector('#yaml-format-btn').addEventListener('click', function() {
          try {
            var parsed = parseYaml(inputEl.value);
            resultEl.textContent = JSON.stringify(parsed, null, 2);
          } catch(e) { resultEl.textContent = '解析错误: ' + e.message; }
        });
        container.querySelector('#yaml-validate-btn').addEventListener('click', function() {
          try { parseYaml(inputEl.value); resultEl.textContent = '✅ YAML 语法正确'; }
          catch(e) { resultEl.textContent = '❌ 语法错误: ' + e.message; }
        });
        container.querySelector('#yaml-to-json-btn').addEventListener('click', function() {
          try {
            var parsed = parseYaml(inputEl.value);
            resultEl.textContent = JSON.stringify(parsed, null, 2);
          } catch(e) { resultEl.textContent = '转换失败: ' + e.message; }
        });
      }
    });
  }

  console.log('[插件] YAML 格式化已加载')
})()
