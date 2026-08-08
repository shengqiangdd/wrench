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

  // ── 面板注册: 二维码 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('qrcode-panel', {
      title: '二维码',
      icon: 'qr-code',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📱 二维码生成器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<div class="pf-label">输入文本或 URL</div>' +
          '<textarea class="pf-input" id="qr-input" rows="3" placeholder="https://example.com 或任意文本..."></textarea>' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" id="qr-gen">生成二维码</button>' +
          '<button class="pf-btn pf-btn-secondary" id="qr-load">📥 从编辑器加载</button>' +
          '</div>' +
          '<div id="qr-display" style="text-align:center;margin:12px 0;min-height:200px;display:flex;align-items:center;justify-content:center;color:#64748b">输入内容后点击生成</div>' +
          '<div class="pf-row" style="justify-content:center">' +
          '<button class="pf-btn pf-btn-secondary" id="qr-dl-png" style="display:none">下载 PNG</button>' +
          '<a id="qr-dl-link" style="display:none" download="qrcode.png"></a>' +
          '</div></div>';

        var displayEl = container.querySelector('#qr-display');
        var currentUrl = '';
        var dlPngBtn = container.querySelector('#qr-dl-png');

        function genQR(text) {
          var encoded = encodeURIComponent(text);
          return 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encoded;
        }

        container.querySelector('#qr-load').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var c = api.getEditorContent();
            if (c) container.querySelector('#qr-input').value = c;
          }
        });

        container.querySelector('#qr-gen').addEventListener('click', function() {
          var text = container.querySelector('#qr-input').value.trim();
          if (!text) { displayEl.innerHTML = '<span style="color:#ef4444">请输入内容</span>'; return; }
          if (text.length > 2000) { displayEl.innerHTML = '<span style="color:#ef4444">文本过长（>2000字符）</span>'; return; }
          currentUrl = genQR(text);
          displayEl.innerHTML = '<img src="' + currentUrl + '" alt="QR Code" style="width:200px;height:200px;border-radius:8px;background:white;padding:8px" />';
          dlPngBtn.style.display = 'inline-block';
        });

        dlPngBtn.addEventListener('click', function() {
          if (currentUrl) {
            var link = document.createElement('a');
            link.href = currentUrl;
            link.download = 'qrcode.png';
            link.target = '_blank';
            link.click();
          }
        });
      }
    });
  }

  console.log('[插件] 二维码工具已加载')
})()
