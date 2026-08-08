/**
 * 进制转换器插件
 * 
 * 支持二进制、八进制、十进制、十六进制转换，位视图，位运算
 */
(function() {
  const BaseConverter = {
    id: 'base-converter',
    name: '进制转换器',

    init() {
      this.registerCommands();
      this.registerPanels();
    },

    registerCommands() {
      if (typeof Wrench !== 'undefined') {
        var self = this
        var api = Wrench.getPluginAPI()
        api.registerCommand('base-convert', {
          label: '进制转换',
          execute: function () {
            var content = api.getEditorContent()
            if (!content) { api.showNotification('请先在编辑器中输入数字', 'warning'); return }
            var raw = content.trim().split('\n')[0]
            var num = parseInt(raw, 10)
            if (isNaN(num)) { api.showNotification('请输入有效数字', 'error'); return }
            var output = [
              '━━━ 进制转换: ' + raw + ' ━━━',
              '',
              '二进制 (BIN):  ' + num.toString(2),
              '八进制 (OCT):  ' + num.toString(8),
              '十进制 (DEC):  ' + num.toString(10),
              '十六进制 (HEX): ' + num.toString(16).toUpperCase(),
              '',
              '二进制 (补零): ' + num.toString(2).padStart(8, '0'),
            ].join('\n')
            api.setEditorContent(output)
            api.showNotification('进制转换完成', 'success')
          },
        })
        api.registerCommand('bit-view', {
          label: '位视图',
          execute: function () {
            var content = api.getEditorContent()
            if (!content) { api.showNotification('请先在编辑器中输入数字', 'warning'); return }
            var num = parseInt(content.trim().split('\n')[0], 10)
            if (isNaN(num)) { api.showNotification('请输入有效数字', 'error'); return }
            var bits = num.toString(2).padStart(16, '0')
            var output = '━━━ 位视图: ' + num + ' ━━━\n\n'
            for (var i = 0; i < bits.length; i++) {
              output += (i % 4 === 0 && i > 0 ? ' ' : '') + bits[i]
            }
            output += '\n\n值: ' + num + '  |  二进制长度: ' + num.toString(2).length + ' 位'
            api.setEditorContent(output)
            api.showNotification('位视图已生成', 'success')
          },
        })
        api.registerCommand('bit-ops', {
          label: '位运算',
          execute: function () {
            api.showNotification('请在右侧面板使用位运算工具', 'info')
          },
        })
      }
    },

    registerPanels() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('base-panel', {
          title: '进制转换器',
          icon: 'binary',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    convert(value, fromBase, toBase) {
      const num = parseInt(value, fromBase);
      if (isNaN(num)) return null;
      return num.toString(toBase).toUpperCase();
    },

    toBin(val) {
      const n = parseInt(val, 10);
      if (isNaN(n)) return '';
      return n.toString(2).padStart(8, '0');
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-base-converter">
          <div class="bc-section">
            <h3>⚡ 进制转换</h3>
            <div class="bc-input-group">
              <input type="text" id="bc-input" placeholder="输入数字（如 255）" class="bc-input" />
              <select id="bc-from" class="bc-select">
                <option value="10" selected>十进制</option>
                <option value="2">二进制</option>
                <option value="8">八进制</option>
                <option value="16">十六进制</option>
              </select>
            </div>
            <div class="bc-results" id="bc-results">
              <div class="bc-row"><span class="bc-label">二进制 (BIN)</span><span class="bc-val" id="bc-bin">—</span></div>
              <div class="bc-row"><span class="bc-label">八进制 (OCT)</span><span class="bc-val" id="bc-oct">—</span></div>
              <div class="bc-row"><span class="bc-label">十进制 (DEC)</span><span class="bc-val" id="bc-dec">—</span></div>
              <div class="bc-row"><span class="bc-label">十六进制 (HEX)</span><span class="bc-val" id="bc-hex">—</span></div>
            </div>
          </div>

          <div class="bc-section">
            <h3>📊 位视图</h3>
            <div class="bc-bitgrid" id="bc-bitgrid"></div>
            <div class="bc-info" id="bc-info">输入数字查看二进制位分布</div>
          </div>

          <div class="bc-section">
            <h3>🔧 位运算</h3>
            <div class="bc-ops-row">
              <input type="text" id="bc-op-a" placeholder="A (如 60)" class="bc-input" />
              <select id="bc-op-type" class="bc-select">
                <option value="AND">AND (与)</option>
                <option value="OR">OR (或)</option>
                <option value="XOR">XOR (异或)</option>
                <option value="NOT">NOT (非)</option>
                <option value="LSHIFT">左移 <<</option>
                <option value="RSHIFT">右移 >></option>
              </select>
              <input type="text" id="bc-op-b" placeholder="B (如 13)" class="bc-input" />
            </div>
            <div class="bc-ops-result" id="bc-ops-result"></div>
          </div>

          <style>
            .plugin-base-converter { padding: 16px; }
            .bc-section { margin-bottom: 20px; }
            .bc-section h3 { margin: 0 0 10px; font-size: 1.1em; color: #e0e0e0; }
            .bc-input-group { display: flex; gap: 8px; margin-bottom: 12px; }
            .bc-input {
              flex: 1; padding: 8px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; color: #e0e0e0; font-family: 'Cascadia Code', monospace; font-size: 1.1em;
            }
            .bc-select {
              padding: 8px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; color: #e0e0e0; min-width: 100px;
            }
            .bc-results { display: flex; flex-direction: column; gap: 6px; }
            .bc-row {
              display: flex; justify-content: space-between; align-items: center;
              padding: 6px 10px; background: #1a1d23; border-radius: 4px;
            }
            .bc-label { color: #888; font-size: 0.85em; }
            .bc-val { font-family: 'Cascadia Code', monospace; color: #4a9eff; font-size: 0.95em; font-weight: 600; word-break: break-all; }
            .bc-bitgrid {
              display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px;
              margin-bottom: 8px;
            }
            .bc-bit {
              text-align: center; padding: 6px 2px; background: #1a1d23;
              border-radius: 4px; font-family: monospace; font-size: 0.9em;
              transition: all 0.2s;
            }
            .bc-bit.on { background: #4a9eff22; color: #4a9eff; border: 1px solid #4a9eff44; }
            .bc-bit.off { color: #555; border: 1px solid #333; }
            .bc-bit-label { font-size: 0.7em; color: #666; display: block; margin-top: 2px; }
            .bc-info { color: #888; font-size: 0.85em; text-align: center; }
            .bc-ops-row { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
            .bc-ops-row .bc-input { flex: 1; font-size: 0.95em; }
            .bc-ops-result {
              background: #1a1d23; border-radius: 8px; padding: 12px;
              font-family: monospace; font-size: 0.9em; color: #c8ccd0;
              white-space: pre-wrap; line-height: 1.6;
            }
          </style>
        </div>
      `;

      // 绑定事件
      const input = document.getElementById('bc-input');
      const fromSelect = document.getElementById('bc-from');
      const convert = () => this.doConvert();
      input.addEventListener('input', convert);
      fromSelect.addEventListener('change', convert);

      document.getElementById('bc-op-a').addEventListener('input', () => this.doBitOps());
      document.getElementById('bc-op-b').addEventListener('input', () => this.doBitOps());
      document.getElementById('bc-op-type').addEventListener('change', () => this.doBitOps());
    },

    doConvert() {
      const raw = document.getElementById('bc-input').value.trim();
      if (!raw) {
        ['bc-bin','bc-oct','bc-dec','bc-hex'].forEach(id => document.getElementById(id).textContent = '—');
        document.getElementById('bc-bitgrid').innerHTML = '';
        document.getElementById('bc-info').textContent = '输入数字查看二进制位分布';
        return;
      }
      const base = parseInt(document.getElementById('bc-from').value);
      const num = parseInt(raw, base);
      if (isNaN(num)) {
        ['bc-bin','bc-oct','bc-dec','bc-hex'].forEach(id => document.getElementById(id).textContent = '无效');
        return;
      }
      document.getElementById('bc-bin').textContent = num.toString(2);
      document.getElementById('bc-oct').textContent = num.toString(8);
      document.getElementById('bc-dec').textContent = num.toString(10);
      document.getElementById('bc-hex').textContent = num.toString(16).toUpperCase();

      // 位视图
      const bits = num.toString(2).padStart(32, '0').split('');
      const grid = document.getElementById('bc-bitgrid');
      grid.innerHTML = bits.map((b, i) => {
        const pos = 31 - i;
        const isOn = b === '1';
        return `<div class="bc-bit ${isOn ? 'on' : 'off'}">
          ${b}<span class="bc-bit-label">2<sup>${pos}</sup></span>
        </div>`;
      }).join('');
      document.getElementById('bc-info').textContent = `值: ${num}  |  二进制长度: ${num.toString(2).length} 位`;
    },

    doBitOps() {
      const aRaw = document.getElementById('bc-op-a').value.trim();
      const bRaw = document.getElementById('bc-op-b').value.trim();
      const type = document.getElementById('bc-op-type').value;
      const result = document.getElementById('bc-ops-result');

      if (!aRaw || (type !== 'NOT' && !bRaw)) {
        result.innerHTML = '<span style="color:#555">输入 A 和 B 执行运算</span>';
        return;
      }

      const a = parseInt(aRaw, 10);
      const b = type !== 'NOT' ? parseInt(bRaw, 10) : 0;
      if (isNaN(a) || (type !== 'NOT' && isNaN(b))) {
        result.innerHTML = '<span style="color:#f44">请输入有效数字</span>';
        return;
      }

      let res, expr;
      switch (type) {
        case 'AND': res = a & b; expr = `${a} AND ${b} = ${res}`; break;
        case 'OR':  res = a | b; expr = `${a} OR ${b} = ${res}`; break;
        case 'XOR': res = a ^ b; expr = `${a} XOR ${b} = ${res}`; break;
        case 'NOT': res = ~a >>> 0; expr = `NOT ${a} = ${res}`; break;
        case 'LSHIFT': res = a << b; expr = `${a} << ${b} = ${res}`; break;
        case 'RSHIFT': res = a >> b; expr = `${a} >> ${b} = ${res}`; break;
      }

      result.innerHTML = `${expr}\n\n` +
        `A: ${a.toString(2).padStart(8, '0')} (${a})\n` +
        (type !== 'NOT' ? `B: ${b.toString(2).padStart(8, '0')} (${b})\n` : '') +
        `-`.repeat(32) + `\n` +
        `R: ${(res >>> 0).toString(2).padStart(8, '0')} (${res})`;
    }
  };

  if (typeof window !== 'undefined') {
    window.BaseConverter = BaseConverter;
  }
})();
