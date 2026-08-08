// Cron 表达式工具插件
(function () {
  const api = Wrench.getPluginAPI()

  var DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

  function describeCronField(field, type) {
    // 处理复合表达式：逗号分隔、范围、步进、通配符
    if (field === '*') return type === 'min' ? '每分钟' : type === 'hour' ? '每小时' : type === 'dom' ? '每天' : type === 'month' ? '全年' : '每天'

    if (field.includes(',')) {
      return field.split(',').map(function (p) { return describeCronSingle(p, type) }).join(', ')
    }
    return describeCronSingle(field, type)
  }

  function describeCronSingle(field, type) {
    if (field === '*') return type === 'min' ? '每分钟' : '每小时'

    // 步进 */n
    var stepMatch = field.match(/^\*\/(\d+)$/)
    if (stepMatch) {
      var unit = type === 'min' ? '分钟' : type === 'hour' ? '小时' : type === 'dom' ? '天' : '月'
      return '每 ' + stepMatch[1] + unit
    }

    // 范围 a-b
    if (field.includes('-')) {
      var parts = field.split('-')
      if (type === 'dow') {
        return '星期 ' + DAY_NAMES[parseInt(parts[0])] + '～' + DAY_NAMES[parseInt(parts[1])]
      }
      if (type === 'hour') return parts[0] + ':00～' + parts[1] + ':00'
      if (type === 'min') return '第 ' + parts[0] + '～' + parts[1] + ' 分钟'
      return parts[0] + '～' + parts[1]
    }

    // 固定值
    if (type === 'dow') return '星期' + DAY_NAMES[parseInt(field)] || field
    if (type === 'hour') return field + ' 时'
    if (type === 'min') return '第 ' + field + ' 分钟'
    return field
  }

  function describeCron(expr) {
    var parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return '无效的 Cron 表达式（需要 5 个字段）'

    var min = parts[0], hour = parts[1], dom = parts[2], month = parts[3], dow = parts[4]

    var desc = []
    desc.push('分钟: ' + describeCronField(min, 'min'))
    desc.push('小时: ' + describeCronField(hour, 'hour'))
    desc.push('日期: ' + describeCronField(dom, 'dom'))
    desc.push('月份: ' + describeCronField(month, 'month'))

    if (dow === '*') {
      desc.push('星期: 每天')
    } else {
      desc.push('星期: ' + describeCronField(dow, 'dow'))
    }

    return desc.join('\n')
  }

  function parseCronField(field, min, max) {
    if (field === '*') return null // null = any value matches
    var values = new Set()
    var parts = field.split(',')
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]
      var stepMatch = p.match(/^(\d+|\*)\/(\d+)$/)
      if (stepMatch) {
        var start = stepMatch[1] === '*' ? min : parseInt(stepMatch[1])
        var step = parseInt(stepMatch[2])
        for (var v = start; v <= max; v += step) values.add(v)
        continue
      }
      var rangeMatch = p.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        for (var r = parseInt(rangeMatch[1]); r <= parseInt(rangeMatch[2]); r++) values.add(r)
        continue
      }
      values.add(parseInt(p))
    }
    return values
  }

  function getNextExecutions(expr, count) {
    count = count || 5
    var parts = expr.trim().split(/\s+/)
    if (parts.length !== 5) return []

    var results = []
    var now = new Date()
    var dt = new Date(now)
    dt.setSeconds(0)
    dt.setMilliseconds(0)
    dt.setMinutes(dt.getMinutes() + 1)

    var minVals = parseCronField(parts[0], 0, 59)
    var hourVals = parseCronField(parts[1], 0, 23)
    var domVals = parseCronField(parts[2], 1, 31)
    var monthVals = parseCronField(parts[3], 1, 12)
    var dowVals = parseCronField(parts[4], 0, 6)

    var maxIter = 525600 // 一年的分钟数
    var iter = 0

    while (results.length < count && iter < maxIter) {
      iter++
      var match = true

      // 月份
      if (monthVals && !monthVals.has(dt.getMonth() + 1)) {
        dt.setDate(dt.getDate() + 1)
        dt.setHours(0, 0, 0, 0)
        continue
      }

      // 日期和星期（两者都匹配才通过）
      var domOk = !domVals || domVals.has(dt.getDate())
      var dowOk = !dowVals || dowVals.has(dt.getDay())
      if (!domOk || !dowOk) {
        dt.setDate(dt.getDate() + 1)
        dt.setHours(0, 0, 0, 0)
        continue
      }

      // 小时
      if (hourVals && !hourVals.has(dt.getHours())) {
        dt.setHours(dt.getHours() + 1, 0, 0, 0)
        continue
      }

      // 分钟
      if (minVals && !minVals.has(dt.getMinutes())) {
        dt.setMinutes(dt.getMinutes() + 1)
        continue
      }

      results.push(
        (dt.getMonth() + 1).toString().padStart(2, '0') + '-' +
        dt.getDate().toString().padStart(2, '0') + ' ' +
        dt.getHours().toString().padStart(2, '0') + ':' +
        dt.getMinutes().toString().padStart(2, '0') +
        ' (' + DAY_NAMES[dt.getDay()] + ')'
      )
      dt.setMinutes(dt.getMinutes() + 1)
    }

    return results
  }

  var COMMON_CRONS = [
    { name: '每分钟', expr: '* * * * *' },
    { name: '每小时', expr: '0 * * * *' },
    { name: '每天凌晨 0 点', expr: '0 0 * * *' },
    { name: '每天上午 9 点', expr: '0 9 * * *' },
    { name: '每小时第 30 分', expr: '30 * * * *' },
    { name: '每周一上午 9 点', expr: '0 9 * * 1' },
    { name: '每月 1 号 0 点', expr: '0 0 1 * *' },
    { name: '每 5 分钟', expr: '*/5 * * * *' },
    { name: '每 15 分钟', expr: '*/15 * * * *' },
    { name: '每 30 分钟', expr: '*/30 * * * *' },
    { name: '工作日 9-17 点每小时', expr: '0 9-17 * * 1-5' },
    { name: '每天 8:00 和 20:00', expr: '0 8,20 * * *' },
  ]

  // ── 命令注册（通过旧式 API，供命令面板使用） ──
  api.registerCommand('cron-parse', {
    label: '解析 Cron',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 Cron 表达式', 'warning')
        return
      }
      var expr = content.trim().split('\n')[0]
      var desc = describeCron(expr)
      var output = 'Cron: ' + expr + '\n\n' + desc
      api.setEditorContent(output)
      api.showNotification('Cron 表达式已解析', 'success')
    },
  })

  api.registerCommand('cron-next', {
    label: '下次执行时间',
    execute: function () {
      var content = api.getEditorContent()
      if (!content) {
        api.showNotification('请先在编辑器中输入 Cron 表达式', 'warning')
        return
      }
      var expr = content.trim().split('\n')[0]
      var nexts = getNextExecutions(expr, 5)
      if (nexts.length === 0) {
        api.showNotification('无法计算执行时间，请检查表达式', 'error')
        return
      }
      var output = '━━━ ' + expr + ' ━━━\n\n接下来 ' + nexts.length + ' 次执行:\n\n' +
        nexts.map(function (n, i) { return '  ' + (i + 1) + '. ' + n }).join('\n')
      api.setEditorContent(output)
      api.showNotification('下次执行: ' + nexts[0], 'success')
    },
  })

  api.registerCommand('cron-common', {
    label: '常用 Cron 模板',
    execute: function () {
      var lines = ['━━━ 常用 Cron 表达式 ━━━', '']
      for (var i = 0; i < COMMON_CRONS.length; i++) {
        var c = COMMON_CRONS[i]
        lines.push((i + 1).toString().padStart(2) + '. ' + c.name)
        lines.push('    ' + c.expr)
      }
      api.setEditorContent(lines.join('\n'))
      api.showNotification('常用 Cron 模板已生成', 'success')
    },
  })

  // ── 面板注册 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('cron-panel', {
      title: 'Cron 表达式',
      icon: 'clock',
      render: function (container) {
        container.innerHTML =
          '<div class="pf-outer">' +
          '<style>' +
          '.pf-outer{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0;}' +
          '.pf-outer h3{margin:0 0 12px;font-size:14px;font-weight:600;color:#94a3b8;}' +
          '.pf-input{width:100%;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box;}' +
          '.pf-input:focus{border-color:#3b82f6;}' +
          '.pf-btn{padding:6px 14px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;transition:background 0.15s;}' +
          '.pf-btn:hover{background:#2563eb;}' +
          '.pf-btn-sec{background:#334155;}' +
          '.pf-btn-sec:hover{background:#475569;}' +
          '.pf-result{background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;font-family:"Cascadia Code",monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow-y:auto;}' +
          '.pf-label{font-size:11px;color:#64748b;margin-bottom:4px;display:block;}' +
          '.pf-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;}' +
          '.pf-tpl{padding:4px 10px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:11px;font-family:monospace;transition:all 0.15s;}' +
          '.pf-tpl:hover{border-color:#3b82f6;color:#38bdf8;background:rgba(14,165,233,0.05);}' +
          '</style>' +
          '<h3>⏰ Cron 表达式工具</h3>' +
          '<input class="pf-input" data-role="expr" value="0 9 * * 1-5" placeholder="分 时 日 月 周 (如: 0 9 * * 1-5)" />' +
          '<div class="pf-row" style="margin-top:8px">' +
          '<button class="pf-btn" data-role="parse-btn">解析</button>' +
          '<button class="pf-btn pf-btn-sec" data-role="next-btn">下次执行</button>' +
          '<button class="pf-btn pf-btn-sec" data-role="common-btn">常用模板</button>' +
          '</div>' +
          '<div class="pf-label">常用模板</div>' +
          '<div class="pf-row" data-role="tpls"></div>' +
          '<div class="pf-result" data-role="result">点击解析或输入表达式查看结果</div>' +
          '</div>'

        // 使用 container.querySelector 而非 document.getElementById
        var exprEl = container.querySelector('[data-role="expr"]')
        var resultEl = container.querySelector('[data-role="result"]')

        // 渲染常用模板按钮
        var tplsEl = container.querySelector('[data-role="tpls"]')
        for (var i = 0; i < COMMON_CRONS.length; i++) {
          var btn = document.createElement('button')
          btn.className = 'pf-tpl'
          btn.textContent = COMMON_CRONS[i].name
          btn.setAttribute('data-expr', COMMON_CRONS[i].expr)
          btn.addEventListener('click', function () {
            exprEl.value = this.getAttribute('data-expr')
            resultEl.textContent = describeCron(exprEl.value.trim())
          })
          tplsEl.appendChild(btn)
        }

        container.querySelector('[data-role="parse-btn"]').addEventListener('click', function () {
          var expr = exprEl.value.trim()
          if (!expr) { resultEl.textContent = '请输入 Cron 表达式'; return }
          resultEl.textContent = 'Cron: ' + expr + '\n\n' + describeCron(expr)
        })

        container.querySelector('[data-role="next-btn"]').addEventListener('click', function () {
          var expr = exprEl.value.trim()
          if (!expr) { resultEl.textContent = '请输入 Cron 表达式'; return }
          var nexts = getNextExecutions(expr, 10)
          if (nexts.length === 0) {
            resultEl.textContent = '无法计算执行时间，请检查表达式'
            return
          }
          resultEl.textContent = '━━━ ' + expr + ' ━━━\n\n接下来 ' + nexts.length + ' 次执行:\n\n' +
            nexts.map(function (n, i) { return '  ' + (i + 1) + '. ' + n }).join('\n')
        })

        container.querySelector('[data-role="common-btn"]').addEventListener('click', function () {
          var lines = ['━━━ 常用 Cron 表达式 ━━━', '']
          for (var i = 0; i < COMMON_CRONS.length; i++) {
            lines.push((i + 1).toString().padStart(2) + '. ' + COMMON_CRONS[i].name)
            lines.push('    ' + COMMON_CRONS[i].expr)
          }
          resultEl.textContent = lines.join('\n')
        })
      },
    })
  }

  console.log('[插件] Cron 表达式工具已加载')
})()
