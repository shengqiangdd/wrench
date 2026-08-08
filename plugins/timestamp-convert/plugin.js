// 时间戳转换插件
(function () {
  const api = Wrench.getPluginAPI()

  api.registerCommand('ts-to-date', {
    label: '时间戳 → 日期',
    description: '将 Unix 时间戳（毫秒/秒）转为可读日期',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入时间戳', 'warning')
        return
      }

      const input = content.trim()
      // 尝试解析输入（支持毫秒和秒级时间戳）
      let ts = parseInt(input, 10)
      if (isNaN(ts)) {
        api.showNotification('输入内容不是有效数字', 'error')
        return
      }

      // 秒级时间戳转为毫秒
      if (ts < 10000000000) {
        ts = ts * 1000
      }

      const date = new Date(ts)
      if (isNaN(date.getTime())) {
        api.showNotification('无法解析为有效日期', 'error')
        return
      }

      const results = [
        `输入: ${input}`,
        `━━━━━━━━━━━━━━━━━━`,
        `UTC:     ${date.toUTCString()}`,
        `本地:    ${date.toLocaleString()}`,
        `ISO:     ${date.toISOString()}`,
        `日期:    ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        `时间:    ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
        `星期:    ${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`,
        `━━━━━━━━━━━━━━━━━━`,
        `毫秒戳:  ${ts}`,
        `秒戳:    ${Math.floor(ts / 1000)}`,
      ].join('\n')

      api.setEditorContent(results)
      api.showNotification('时间戳转换完成', 'success')
    }
  })

  api.registerCommand('date-to-ts', {
    label: '日期 → 时间戳',
    description: '将日期字符串转为 Unix 时间戳（毫秒）',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入日期文本', 'warning')
        return
      }

      const input = content.trim()
      const date = new Date(input)

      if (isNaN(date.getTime())) {
        api.showNotification('无法解析输入为日期，请使用 YYYY-MM-DD 或 ISO 格式', 'error')
        return
      }

      const ms = date.getTime()
      const s = Math.floor(ms / 1000)

      const results = [
        `输入: ${input}`,
        `━━━━━━━━━━━━━━━━━━`,
        `毫秒时间戳:  ${ms}`,
        `秒时间戳:    ${s}`,
        `━━━━━━━━━━━━━━━━━━`,
        `UTC:  ${date.toUTCString()}`,
        `本地: ${date.toLocaleString()}`,
        `ISO:  ${date.toISOString()}`,
      ].join('\n')

      api.setEditorContent(results)
      api.showNotification('日期转时间戳完成', 'success')
    }
  })

  // ── 面板注册: 时间戳转换 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('timestamp-panel', {
      title: '时间戳转换',
      icon: 'clock',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>⏰ 时间戳转换工具</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<div class="pf-row">' +
          '<div style="flex:1"><div class="pf-label">时间戳 → 日期</div><input class="pf-input" id="ts-input" placeholder="1700000000" /></div>' +
          '<div style="display:flex;align-items:flex-end"><button class="pf-btn" id="ts-to-date">→ 日期</button></div>' +
          '</div>' +
          '<div class="pf-row">' +
          '<div style="flex:1"><div class="pf-label">日期 → 时间戳</div><input class="pf-input" id="ts-date-input" placeholder="2024-01-01 12:00:00" /></div>' +
          '<div style="display:flex;align-items:flex-end"><button class="pf-btn pf-btn-secondary" id="date-to-ts">→ 时间戳</button></div>' +
          '</div>' +
          '<div class="pf-row"><button class="pf-btn pf-btn-secondary" id="ts-now">📍 获取当前时间戳</button></div>' +
          '<div id="ts-result" class="pf-result">输入时间戳或日期后点击转换</div></div>';

        var resultEl = container.querySelector('#ts-result');
        var DAY_NAMES = ['日','一','二','三','四','五','六'];

        container.querySelector('#ts-to-date').addEventListener('click', function() {
          var val = container.querySelector('#ts-input').value.trim();
          if (!val) { resultEl.textContent = '请输入时间戳'; return; }
          var ts = parseInt(val, 10);
          if (isNaN(ts)) { resultEl.textContent = '无效的数字'; return; }
          if (ts < 10000000000) ts = ts * 1000;
          var date = new Date(ts);
          resultEl.textContent = [
            '时间戳: ' + val,
            '━━━━━━━━━━━━━━━━━━',
            'UTC:     ' + date.toUTCString(),
            '本地:    ' + date.toLocaleString(),
            'ISO:     ' + date.toISOString(),
            '日期:    ' + date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'),
            '时间:    ' + String(date.getHours()).padStart(2,'0')+':'+String(date.getMinutes()).padStart(2,'0')+':'+String(date.getSeconds()).padStart(2,'0'),
            '星期:    ' + DAY_NAMES[date.getDay()],
            '━━━━━━━━━━━━━━━━━━',
            '毫秒戳:  ' + ts,
            '秒戳:    ' + Math.floor(ts/1000),
          ].join('\n');
        });

        container.querySelector('#date-to-ts').addEventListener('click', function() {
          var val = container.querySelector('#ts-date-input').value.trim();
          if (!val) { resultEl.textContent = '请输入日期'; return; }
          var date = new Date(val);
          if (isNaN(date.getTime())) { resultEl.textContent = '无法解析日期，请使用 YYYY-MM-DD 格式'; return; }
          var ms = date.getTime(), s = Math.floor(ms/1000);
          resultEl.textContent = [
            '输入: ' + val,
            '━━━━━━━━━━━━━━━━━━',
            '毫秒时间戳:  ' + ms,
            '秒时间戳:    ' + s,
            '━━━━━━━━━━━━━━━━━━',
            'UTC:  ' + date.toUTCString(),
            'ISO:  ' + date.toISOString(),
          ].join('\n');
        });

        container.querySelector('#ts-now').addEventListener('click', function() {
          var now = Math.floor(Date.now()/1000);
          container.querySelector('#ts-input').value = now;
          resultEl.textContent = [
            '当前时间戳:',
            '秒:   ' + now,
            '毫秒: ' + Date.now(),
          ].join('\n');
        });
      }
    });
  }

  console.log('[插件] 时间戳转换已加载')
})()
