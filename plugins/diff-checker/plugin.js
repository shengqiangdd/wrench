// 文本对比工具插件
(function () {
  const api = Wrench.getPluginAPI()

  /**
   * 简单 LCS 差分算法：返回逐行 diff 结果
   * @returns {Array<{type: 'same'|'add'|'remove', text: string}>}
   */
  function lineDiff(oldLines, newLines) {
    const m = oldLines.length
    const n = newLines.length

    // DP 表计算 LCS 长度
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
        }
      }
    }

    // 回溯得到 diff 结果
    const result = []
    let i = m, j = n
    const temp = []

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        temp.push({ type: 'same', text: oldLines[i - 1] })
        i--
        j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        temp.push({ type: 'add', text: newLines[j - 1] })
        j--
      } else {
        temp.push({ type: 'remove', text: oldLines[i - 1] })
        i--
      }
    }

    return temp.reverse()
  }

  function formatDiffResult(diff) {
    let output = ''
    let addCount = 0
    let removeCount = 0

    for (const d of diff) {
      if (d.type === 'same') {
        output += '  ' + d.text + '\n'
      } else if (d.type === 'add') {
        output += '+ ' + d.text + '\n'
        addCount++
      } else if (d.type === 'remove') {
        output += '- ' + d.text + '\n'
        removeCount++
      }
    }

    const stats = []
    if (removeCount > 0) stats.push(`-${removeCount} 行`)
    if (addCount > 0) stats.push(`+${addCount} 行`)
    const summary = stats.length > 0
      ? `\n━━━ 差异统计 ━━━\n删除: ${removeCount} 行  新增: ${addCount} 行`
      : '\n两个文本完全一致，无差异 ✓'

    return output + summary
  }

  api.registerCommand('diff-compare', {
    label: '比较差异',
    description: '与剪贴板内容进行行级对比',
    execute: () => {
      const content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中打开文件', 'warning')
        return
      }

      // 尝试读取剪贴板
      navigator.clipboard.readText().then(clipText => {
        if (!clipText) {
          api.showNotification('剪贴板为空，请先复制要对比的文本', 'warning')
          return
        }

        const oldLines = content.split('\n')
        const newLines = clipText.split('\n')

        const diff = lineDiff(oldLines, newLines)
        const result = formatDiffResult(diff)

        api.setEditorContent(result)
        api.showNotification('差异对比完成', 'success')
      }).catch(() => {
        api.showNotification('无法读取剪贴板，请在编辑器中手动输入对比文本', 'error')
      })
    }
  })

  // ── 面板注册: 文本对比 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('diff-panel', {
      title: '文本对比',
      icon: 'git-compare',
      render: function(container) {
        container.innerHTML = '<div class="pf"><h3>📝 文本对比工具</h3>' +
          '<style>.pf{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0}.pf h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8}.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;resize:vertical}.pf-input:focus{border-color:#3b82f6}.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer}.pf-btn:hover{background:#2563eb}.pf-btn-secondary{background:#334155}.pf-btn-secondary:hover{background:#475569}.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:400px;overflow-y:auto}.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block}.pf-row{display:flex;gap:8px;margin-bottom:12px}</style>' +
          '<div class="pf-row"><div style="flex:1"><div class="pf-label">原文（左）</div><textarea class="pf-input" id="diff-left" rows="5" placeholder="粘贴原始文本..."></textarea></div>' +
          '<div style="flex:1"><div class="pf-label">新文本（右）</div><textarea class="pf-input" id="diff-right" rows="5" placeholder="粘贴修改后文本..."></textarea></div></div>' +
          '<div class="pf-row">' +
          '<button class="pf-btn" id="diff-compare">🔍 对比</button>' +
          '<button class="pf-btn pf-btn-secondary" id="diff-load-left">📥 左侧加载编辑器</button>' +
          '</div>' +
          '<div class="pf-label">对比结果</div>' +
          '<div id="diff-result" class="pf-result">在左右两侧输入文本，点击对比查看差异</div></div>';

        var resultEl = container.querySelector('#diff-result');

        container.querySelector('#diff-load-left').addEventListener('click', function() {
          if (typeof api !== 'undefined') {
            var c = api.getEditorContent();
            if (c) container.querySelector('#diff-left').value = c;
          }
        });

        function lineDiff(oldLines, newLines) {
          var m = oldLines.length, n = newLines.length;
          var dp = Array.from({length:m+1}, function(){return new Array(n+1).fill(0)});
          for (var i = 1; i <= m; i++) for (var j = 1; j <= n; j++) {
            if (oldLines[i-1]===newLines[j-1]) dp[i][j]=dp[i-1][j-1]+1;
            else dp[i][j]=Math.max(dp[i-1][j],dp[i][j-1]);
          }
          var result=[],i=m,j=n,temp=[];
          while(i>0||j>0){
            if(i>0&&j>0&&oldLines[i-1]===newLines[j-1]){temp.push({type:'same',text:oldLines[i-1]});i--;j--;}
            else if(j>0&&(i===0||dp[i][j-1]>=dp[i-1][j])){temp.push({type:'add',text:newLines[j-1]});j--;}
            else{temp.push({type:'remove',text:oldLines[i-1]});i--;}
          }
          return temp.reverse();
        }

        container.querySelector('#diff-compare').addEventListener('click', function() {
          var left = container.querySelector('#diff-left').value;
          var right = container.querySelector('#diff-right').value;
          if (!left && !right) { resultEl.textContent = '请输入需要对比的文本'; return; }
          var diff = lineDiff(left.split('\\n'), right.split('\\n'));
          var output = '', addCount = 0, removeCount = 0;
          for (var d = 0; d < diff.length; d++) {
            if (diff[d].type==='same') output += '  ' + diff[d].text + '\\n';
            else if (diff[d].type==='add') { output += '+ ' + diff[d].text + '\\n'; addCount++; }
            else { output += '- ' + diff[d].text + '\\n'; removeCount++; }
          }
          var stats = [];
          if (removeCount > 0) stats.push('-' + removeCount + ' 行');
          if (addCount > 0) stats.push('+' + addCount + ' 行');
          output += '\\n━━━ 差异统计 ━━━\\n删除: ' + removeCount + ' 行  新增: ' + addCount + ' 行';
          resultEl.textContent = output;
        });
      }
    });
  }

  console.log('[插件] 文本对比工具已加载')
})()
