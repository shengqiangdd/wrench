/**
 * Cron 可视化器插件
 * Cron 表达式解析、自然语言描述、未来触发时间、交互式构建器
 */
(function () {
  var DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

  function parseCronField(field, min, max) {
    if (field === '*') return null
    var values = new Set()
    field.split(',').forEach(function (p) {
      var stepMatch = p.match(/^(\d+|\*)\/(\d+)$/)
      if (stepMatch) {
        var start = stepMatch[1] === '*' ? min : parseInt(stepMatch[1])
        var step = parseInt(stepMatch[2])
        for (var v = start; v <= max; v += step) values.add(v)
        return
      }
      var rangeMatch = p.match(/^(\d+)-(\d+)$/)
      if (rangeMatch) {
        for (var r = parseInt(rangeMatch[1]); r <= parseInt(rangeMatch[2]); r++) values.add(r)
        return
      }
      values.add(parseInt(p))
    })
    return values
  }

  function describe(expr) {
    var parts = expr.trim().split(/\s+/)
    if (parts.length < 5) return '无效的 Cron 表达式'
    var min = parts[0], hour = parts[1], dom = parts[2], month = parts[3], dow = parts[4]

    function describeField(field, type) {
      if (field === '*') return type === 'min' ? '每分钟' : type === 'hour' ? '每小时' : type === 'dom' ? '每天' : type === 'month' ? '全年' : '每天'
      if (field.includes(',')) return field.split(',').map(function (p) { return describeSingle(p, type) }).join(', ')
      return describeSingle(field, type)
    }

    function describeSingle(field, type) {
      if (field === '*') return '每' + (type === 'min' ? '分钟' : '小时')
      var stepMatch = field.match(/^\*\/(\d+)$/)
      if (stepMatch) {
        var unit = type === 'min' ? '分钟' : type === 'hour' ? '小时' : type === 'dom' ? '天' : '月'
        return '每 ' + stepMatch[1] + unit
      }
      if (field.includes('-')) {
        var pp = field.split('-')
        if (type === 'dow') return '星期' + DAY_NAMES[parseInt(pp[0])] + '～' + DAY_NAMES[parseInt(pp[1])]
        if (type === 'hour') return pp[0] + ':00～' + pp[1] + ':00'
        if (type === 'min') return '第 ' + pp[0] + '～' + pp[1] + ' 分钟'
        return pp[0] + '～' + pp[1]
      }
      if (type === 'dow') return '星期' + (DAY_NAMES[parseInt(field)] || field)
      if (type === 'hour') return field + ' 时'
      if (type === 'min') return '第 ' + field + ' 分钟'
      return field
    }

    var desc = []
    desc.push('分钟: ' + describeField(min, 'min'))
    desc.push('小时: ' + describeField(hour, 'hour'))
    desc.push('日期: ' + describeField(dom, 'dom'))
    desc.push('月份: ' + describeField(month, 'month'))
    desc.push('星期: ' + (dow === '*' ? '每天' : describeField(dow, 'dow')))
    return desc.join('，')
  }

  function getNextTriggers(expr, count) {
    var parts = expr.trim().split(/\s+/)
    if (parts.length < 5) return []
    var minVals = parseCronField(parts[0], 0, 59)
    var hourVals = parseCronField(parts[1], 0, 23)
    var domVals = parseCronField(parts[2], 1, 31)
    var monthVals = parseCronField(parts[3], 1, 12)
    var dowVals = parseCronField(parts[4], 0, 6)

    var now = new Date()
    var triggers = []
    var dt = new Date(now)
    dt.setSeconds(0)
    dt.setMilliseconds(0)
    dt.setMinutes(dt.getMinutes() + 1)

    var maxIter = 366 * 24 * 60
    for (var i = 0; i < maxIter && triggers.length < count; i++) {
      if (monthVals && !monthVals.has(dt.getMonth() + 1)) { dt.setDate(dt.getDate() + 1); dt.setHours(0, 0, 0, 0); continue }
      var domOk = !domVals || domVals.has(dt.getDate())
      var dowOk = !dowVals || dowVals.has(dt.getDay())
      if (!domOk || !dowOk) { dt.setDate(dt.getDate() + 1); dt.setHours(0, 0, 0, 0); continue }
      if (hourVals && !hourVals.has(dt.getHours())) { dt.setHours(dt.getHours() + 1, 0, 0, 0); continue }
      if (minVals && !minVals.has(dt.getMinutes())) { dt.setMinutes(dt.getMinutes() + 1); continue }
      triggers.push(new Date(dt))
      dt.setMinutes(dt.getMinutes() + 1)
    }
    return triggers
  }

  // ── 命令注册（供命令面板使用） ──
  if (typeof Wrench !== 'undefined') {
    var api = Wrench.getPluginAPI()
    api.registerCommand('cron-vis', {
      label: 'Cron 可视化',
      execute: function () {
        var content = api.getEditorContent()
        var expr = (content || '').trim().split('\n')[0] || '* * * * *'
        var desc = describe(expr)
        var nexts = getNextTriggers(expr, 5)
        var output = '━━━ ' + expr + ' ━━━\n\n' + desc + '\n\n接下来执行:\n' +
          (nexts.length === 0 ? '  无法计算' : nexts.map(function (t, i) {
            return '  ' + (i + 1) + '. ' +
              (t.getMonth() + 1).toString().padStart(2, '0') + '-' +
              t.getDate().toString().padStart(2, '0') + ' ' +
              t.getHours().toString().padStart(2, '0') + ':' +
              t.getMinutes().toString().padStart(2, '0') +
              ' (' + DAY_NAMES[t.getDay()] + ')'
          }).join('\n'))
        api.setEditorContent(output)
        api.showNotification('Cron 可视化结果已生成', 'success')
      },
    })
    api.registerCommand('cron-build', {
      label: 'Cron 构建器',
      execute: function () {
        api.showNotification('请在右侧面板使用交互式构建器', 'info')
      },
    })
  }

  // ── 面板注册 ──
  if (typeof wrench !== 'undefined' && wrench.panels) {
    wrench.panels.register('cronvis-panel', {
      title: 'Cron 可视化器',
      icon: 'clock',
      render: function (container) {
        container.innerHTML =
          '<div class="cv-outer">' +
          '<style>' +
          '.cv-outer{padding:16px;font-family:system-ui,sans-serif;color:#e2e8f0;}' +
          '.cv-outer h3{margin:0 0 10px;font-size:1.1em;color:#f1f5f9;display:flex;align-items:center;gap:8px;}' +
          '.cv-outer h4{margin:14px 0 6px;font-size:0.9em;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;}' +
          '.cv-input-row{display:flex;gap:8px;margin-bottom:10px;}' +
          '.cv-expr-input{flex:1;padding:8px 12px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-family:monospace;font-size:1.1em;outline:none;box-sizing:border-box;}' +
          '.cv-expr-input:focus{border-color:#0ea5e9;box-shadow:0 0 0 2px rgba(14,165,233,0.15);}' +
          '.cv-parse{padding:8px 16px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:500;transition:all 150ms;}' +
          '.cv-parse:hover{background:#0ea5e9;}' +
          '.cv-presets{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;}' +
          '.cv-preset{padding:4px 10px;background:#1e293b;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:0.75em;font-family:monospace;transition:all 150ms;}' +
          '.cv-preset:hover{border-color:#0ea5e9;color:#38bdf8;background:rgba(14,165,233,0.05);}' +
          '.cv-desc{padding:8px 12px;background:rgba(14,165,233,0.06);border:1px solid rgba(14,165,233,0.15);border-radius:6px;color:#7dd3fc;font-size:0.9em;margin-bottom:10px;}' +
          '.cv-parts{display:flex;gap:4px;margin-bottom:10px;}' +
          '.cv-part{text-align:center;padding:8px 10px;background:#0f172a;border-radius:6px;border:1px solid #1e293b;flex:1;}' +
          '.cv-part .val{font-family:monospace;color:#38bdf8;font-size:1em;font-weight:600;}' +
          '.cv-part .lbl{font-size:0.7em;color:#64748b;margin-top:2px;}' +
          '.cv-triggers{list-style:none;padding:0;margin:0;}' +
          '.cv-trigger{padding:6px 12px;border-bottom:1px solid #1e293b;font-size:0.85em;color:#cbd5e1;font-family:monospace;}' +
          '.cv-trigger:nth-child(odd){background:rgba(15,23,42,0.5);}' +
          '.cv-trigger .d{color:#64748b;margin-right:8px;}' +
          '.cv-builder{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:12px;}' +
          '.cv-b-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;}' +
          '.cv-b-row label{min-width:60px;color:#94a3b8;font-size:0.85em;}' +
          '.cv-b-row select{padding:6px 10px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;font-size:0.85em;outline:none;}' +
          '.cv-b-row select:focus{border-color:#0ea5e9;}' +
          '.cv-b-result{margin-top:8px;padding:10px;background:#1e293b;border:1px solid #1e293b;border-radius:6px;font-family:monospace;color:#38bdf8;text-align:center;font-size:1.1em;font-weight:600;}' +
          '</style>' +
          '<h3>⏰ Cron 可视化器</h3>' +
          '<div class="cv-input-row">' +
          '<input type="text" class="cv-expr-input" data-role="expr" value="*/5 * * * *" placeholder="输入 Cron 表达式（如 */5 * * * *）" />' +
          '<button class="cv-parse" data-role="parse-btn">解析</button>' +
          '</div>' +
          '<div class="cv-presets" data-role="presets"></div>' +
          '<div class="cv-desc" data-role="desc"></div>' +
          '<div class="cv-parts" data-role="parts"></div>' +
          '<h4>📅 未来触发时间</h4>' +
          '<div class="cv-triggers" data-role="triggers"></div>' +
          '<h4>🔧 交互式构建器</h4>' +
          '<div class="cv-builder" data-role="builder"></div>'

        var exprEl = container.querySelector('[data-role="expr"]')
        var descEl = container.querySelector('[data-role="desc"]')
        var partsEl = container.querySelector('[data-role="parts"]')
        var triggersEl = container.querySelector('[data-role="triggers"]')

        var presets = [
          ['每分钟', '* * * * *'], ['每5分钟', '*/5 * * * *'], ['每小时', '0 * * * *'],
          ['每小时半', '30 * * * *'], ['每天凌晨', '0 0 * * *'], ['每天8点', '0 8 * * *'],
          ['每周一', '0 9 * * 1'], ['每月1号', '0 0 1 * *'], ['工作日9点', '0 9 * * 1-5'],
        ]
        var presetsEl = container.querySelector('[data-role="presets"]')
        presets.forEach(function (item) {
          var btn = document.createElement('button')
          btn.className = 'cv-preset'
          btn.textContent = item[0]
          btn.setAttribute('data-expr', item[1])
          btn.addEventListener('click', function () {
            exprEl.value = this.getAttribute('data-expr')
            doParse()
          })
          presetsEl.appendChild(btn)
        })

        function doParse() {
          var expr = exprEl.value.trim()
          descEl.textContent = describe(expr)
          var pp = expr.split(/\s+/)
          var labels = ['分', '时', '日', '月', '周']
          partsEl.innerHTML = pp.slice(0, 5).map(function (p, i) {
            return '<div class="cv-part"><div class="val">' + p + '</div><div class="lbl">' + labels[i] + '</div></div>'
          }).join('')
          var triggers = getNextTriggers(expr, 12)
          triggersEl.innerHTML = triggers.length === 0
            ? '<div style="color:#555;font-size:0.85em;">无法解析或无触发时间</div>'
            : triggers.map(function (t) {
              return '<div class="cv-trigger"><span class="d">' +
                (t.getMonth() + 1).toString().padStart(2, '0') + '-' +
                t.getDate().toString().padStart(2, '0') + ' ' +
                t.toLocaleDateString('zh-CN', { weekday: 'short' }) +
                '</span>' + t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) + '</div>'
            }).join('')
        }

        container.querySelector('[data-role="parse-btn"]').addEventListener('click', doParse)
        exprEl.addEventListener('input', doParse)

        // 交互式构建器
        var builderEl = container.querySelector('[data-role="builder"]')
        builderEl.innerHTML =
          '<div class="cv-b-row"><label>分钟</label><select data-role="b-min"><option value="*">每分钟</option><option value="*/5" selected>每5分钟</option><option value="*/10">每10分钟</option><option value="*/15">每15分钟</option><option value="*/30">每30分钟</option><option value="0">整点</option><option value="15">15分</option><option value="30">30分</option><option value="45">45分</option></select></div>' +
          '<div class="cv-b-row"><label>小时</label><select data-role="b-hour"><option value="*" selected>每小时</option><option value="*/2">每2小时</option><option value="*/3">每3小时</option><option value="*/6">每6小时</option><option value="*/12">每12小时</option><option value="0">0点</option><option value="8">8点</option><option value="9">9点</option><option value="12">12点</option><option value="18">18点</option></select></div>' +
          '<div class="cv-b-row"><label>日期</label><select data-role="b-dom"><option value="*" selected>每天</option><option value="1">1号</option><option value="15">15号</option><option value="*/2">每2天</option><option value="*/7">每周</option><option value="1,15">1号和15号</option></select></div>' +
          '<div class="cv-b-row"><label>月份</label><select data-role="b-month"><option value="*" selected>每月</option><option value="1,7">1月和7月</option><option value="*/3">每季度</option></select></div>' +
          '<div class="cv-b-row"><label>星期</label><select data-role="b-dow"><option value="*" selected>每天</option><option value="1-5">工作日</option><option value="0,6">周末</option><option value="1">周一</option><option value="5">周五</option></select></div>' +
          '<div class="cv-b-result" data-role="b-result">*/5 * * * *</div>'

        var selects = builderEl.querySelectorAll('select')
        for (var s = 0; s < selects.length; s++) {
          selects[s].addEventListener('change', function () {
            var bMin = builderEl.querySelector('[data-role="b-min"]').value
            var bHour = builderEl.querySelector('[data-role="b-hour"]').value
            var bDom = builderEl.querySelector('[data-role="b-dom"]').value
            var bMonth = builderEl.querySelector('[data-role="b-month"]').value
            var bDow = builderEl.querySelector('[data-role="b-dow"]').value
            var expr = bMin + ' ' + bHour + ' ' + bDom + ' ' + bMonth + ' ' + bDow
            builderEl.querySelector('[data-role="b-result"]').textContent = expr
            exprEl.value = expr
            doParse()
          })
        }

        // 初始解析
        doParse()
      },
    })
  }

  console.log('[插件] Cron 可视化器已加载')
})()
