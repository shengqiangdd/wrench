// 占位文本生成器插件
(function () {
  const api = Wrench.getPluginAPI()

  var EN_WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum'.split(' ')

  var ZH_SENTENCES = [
    '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。',
    '寒来暑往，秋收冬藏。闰余成岁，律吕调阳。',
    '云腾致雨，露结为霜。金生丽水，玉出昆冈。',
    '剑号巨阙，珠称夜光。果珍李柰，菜重芥姜。',
    '海咸河淡，鳞潜羽翔。龙师火帝，鸟官人皇。',
    '始制文字，乃服衣裳。推位让国，有虞陶唐。',
    '吊民伐罪，周发殷汤。坐朝问道，垂拱平章。',
    '爱育黎首，臣伏戎羌。遐迩一体，率宾归王。',
    '鸣凤在竹，白驹食场。化被草木，赖及万方。',
    '盖此身发，四大五常。恭惟鞠养，岂敢毁伤。',
  ]

  function generateEnParagraph(sentences) {
    var result = []
    for (var i = 0; i < sentences; i++) {
      var len = 8 + Math.floor(Math.random() * 10)
      var words = []
      for (var j = 0; j < len; j++) {
        words.push(EN_WORDS[Math.floor(Math.random() * EN_WORDS.length)])
      }
      words[0] = words[0][0].toUpperCase() + words[0].slice(1)
      result.push(words.join(' ') + '.')
    }
    return result.join(' ')
  }

  function generateZhParagraph(sentences) {
    var result = []
    for (var i = 0; i < sentences; i++) {
      result.push(ZH_SENTENCES[Math.floor(Math.random() * ZH_SENTENCES.length)])
    }
    return result.join('')
  }

  api.registerCommand('lorem-en', {
    label: '英文占位文本',
    description: '生成英文 Lorem Ipsum 文本',
    execute: function () {
      var text = generateEnParagraph(3)
      api.setEditorContent(text)
      api.showNotification('英文占位文本已生成', 'success')
    },
  })

  api.registerCommand('lorem-zh', {
    label: '中文占位文本',
    description: '生成中文占位文本',
    execute: function () {
      var text = generateZhParagraph(3)
      api.setEditorContent(text)
      api.showNotification('中文占位文本已生成', 'success')
    },
  })

  api.registerCommand('lorem-paragraphs', {
    label: '多段落生成',
    description: '生成指定段落数的占位文本',
    execute: function () {
      var count = parseInt(prompt('请输入段落数（默认 5）：') || '5', 10)
      if (isNaN(count) || count < 1) count = 5
      var paragraphs = []
      for (var i = 0; i < count; i++) {
        paragraphs.push(generateEnParagraph(3 + Math.floor(Math.random() * 3)))
      }
      api.setEditorContent(paragraphs.join('\n\n'))
      api.showNotification('已生成 ' + count + ' 段占位文本', 'success')
    },
  })

  // ── 面板注册: 占位文本 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('lorem-panel', {
      title: '占位文本',
      icon: 'text',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📄 占位文本生成器</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px;align-items:center}</style>' +
          '<div class="pf-row">' +
          '<div style="flex:1"><div class="pf-label">段落数</div><input class="pf-input" id="lorem-count" type="number" value="3" min="1" max="50" /></div>' +
          '<div style="flex:1"><div class="pf-label">语言</div><select class="pf-input" id="lorem-lang"><option value="en">English (Lorem)</option><option value="zh">中文</option></select></div>' +
          '</div>' +
          '<div class="pf-row">' +
          '<button class="pf-btn" id="lorem-gen">生成</button>' +
          '<button class="pf-btn pf-btn-secondary" id="lorem-insert">📋 插入到编辑器</button>' +
          '</div>' +
          '<div class="pf-label">生成结果</div>' +
          '<div id="lorem-result" class="pf-result">点击生成按钮...</div></div>';

        var EN_WORDS = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'.split(' ');
        var ZH_SENTENCES = ['天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。','寒来暑往，秋收冬藏。闰余成岁，律吕调阳。','云腾致雨，露结为霜。金生丽水，玉出昆冈。','剑号巨阙，珠称夜光。果珍李柰，菜重芥姜。','海咸河淡，鳞潜羽翔。龙师火帝，鸟官人皇。'];

        function genEn(sentences) {
          var r = [];
          for (var i = 0; i < sentences; i++) {
            var len = 8+Math.floor(Math.random()*10), words = [];
            for (var j = 0; j < len; j++) words.push(EN_WORDS[Math.floor(Math.random()*EN_WORDS.length)]);
            words[0] = words[0][0].toUpperCase()+words[0].slice(1);
            r.push(words.join(' ')+'.');
          }
          return r.join(' ');
        }
        function genZh(count) {
          var r = [];
          for (var i = 0; i < count; i++) r.push(ZH_SENTENCES[Math.floor(Math.random()*ZH_SENTENCES.length)]);
          return r.join('');
        }

        var resultEl = container.querySelector('#lorem-result');
        var currentResult = '';
        container.querySelector('#lorem-gen').addEventListener('click', function() {
          var count = parseInt(container.querySelector('#lorem-count').value) || 3;
          var lang = container.querySelector('#lorem-lang').value;
          var paragraphs = [];
          for (var i = 0; i < count; i++) {
            paragraphs.push(lang === 'zh' ? genZh(3) : genEn(3+Math.floor(Math.random()*3)));
          }
          currentResult = paragraphs.join('\\n\\n');
          resultEl.textContent = currentResult;
        });
        container.querySelector('#lorem-insert').addEventListener('click', function() {
          if (currentResult && typeof api !== 'undefined') api.setEditorContent(currentResult);
        });
      }
    });
  }

  console.log('[插件] 占位文本生成器已加载')
})()
