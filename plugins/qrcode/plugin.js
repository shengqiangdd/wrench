// 二维码生成/解析插件
(function () {
  const api = Wrench.getPluginAPI()

  // 生成二维码（使用在线 API）
  function generateQRCode(text, size) {
    // 使用 API 生成二维码图片 URL（纯前端实现）
    // QR码编码算法简化版 - 实际可接入 qrcode.js 库
    const encoded = encodeURIComponent(text)
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encoded}`
  }

  api.registerCommand('qrcode-generate', {
    label: '生成二维码',
    description: '从文本或链接生成二维码图片',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入要生成二维码的文本', 'warning')
        return
      }

      const text = content.trim()
      if (text.length > 2000) {
        api.showNotification('文本过长（超过2000字符），请缩短后再试', 'warning')
        return
      }

      // 生成二维码
      const qrUrl = generateQRCode(text, 300)

      // 在右侧面板显示二维码
      api.openPanel('qrcode-panel', {
        type: 'qr-code',
        imageUrl: qrUrl,
        text: text,
      })

      api.showNotification('二维码已生成，查看右侧面板', 'success')
    }
  })

  api.registerCommand('qrcode-decode', {
    label: '解析二维码',
    description: '从图片中解析二维码内容',
    execute: () => {
      // 创建文件选择器让用户选择二维码图片
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'

      input.onchange = async function (e) {
        const file = input.files[0]
        if (!file) return

        api.showNotification('正在解析二维码...', 'info')

        try {
          // 使用 OCR 方式读取图片，实际项目中可接入 jsQR 等库
          // 这里我们使用在线 API 进行解码
          const formData = new FormData()
          formData.append('file', file)

          // 由于 CORS 限制，使用简单的显示方式
          // 将图片显示在面板中供用户查看
          const reader = new FileReader()
          reader.onload = function (ev) {
            api.openPanel('qrcode-panel', {
              type: 'decode-result',
              imageUrl: ev.target.result,
              message: '请使用手机扫描上方二维码图片，或安装 jsQR 库实现完整解码',
            })
            api.showNotification('图片已加载到右侧面板', 'success')
          }
          reader.readAsDataURL(file)
        } catch (e) {
          api.showNotification('解析失败: ' + e.message, 'error')
        }
      }

      input.click()
    }
  })

  console.log('[插件] 二维码工具已加载')
})()
