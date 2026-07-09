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

  console.log('[插件] ADB 远程控制已加载')
})()
