// 密码生成器插件
(function () {
  const api = Wrench.getPluginAPI()

  var CHARS_LOW = 'abcdefghijklmnopqrstuvwxyz'
  var CHARS_UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  var CHARS_NUM = '0123456789'
  var CHARS_SYM = '!@#$%^&*()_+-=[]{}|;:,.<>?'

  function generatePassword(length, useUpper, useLower, useNum, useSym) {
    var pool = ''
    if (useLower) pool += CHARS_LOW
    if (useUpper) pool += CHARS_UP
    if (useNum) pool += CHARS_NUM
    if (useSym) pool += CHARS_SYM
    if (!pool) pool = CHARS_LOW + CHARS_UP + CHARS_NUM

    var arr = new Uint32Array(length)
    crypto.getRandomValues(arr)
    var result = ''
    for (var i = 0; i < length; i++) {
      result += pool[arr[i] % pool.length]
    }
    return result
  }

  function calcEntropy(length, poolSize) {
    return Math.floor(length * Math.log2(poolSize))
  }

  function strengthLabel(entropy) {
    if (entropy >= 128) return { level: '极强', color: '#22c55e', score: 100 }
    if (entropy >= 80) return { level: '强', color: '#84cc16', score: 80 }
    if (entropy >= 60) return { level: '中等', color: '#eab308', score: 60 }
    if (entropy >= 40) return { level: '弱', color: '#f97316', score: 40 }
    return { level: '极弱', color: '#ef4444', score: 20 }
  }

  api.registerCommand('pwd-generate-short', {
    label: '生成 16 位密码',
    execute: function () {
      var pwd = generatePassword(16, true, true, true, true)
      var poolSize = CHARS_LOW.length + CHARS_UP.length + CHARS_NUM.length + CHARS_SYM.length
      var entropy = calcEntropy(16, poolSize)
      var s = strengthLabel(entropy)
      api.setEditorContent(pwd)
      api.showNotification('密码已生成（' + s.level + '，熵值 ' + entropy + ' bit）', 'success')
    },
  })

  api.registerCommand('pwd-generate-long', {
    label: '生成 32 位密码',
    execute: function () {
      var pwd = generatePassword(32, true, true, true, true)
      var poolSize = CHARS_LOW.length + CHARS_UP.length + CHARS_NUM.length + CHARS_SYM.length
      var entropy = calcEntropy(32, poolSize)
      api.setEditorContent(pwd)
      api.showNotification('高强度密码已生成（熵值 ' + entropy + ' bit）', 'success')
    },
  })

  api.registerCommand('pwd-generate-custom', {
    label: '自定义密码',
    execute: function () {
      var len = parseInt(prompt('密码长度（默认 16）：') || '16', 10)
      if (isNaN(len) || len < 4) len = 16

      var useUpper = confirm('包含大写字母？')
      var useSym = confirm('包含特殊字符？')

      var poolSize = 0
      var pwd = generatePassword(len, useUpper, true, true, useSym)
      poolSize += CHARS_LOW.length + CHARS_NUM.length
      if (useUpper) poolSize += CHARS_UP.length
      if (useSym) poolSize += CHARS_SYM.length

      var entropy = calcEntropy(len, poolSize)
      var s = strengthLabel(entropy)
      api.setEditorContent(pwd)
      api.showNotification(
        len + ' 位密码已生成（' + s.level + '，熵值 ' + entropy + ' bit）',
        'success',
      )
    },
  })

  api.registerCommand('pwd-strength', {
    label: '检测密码强度',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入密码', 'warning')
        return
      }
      var pwd = content.trim().split('\n')[0]

      var hasLower = /[a-z]/.test(pwd)
      var hasUpper = /[A-Z]/.test(pwd)
      var hasNum = /[0-9]/.test(pwd)
      var hasSym = /[^a-zA-Z0-9]/.test(pwd)

      var poolSize = 0
      if (hasLower) poolSize += CHARS_LOW.length
      if (hasUpper) poolSize += CHARS_UP.length
      if (hasNum) poolSize += CHARS_NUM.length
      if (hasSym) poolSize += CHARS_SYM.length

      var entropy = calcEntropy(pwd.length, poolSize)
      var s = strengthLabel(entropy)

      var result = [
        '━━━ 密码强度分析 ━━━',
        '密码: ' + pwd.slice(0, 2) + '*'.repeat(Math.max(0, pwd.length - 4)) + pwd.slice(-2),
        '长度: ' + pwd.length + ' 字符',
        '字符集: ' + poolSize + ' 种字符',
        '',
        '包含: ' + [
          hasLower ? '✓ 小写' : '✗ 小写',
          hasUpper ? '✓ 大写' : '✗ 大写',
          hasNum ? '✓ 数字' : '✗ 数字',
          hasSym ? '✓ 符号' : '✗ 符号',
        ].join('  '),
        '',
        '熵值: ' + entropy + ' bit',
        '强度: ' + s.level,
        '',
        '━━━━━━━━━━━━━━━━━',
      ].join('\n')

      api.setEditorContent(result)
      api.showNotification('密码强度: ' + s.level + '（' + entropy + ' bit）', 'success')
    },
  })

  // ── 面板注册: 密码生成器 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('pwd-panel', {
      title: '密码生成',
      icon: 'key',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>🔑 密码生成器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap}</style>' +
          '<div class="pf-row">' +
          '<div style="flex:1;min-width:100px"><div class="pf-label">密码长度</div><input class="pf-input" id="pwd-len" type="number" value="16" min="4" max="128" /></div>' +
          '<div style="flex:2"><div class="pf-label">字符集</div>' +
          '<label style="font-size:12px;margin-right:12px"><input type="checkbox" id="pwd-upper" checked> 大写</label>' +
          '<label style="font-size:12px;margin-right:12px"><input type="checkbox" id="pwd-lower" checked> 小写</label>' +
          '<label style="font-size:12px;margin-right:12px"><input type="checkbox" id="pwd-num" checked> 数字</label>' +
          '<label style="font-size:12px"><input type="checkbox" id="pwd-sym" checked> 符号</label>' +
          '</div></div>' +
          '<div class="pf-row">' +
          '<button class="pf-btn" id="pwd-gen">生成密码</button>' +
          '<button class="pf-btn pf-btn-secondary" id="pwd-copy">📋 复制</button>' +
          '</div>' +
          '<div class="pf-label">生成的密码</div>' +
          '<div id="pwd-result" class="pf-result">点击生成...</div>' +
          '<div class="pf-label" style="margin-top:8px">强度分析</div>' +
          '<div id="pwd-strength" class="pf-result" style="padding:8px 12px"></div></div>';

        var LOW='abcdefghijklmnopqrstuvwxyz',UP='ABCDEFGHIJKLMNOPQRSTUVWXYZ',NUM='0123456789',SYM='!@#$%^&*()_+-=[]{}|;:,.<>?';

        function calcEntropy(len, pool) { return Math.floor(len * Math.log2(pool)); }
        function strengthLabel(e) {
          if(e>=128) return {level:'极强',color:'#22c55e',score:100};
          if(e>=80) return {level:'强',color:'#84cc16',score:80};
          if(e>=60) return {level:'中等',color:'#eab308',score:60};
          if(e>=40) return {level:'弱',color:'#f97316',score:40};
          return {level:'极弱',color:'#ef4444',score:20};
        }

        var resultEl = container.querySelector('#pwd-result');
        var strengthEl = container.querySelector('#pwd-strength');
        var lastPwd = '';

        container.querySelector('#pwd-gen').addEventListener('click', function() {
          var len = parseInt(container.querySelector('#pwd-len').value) || 16;
          var pool = '';
          if (container.querySelector('#pwd-lower').checked) pool += LOW;
          if (container.querySelector('#pwd-upper').checked) pool += UP;
          if (container.querySelector('#pwd-num').checked) pool += NUM;
          if (container.querySelector('#pwd-sym').checked) pool += SYM;
          if (!pool) pool = LOW + UP + NUM;

          var arr = new Uint32Array(len);
          crypto.getRandomValues(arr);
          var pwd = '';
          for (var i = 0; i < len; i++) pwd += pool[arr[i] % pool.length];
          lastPwd = pwd;

          var entropy = calcEntropy(len, pool.length);
          var s = strengthLabel(entropy);
          resultEl.textContent = pwd;
          strengthEl.innerHTML = '<span style="color:' + s.color + ';font-weight:600">' + s.level + '</span>  |  熵值: ' + entropy + ' bit  |  长度: ' + len + '  |  字符集: ' + pool.length + ' 种';
        });

        container.querySelector('#pwd-copy').addEventListener('click', function() {
          if (lastPwd) navigator.clipboard.writeText(lastPwd);
        });

        // Auto-generate on load
        container.querySelector('#pwd-gen').click();
      }
    });
  }

  console.log('[插件] 密码生成器已加载')
})()
