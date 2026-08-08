// ADB 远程控制插件
(function () {
  const api = Wrench.getPluginAPI()

  // ── 命令: 列出 ADB 设备 ──
  api.registerCommand('adb-list-devices', {
    label: '列出 ADB 设备',
    description: '列出所有已连接的 ADB 设备',
    execute: () => {
      api.showNotification('请在 SSH 终端手动执行: adb devices -l', 'info')
    }
  })

  // ── 命令: ADB 截屏 ──
  api.registerCommand('adb-take-screenshot', {
    label: 'ADB 截屏',
    description: '对已连接的 ADB 设备进行截屏',
    execute: () => {
      api.showNotification('请在 SSH 终端执行:\n1. adb shell screencap -p /sdcard/screenshot.png\n2. adb pull /sdcard/screenshot.png .', 'info')
    }
  })

  // ── 命令: ADB 输入文本 ──
  api.registerCommand('adb-input-text', {
    label: 'ADB 输入文本',
    description: '通过 ADB 向设备输入文本',
    execute: () => {
      const text = prompt('请输入要发送到设备的文本:')
      if (!text) return
      api.showNotification('请在 SSH 终端执行: adb shell input text "' + text.replace(/"/g, '\\"') + '"', 'info')
    }
  })

  // ── 面板注册: ADB 控制台 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('adb-panel', {
      title: 'ADB 控制台',
      icon: 'smartphone',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📱 ADB 命令速查</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<div class="pf-label">设备连接</div>' +
          '<div class="pf-row" style="flex-direction:column;gap:6px">' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb devices -l">📱 列出设备</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell getprop ro.product.model">ℹ️ 设备信息</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell screencap -p /sdcard/screenshot.png && adb pull /sdcard/screenshot.png .">📸 截屏并拉取</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell screencap -p /sdcard/sc.png && adb shell screenrecord --time-limit 10 /sdcard/vid.mp4">🎬 录屏(10s)</button>' +
          '</div>' +
          '<div class="pf-label">输入控制</div>' +
          '<div class="pf-row" style="flex-direction:column;gap:6px">' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell input tap 500 500">👆 点击坐标</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell input swipe 500 1500 500 500">👆 向上滑动</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell input keyevent 4">🔘 返回键</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell input keyevent 3">🏠 Home键</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell input keyevent 26">🔒 电源键</button>' +
          '</div>' +
          '<div class="pf-label">应用管理</div>' +
          '<div class="pf-row" style="flex-direction:column;gap:6px">' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell pm list packages -3">📦 第三方应用</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb shell dumpsys activity activities | grep mResumedActivity">🏃 当前Activity</button>' +
          '<button class="pf-btn pf-btn-secondary adb-cmd" data-cmd="adb logcat -d -t 50">📋 最近日志</button>' +
          '</div>' +
          '<div class="pf-label">自定义命令</div>' +
          '<div class="pf-row"><input class="pf-input" id="adb-custom" placeholder="输入自定义 ADB 命令..."><button class="pf-btn" id="adb-run">执行</button></div>' +
          '<div id="adb-panel-result" class="pf-result" style="display:none"></div></div>';

        var resultEl = container.querySelector('#adb-panel-result');
        var cmds = container.querySelectorAll('.adb-cmd');
        for (var i = 0; i < cmds.length; i++) {
          cmds[i].addEventListener('click', function() {
            var cmd = this.getAttribute('data-cmd');
            resultEl.style.display = 'block';
            resultEl.textContent = '📋 复制以下命令到终端执行：\n\n' + cmd;
          });
        }
        container.querySelector('#adb-run').addEventListener('click', function() {
          var custom = container.querySelector('#adb-custom').value.trim();
          if (custom) {
            resultEl.style.display = 'block';
            resultEl.textContent = '📋 ' + custom;
          }
        });
      }
    });
  }

  console.log('[插件] ADB 远程控制已加载')
})()
