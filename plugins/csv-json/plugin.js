/**
 * CSV/JSON 互转插件
 * 
 * CSV ↔ JSON 双向转换，支持自定义分隔符、引号处理、自动检测
 */
(function() {
  const CsvJson = {
    id: 'csv-json',
    name: 'CSV/JSON 互转',

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('csvjson-panel', {
          title: 'CSV/JSON 互转',
          icon: 'repeat',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    // CSV → JSON
    csvToJson(csv, delimiter = ',', hasHeader = true) {
      const lines = csv.trim().split('\n').map(l => l.replace(/\r$/, ''));
      if (lines.length === 0) return [];

      const parseRow = (line) => {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQuotes) {
            if (ch === '"') {
              if (i + 1 < line.length && line[i + 1] === '"') {
                current += '"';
                i++;
              } else {
                inQuotes = false;
              }
            } else {
              current += ch;
            }
          } else {
            if (ch === '"') {
              inQuotes = true;
            } else if (ch === delimiter) {
              result.push(current.trim());
              current = '';
            } else {
              current += ch;
            }
          }
        }
        result.push(current.trim());
        return result;
      };

      if (hasHeader && lines.length > 0) {
        const headers = parseRow(lines[0]);
        return lines.slice(1).filter(l => l.trim()).map(line => {
          const values = parseRow(line);
          const obj = {};
          headers.forEach((h, i) => { obj[h] = values[i] || ''; });
          return obj;
        });
      } else {
        return lines.filter(l => l.trim()).map(line => parseRow(line));
      }
    },

    // JSON → CSV
    jsonToCsv(data, delimiter = ',') {
      if (!Array.isArray(data) || data.length === 0) return '';
      const headers = [...new Set(data.flatMap(obj => typeof obj === 'object' ? Object.keys(obj) : []))];
      const rows = [headers.join(delimiter)];
      data.forEach(obj => {
        if (typeof obj !== 'object' || obj === null) return;
        const row = headers.map(h => {
          const val = String(obj[h] ?? '');
          if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
            return '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        });
        rows.push(row.join(delimiter));
      });
      return rows.join('\n');
    },

    // 自动检测分隔符
    detectDelimiter(csv) {
      const firstLine = csv.split('\n')[0];
      const candidates = [',', '\t', ';', '|'];
      let best = ',';
      let bestCount = 0;
      candidates.forEach(d => {
        const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d === '\t' ? '\t' : d, 'g')) || []).length;
        if (count > bestCount) { best = d; bestCount = count; }
      });
      return best;
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-csvjson">
          <div class="cj-controls">
            <div class="cj-tabs">
              <button class="cj-tab active" data-tab="csv2json">CSV → JSON</button>
              <button class="cj-tab" data-tab="json2csv">JSON → CSV</button>
            </div>
            <div class="cj-opts">
              <label>分隔符:</label>
              <select id="cj-delim">
                <option value="auto">自动检测</option>
                <option value=",">, (逗号)</option>
                <option value="\t">Tab</option>
                <option value=";">; (分号)</option>
                <option value="|">| (管道)</option>
              </select>
              <label><input type="checkbox" id="cj-header" checked /> 首行为标题</label>
              <label><input type="checkbox" id="cj-pretty" checked /> 格式化输出</label>
              <button class="cj-swap" id="cj-swap">⇅ 交换</button>
            </div>
          </div>
          <div class="cj-panels">
            <div class="cj-panel">
              <label>输入</label>
              <textarea id="cj-input" placeholder="粘贴 CSV 或 JSON 数据..."></textarea>
            </div>
            <div class="cj-arrow">→</div>
            <div class="cj-panel">
              <label>输出 <button class="cj-copy" id="cj-copy">📋 复制</button></label>
              <textarea id="cj-output" readonly placeholder="转换结果将显示在这里..."></textarea>
            </div>
          </div>
          <style>
            .plugin-csvjson { padding: 16px; }
            .cj-controls { margin-bottom: 12px; }
            .cj-tabs { display: flex; gap: 4px; margin-bottom: 10px; }
            .cj-tab {
              padding: 6px 16px; border: 1px solid #3a3f47; background: #1a1d23;
              color: #888; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 0.9em;
            }
            .cj-tab.active { background: #2a2e35; color: #4a9eff; border-color: #4a9eff; }
            .cj-opts { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; color: #aaa; font-size: 0.85em; }
            .cj-opts select { padding: 4px 8px; background: #1a1d23; border: 1px solid #3a3f47; color: #e0e0e0; border-radius: 4px; }
            .cj-swap { padding: 4px 12px; background: #4a9eff22; border: 1px solid #4a9eff44; color: #4a9eff; border-radius: 4px; cursor: pointer; }
            .cj-panels { display: flex; gap: 12px; }
            .cj-panel { flex: 1; display: flex; flex-direction: column; }
            .cj-panel label { display: flex; justify-content: space-between; align-items: center; color: #888; font-size: 0.85em; margin-bottom: 4px; }
            .cj-panel textarea {
              flex: 1; min-height: 280px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; padding: 10px; color: #c8ccd0; font-family: 'Cascadia Code', monospace;
              font-size: 0.85em; resize: vertical;
            }
            .cj-panel textarea:focus { border-color: #4a9eff; outline: none; }
            .cj-panel textarea[readonly] { opacity: 0.9; }
            .cj-arrow { display: flex; align-items: center; color: #4a9eff; font-size: 1.5em; padding-top: 20px; }
            .cj-copy { padding: 2px 8px; background: #3a3f47; border: none; color: #aaa; border-radius: 3px; cursor: pointer; font-size: 0.85em; }
            .cj-copy:hover { background: #4a9eff33; color: #4a9eff; }
          </style>
        </div>
      `;

      // Tab 切换
      container.querySelectorAll('.cj-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.cj-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.convert();
        });
      });

      // 输入事件
      const input = document.getElementById('cj-input');
      input.addEventListener('input', () => this.convert());
      document.getElementById('cj-delim').addEventListener('change', () => this.convert());
      document.getElementById('cj-header').addEventListener('change', () => this.convert());
      document.getElementById('cj-pretty').addEventListener('change', () => this.convert());

      // 复制
      document.getElementById('cj-copy').addEventListener('click', () => {
        const out = document.getElementById('cj-output');
        navigator.clipboard.writeText(out.value);
        const btn = document.getElementById('cj-copy');
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 1500);
      });

      // 交换
      document.getElementById('cj-swap').addEventListener('click', () => {
        const inp = document.getElementById('cj-input');
        const out = document.getElementById('cj-output');
        inp.value = out.value;
        const activeTab = container.querySelector('.cj-tab.active');
        if (activeTab.dataset.tab === 'csv2json') {
          container.querySelector('.cj-tab[data-tab="json2csv"]').click();
        } else {
          container.querySelector('.cj-tab[data-tab="csv2json"]').click();
        }
      });
    },

    convert() {
      const input = document.getElementById('cj-input').value;
      const output = document.getElementById('cj-output');
      const activeTab = document.querySelector('.cj-tab.active');
      if (!activeTab) return;
      const mode = activeTab.dataset.tab;
      const pretty = document.getElementById('cj-pretty').checked;

      if (!input.trim()) { output.value = ''; return; }

      try {
        if (mode === 'csv2json') {
          let delim = document.getElementById('cj-delim').value;
          if (delim === 'auto') delim = this.detectDelimiter(input);
          else if (delim === '\\t') delim = '\t';
          const hasHeader = document.getElementById('cj-header').checked;
          const data = this.csvToJson(input, delim, hasHeader);
          output.value = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        } else {
          const data = JSON.parse(input);
          const delim = document.getElementById('cj-delim').value === '\\t' ? '\t'
            : document.getElementById('cj-delim').value === 'auto' ? ',' : document.getElementById('cj-delim').value;
          output.value = this.jsonToCsv(Array.isArray(data) ? data : [data], delim);
        }
      } catch (e) {
        output.value = `❌ 转换错误: ${e.message}`;
      }
    }
  };

  if (typeof window !== 'undefined') window.CsvJson = CsvJson;
})();
