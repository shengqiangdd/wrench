// 命名风格转换插件
(function () {
  const api = Wrench.getPluginAPI()

  /**
   * 将任意命名风格拆分为单词数组
   * 支持: camelCase, PascalCase, snake_case, kebab-case, UPPER_CASE, 混写
   */
  function splitWords(str) {
    const words = []
    // 先按下划线/连字符拆分
    const parts = str.split(/[-_]/)
    for (const part of parts) {
      if (!part) continue
      // 进一步按大写字母拆分 (处理 camelCase / PascalCase)
      // 匹配: 连续大写字母开头 + 小写字母（如 "HELLO" 或 "Hello"），或单独小写单词
      const segments = part.match(/[A-Z]+(?=[A-Z][a-z]|\d|$)|[A-Z][a-z]*|[a-z]+|\d+/g)
      if (segments) {
        for (const seg of segments) {
          words.push(seg.toLowerCase())
        }
      } else if (part) {
        words.push(part.toLowerCase())
      }
    }
    return words.length > 0 ? words : [str.toLowerCase()]
  }

  /** 单词数组 → camelCase */
  function toCamel(words) {
    if (words.length === 0) return ''
    return words[0] + words.slice(1).map(w => w[0].toUpperCase() + w.slice(1)).join('')
  }

  /** 单词数组 → PascalCase */
  function toPascal(words) {
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join('')
  }

  /** 单词数组 → snake_case */
  function toSnake(words) {
    return words.join('_')
  }

  /** 单词数组 → kebab-case */
  function toKebab(words) {
    return words.join('-')
  }

  /** 单词数组 → UPPER_CASE */
  function toUpper(words) {
    return words.join('_').toUpperCase()
  }

  /** 提取编辑器中的待转换标识符列表 */
  function extractIdentifiers(text) {
    // 匹配常见的标识符: 字母/数字/下划线/连字符组成的词，且至少包含一个字母
    const regex = /[a-zA-Z_][a-zA-Z0-9_-]*/g
    const matches = text.match(regex)
    if (!matches) return []
    // 去重且保留顺序
    const seen = new Set()
    return matches.filter(m => {
      // 至少有一个字母
      if (!/[a-zA-Z]/.test(m)) return false
      if (seen.has(m)) return false
      seen.add(m)
      return true
    })
  }

  /** 批量转换并输出结果 */
  function batchConvert(converter, targetName) {
    const content = api.getEditorContent()
    if (!content) {
      api.showNotification('请先在编辑器中打开文件', 'warning')
      return
    }

    const identifiers = extractIdentifiers(content)
    if (identifiers.length === 0) {
      api.showNotification('未找到可转换的标识符', 'warning')
      return
    }

    const lines = []
    for (const id of identifiers) {
      const words = splitWords(id)
      const converted = converter(words)
      if (converted !== id) {
        lines.push(`${id}  →  ${converted}`)
      }
    }

    if (lines.length === 0) {
      api.showNotification(`所有标识符已经是 ${targetName} 格式`, 'info')
      return
    }

    api.setEditorContent(lines.join('\n'))
    api.showNotification(`转换完成: ${lines.length} 个标识符 → ${targetName}`, 'success')
  }

  api.registerCommand('case-to-camel', {
    label: '转 camelCase',
    description: '转换标识符为驼峰命名: helloWorld',
    execute: () => batchConvert(toCamel, 'camelCase')
  })

  api.registerCommand('case-to-pascal', {
    label: '转 PascalCase',
    description: '转换标识符为大驼峰命名: HelloWorld',
    execute: () => batchConvert(toPascal, 'PascalCase')
  })

  api.registerCommand('case-to-snake', {
    label: '转 snake_case',
    description: '转换标识符为下划线命名: hello_world',
    execute: () => batchConvert(toSnake, 'snake_case')
  })

  api.registerCommand('case-to-kebab', {
    label: '转 kebab-case',
    description: '转换标识符为连字符命名: hello-world',
    execute: () => batchConvert(toKebab, 'kebab-case')
  })

  api.registerCommand('case-to-upper', {
    label: '转 UPPER_CASE',
    description: '转换标识符为大写下划线命名: HELLO_WORLD',
    execute: () => batchConvert(toUpper, 'UPPER_CASE')
  })

  // ── 面板注册: 命名风格转换 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('case-panel', {
      title: '命名风格转换',
      icon: 'text',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🔤 命名风格转换</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<input class="pf-input" id="case-input" placeholder="输入标识符，如: hello_world" />' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn case-convert" data-style="camel">camelCase</button>' +
          '<button class="pf-btn pf-btn-secondary case-convert" data-style="pascal">PascalCase</button>' +
          '<button class="pf-btn pf-btn-secondary case-convert" data-style="snake">snake_case</button>' +
          '<button class="pf-btn pf-btn-secondary case-convert" data-style="kebab">kebab-case</button>' +
          '<button class="pf-btn pf-btn-secondary case-convert" data-style="upper">UPPER_CASE</button>' +
          '</div>' +
          '<div class="pf-label">转换结果（实时预览）</div>' +
          '<div id="case-result" class="pf-result">等待输入...</div></div>';

        var inputEl = container.querySelector('#case-input');
        var resultEl = container.querySelector('#case-result');

        function splitWords(str) {
          var words = [];
          var parts = str.split(/[-_]/);
          for (var p = 0; p < parts.length; p++) {
            if (!parts[p]) continue;
            var segs = parts[p].match(/[A-Z]+(?=[A-Z][a-z]|\\d|$)|[A-Z][a-z]*|[a-z]+|\\d+/g);
            if (segs) for (var s = 0; s < segs.length; s++) words.push(segs[s].toLowerCase());
            else if (parts[p]) words.push(parts[p].toLowerCase());
          }
          return words.length > 0 ? words : [str.toLowerCase()];
        }

        function convert(style) {
          var val = inputEl.value.trim();
          if (!val) { resultEl.textContent = '等待输入...'; return; }
          var words = splitWords(val);
          var result = '';
          switch(style) {
            case 'camel': result = words[0] + words.slice(1).map(function(w){return w[0].toUpperCase()+w.slice(1)}).join(''); break;
            case 'pascal': result = words.map(function(w){return w[0].toUpperCase()+w.slice(1)}).join(''); break;
            case 'snake': result = words.join('_'); break;
            case 'kebab': result = words.join('-'); break;
            case 'upper': result = words.join('_').toUpperCase(); break;
          }
          resultEl.textContent = val + '  →  ' + result;
        }

        var btns = container.querySelectorAll('.case-convert');
        for (var i = 0; i < btns.length; i++) {
          btns[i].addEventListener('click', function() {
            convert(this.getAttribute('data-style'));
          });
        }
        inputEl.addEventListener('input', function() {
          if (inputEl.value.trim()) convert('camel');
        });
      }
    });
  }

  console.log('[插件] 命名风格转换工具已加载')
})()
