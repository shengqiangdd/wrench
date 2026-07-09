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

  console.log('[插件] 系统监控已加载')
})()
