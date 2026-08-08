/**
 * HTML 实体编解码插件
 * 
 * HTML ↔ 文本双向转换，支持命名实体、数字实体、中文 Unicode 转义
 */
(function() {
  const HtmlEntity = {
    id: 'html-entity',
    name: 'HTML 实体编解码',

    // 常用 HTML 命名实体映射
    namedEntities: {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      ' ': '&nbsp;', '\n': '<br>', '\t': '&nbsp;&nbsp;&nbsp;&nbsp;',
      '©': '&copy;', '®': '&reg;', '™': '&trade;', '€': '&euro;',
      '£': '&pound;', '¥': '&yen;', '§': '&sect;', '°': '&deg;',
      '±': '&plusminus;', '×': '&times;', '÷': '&divide;',
      '©': '&copy;', '→': '&rarr;', '←': '&larr;', '↑': '&uarr;', '↓': '&darr;',
      '—': '&mdash;', '–': '&ndash;', '…': '&hellip;', '·': '&middot;',
      '½': '&frac12;', '¼': '&frac14;', '¾': '&frac34;',
    },

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('htmlentity-panel', {
          title: 'HTML 实体编解码',
          icon: 'code',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    // 文本 → HTML 实体（编码）
    encode(text, mode = 'named') {
      if (mode === 'named') {
        let result = '';
        for (const ch of text) {
          if (this.namedEntities[ch]) {
            result += this.namedEntities[ch];
          } else if (ch.charCodeAt(0) > 127) {
            result += '&#' + ch.charCodeAt(0) + ';';
          } else {
            result += ch;
          }
        }
        return result;
      } else if (mode === 'numeric') {
        return text.split('').map(ch => '&#' + ch.charCodeAt(0) + ';').join('');
      } else if (mode === 'hex') {
        return text.split('').map(ch => '&#x' + ch.charCodeAt(0).toString(16).toUpperCase() + ';').join('');
      }
    },

    // HTML 实体 → 文本（解码）
    decode(html) {
      return html
        .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&copy;/g, '©')
        .replace(/&reg;/g, '®')
        .replace(/&trade;/g, '™')
        .replace(/&euro;/g, '€')
        .replace(/&pound;/g, '£')
        .replace(/&yen;/g, '¥')
        .replace(/&sect;/g, '§')
        .replace(/&deg;/g, '°')
        .replace(/&plusminus;/g, '±')
        .replace(/&times;/g, '×')
        .replace(/&divide;/g, '÷')
        .replace(/&rarr;/g, '→')
        .replace(/&larr;/g, '←')
        .replace(/&uarr;/g, '↑')
        .replace(/&darr;/g, '↓')
        .replace(/&mdash;/g, '—')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&middot;/g, '·')
        .replace(/&frac12;/g, '½')
        .replace(/&frac14;/g, '¼')
        .replace(/&frac34;/g, '¾');
    },

    // 生成常用实体参考表
    getEntityRef() {
      return Object.entries(this.namedEntities)
        .filter(([k, v]) => k !== '\n' && k !== '\t')
        .map(([k, v]) => `${v}\t→\t${k}`)
        .join('\n');
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-html-entity">
          <h3>🔤 HTML 实体编解码</h3>
          <div class="he-mode">
            <button class="he-mode-btn active" data-mode="encode">编码 (文本→实体)</button>
            <button class="he-mode-btn" data-mode="decode">解码 (实体→文本)</button>
          </div>
          <div class="he-encode-opts" id="he-encode-opts">
            <label>编码模式:</label>
            <label><input type="radio" name="he-mode" value="named" checked /> 命名实体</label>
            <label><input type="radio" name="he-mode" value="numeric" /> 数字实体</label>
            <label><input type="radio" name="he-mode" value="hex" /> 十六进制</label>
          </div>
          <div class="he-panels">
            <div class="he-panel">
              <label>输入</label>
              <textarea id="he-input" placeholder="输入文本或 HTML 实体..."></textarea>
            </div>
            <div class="he-arrow">
              <button class="he-convert" id="he-convert">转换 →</button>
            </div>
            <div class="he-panel">
              <label>输出 <button class="he-copy" id="he-copy">📋 复制</button></label>
              <textarea id="he-output" readonly placeholder="结果..."></textarea>
            </div>
          </div>
          <details class="he-ref">
            <summary>📖 常用 HTML 实体参考</summary>
            <pre class="he-ref-table" id="he-ref"></pre>
          </details>
          <style>
            .plugin-html-entity { padding: 16px; }
            .plugin-html-entity h3 { margin: 0 0 12px; font-size: 1.1em; }
            .he-mode { display: flex; gap: 4px; margin-bottom: 12px; }
            .he-mode-btn {
              padding: 6px 16px; border: 1px solid #3a3f47; background: #1a1d23;
              color: #888; border-radius: 6px; cursor: pointer; font-size: 0.9em;
            }
            .he-mode-btn.active { background: #4a9eff22; color: #4a9eff; border-color: #4a9eff; }
            .he-encode-opts { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; color: #aaa; font-size: 0.85em; }
            .he-panels { display: flex; gap: 12px; }
            .he-panel { flex: 1; display: flex; flex-direction: column; }
            .he-panel label { display: flex; justify-content: space-between; align-items: center; color: #888; font-size: 0.85em; margin-bottom: 4px; }
            .he-panel textarea {
              flex: 1; min-height: 200px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; padding: 10px; color: #c8ccd0; font-family: monospace; font-size: 0.85em; resize: vertical;
            }
            .he-panel textarea:focus { border-color: #4a9eff; outline: none; }
            .he-arrow { display: flex; align-items: center; padding-top: 20px; }
            .he-convert {
              padding: 8px 16px; background: #4a9eff22; border: 1px solid #4a9eff;
              color: #4a9eff; border-radius: 6px; cursor: pointer; font-size: 0.9em; white-space: nowrap;
            }
            .he-copy { padding: 2px 8px; background: #3a3f47; border: none; color: #aaa; border-radius: 3px; cursor: pointer; font-size: 0.85em; }
            .he-ref { margin-top: 16px; color: #888; font-size: 0.85em; }
            .he-ref summary { cursor: pointer; padding: 8px 0; }
            .he-ref-table { background: #1a1d23; border-radius: 6px; padding: 10px; font-size: 0.8em; max-height: 200px; overflow-y: auto; white-space: pre; font-family: monospace; }
          </style>
        </div>
      `;

      // Tab 切换
      container.querySelectorAll('.he-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.he-mode-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.getElementById('he-encode-opts').style.display = btn.dataset.mode === 'encode' ? 'flex' : 'none';
        });
      });

      // 转换
      document.getElementById('he-convert').addEventListener('click', () => {
        const input = document.getElementById('he-input').value;
        const output = document.getElementById('he-output');
        const mode = container.querySelector('.he-mode-btn.active').dataset.mode;
        if (mode === 'encode') {
          const encMode = document.querySelector('input[name="he-mode"]:checked').value;
          output.value = this.encode(input, encMode);
        } else {
          output.value = this.decode(input);
        }
      });

      // 复制
      document.getElementById('he-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('he-output').value);
        const btn = document.getElementById('he-copy');
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 1500);
      });

      // 参考表
      document.getElementById('he-ref').textContent = this.getEntityRef();
    }
  };

  if (typeof window !== 'undefined') window.HtmlEntity = HtmlEntity;
})();
