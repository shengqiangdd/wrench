// 系统监控插件
(function () {
  const api = Wrench.getPluginAPI()

  // ── 命令: CPU 监控 ──
  api.registerCommand('monitor-cpu', {
    label: 'CPU 使用率',
    description: '查看 CPU 使用情况',
    execute: () => {
      api.showNotification('请在 SSH 终端执行: top -bn1 | head -20', 'info')
    }
  })

  // ── 命令: 内存监控 ──
  api.registerCommand('monitor-memory', {
    label: '内存使用率',
    description: '查看内存使用情况',
    execute: () => {
      api.showNotification('请在 SSH 终端执行: free -h', 'info')
    }
  })

  // ── 命令: 磁盘监控 ──
  api.registerCommand('monitor-disk', {
    label: '磁盘使用率',
    description: '查看磁盘使用情况',
    execute: () => {
      api.showNotification('请在 SSH 终端执行: df -h', 'info')
    }
  })

  // ── 命令: 网络监控 ──
  api.registerCommand('monitor-network', {
    label: '网络流量',
    description: '查看网络流量统计',
    execute: () => {
      api.showNotification('请在 SSH 终端执行: cat /proc/net/dev | head -10', 'info')
    }
  })

  // ── 命令: 完整系统状态 ──
  api.registerCommand('monitor-all', {
    label: '完整系统状态',
    description: '查看完整的系统资源状态汇总',
    execute: () => {
      api.showNotification('请在 SSH 终端执行:\nuptime\ntop -bn1 | head -5\nfree -h\ndf -h /', 'info')
    }
  })

  // ── 面板注册: 系统监控 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('monitor-panel', {
      title: '系统监控',
      icon: 'activity',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📊 系统监控仪表盘</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}</style>' +
          '<div class="pf-row" style="flex-direction:column;gap:6px">' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="uptime">⏱️ 运行时间 (uptime)</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="top -bn1 | head -10">🖥️ CPU 状态 (top)</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="free -h">💾 内存状态 (free)</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="df -h /">📀 磁盘状态 (df)</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="cat /proc/loadavg">📈 系统负载</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="ps aux --sort=-%cpu | head -10">🔥 CPU Top 进程</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="ps aux --sort=-%mem | head -10">🧠 内存 Top 进程</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="ss -tlnp">🌐 监听端口</button>' +
          '<button class="pf-btn pf-btn-secondary mon-cmd" data-cmd="cat /proc/net/dev | head -10">📶 网络流量</button>' +
          '</div>' +
          '<div class="pf-label">常用监控命令</div>' +
          '<div id="mon-result" class="pf-result">点击上方按钮查看对应系统信息\\n\\n提示：这些命令需要在 SSH 终端中执行\\n面板会显示完整的命令供复制使用</div></div>';

        var resultEl = container.querySelector('#mon-result');
        var cmds = container.querySelectorAll('.mon-cmd');
        for (var i = 0; i < cmds.length; i++) {
          cmds[i].addEventListener('click', function() {
            var cmd = this.getAttribute('data-cmd');
            resultEl.textContent = '📋 复制以下命令到终端执行：\\n\\n$ ' + cmd;
          });
        }
      }
    });
  }

  console.log('[插件] 系统监控已加载')
})()
