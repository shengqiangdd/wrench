/**
 * 文本统计分析插件
 * 
 * 字符数、单词数、行数、中文字数、阅读时间、字频统计、文本清理
 */
(function() {
  const TextStats = {
    id: 'text-stats',
    name: '文本统计分析',

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('textstats-panel', {
          title: '文本统计分析',
          icon: 'bar-chart',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    analyze(text) {
      if (!text) return null;
      const chars = text.length;
      const charsNoSpace = text.replace(/\s/g, '').length;
      const lines = text.split('\n').length;
      const emptyLines = text.split('\n').filter(l => l.trim() === '').length;
      // 中文字数
      const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
      // 英文单词
      const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
      const totalWords = englishWords + chineseChars;
      // 阅读时间（中文约 400 字/分钟，英文约 200 词/分钟）
      const readMinutes = Math.max(1, Math.ceil((chineseChars / 400) + (englishWords / 200)));
      // 数字个数
      const numbers = (text.match(/\d+/g) || []).length;
      // 句子数
      const sentences = (text.split(/[。！？.!?]+/).filter(s => s.trim()).length);
      // 段落数
      const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length;
      // 字符编码字节数（UTF-8）
      const bytes = new TextEncoder().encode(text).byteLength;

      return {
        chars, charsNoSpace, lines, emptyLines,
        chineseChars, englishWords, totalWords, numbers,
        sentences, paragraphs, readMinutes, bytes
      };
    },

    charFrequency(text) {
      const freq = {};
      for (const ch of text) {
        if (/\s/.test(ch)) continue;
        freq[ch] = (freq[ch] || 0) + 1;
      }
      return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30);
    },

    cleanText(text, opts = {}) {
      let result = text;
      if (opts.trimLines !== false) {
        result = result.split('\n').map(l => l.trim()).join('\n');
      }
      if (opts.removeEmptyLines) {
        result = result.split('\n').filter(l => l.trim()).join('\n');
      }
      if (opts.collapseSpaces) {
        result = result.replace(/[ \t]+/g, ' ');
      }
      if (opts.removeControlChars) {
        result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
      }
      if (opts.normalizeLineEndings) {
        result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      }
      if (opts.removeTrailingWhitespace) {
        result = result.replace(/[ \t]+$/gm, '');
      }
      return result;
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-text-stats">
          <div class="ts-input">
            <textarea id="ts-text" placeholder="粘贴或输入文本进行分析..."></textarea>
          </div>
          <div class="ts-results" id="ts-results">
            <div class="ts-placeholder">输入文本后自动分析</div>
          </div>
          <div class="ts-sections" id="ts-sections" style="display:none">
            <div class="ts-section">
              <h4>📊 字频统计 (Top 15)</h4>
              <div id="ts-freq"></div>
            </div>
            <div class="ts-section">
              <h4>🧹 文本清理</h4>
              <div class="ts-clean-opts">
                <label><input type="checkbox" id="ts-cl-trim" checked /> 行首尾去空格</label>
                <label><input type="checkbox" id="ts-cl-empty" /> 删除空行</label>
                <label><input type="checkbox" id="ts-cl-space" /> 合并连续空格</label>
                <label><input type="checkbox" id="ts-cl-ctrl" /> 删除控制字符</label>
                <label><input type="checkbox" id="ts-cl-eol" checked /> 统一换行符</label>
                <button class="ts-btn" id="ts-clean-btn">🧹 清理文本</button>
              </div>
              <textarea id="ts-clean-output" readonly placeholder="清理结果..."></textarea>
            </div>
          </div>
          <style>
            .plugin-text-stats { padding: 16px; }
            .ts-input textarea {
              width: 100%; min-height: 120px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 8px; padding: 10px; color: #c8ccd0; font-family: monospace; font-size: 0.85em; resize: vertical;
            }
            .ts-input textarea:focus { border-color: #4a9eff; outline: none; }
            .ts-results {
              margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px;
            }
            .ts-stat {
              background: #1a1d23; border-radius: 8px; padding: 10px; text-align: center;
            }
            .ts-stat-val { font-size: 1.4em; font-weight: 700; color: #4a9eff; font-family: monospace; }
            .ts-stat-label { font-size: 0.75em; color: #888; margin-top: 2px; }
            .ts-placeholder { color: #555; text-align: center; padding: 20px; grid-column: 1 / -1; }
            .ts-sections { margin-top: 16px; }
            .ts-section { margin-bottom: 16px; }
            .ts-section h4 { margin: 0 0 8px; font-size: 0.95em; color: #e0e0e0; }
            #ts-freq { display: flex; flex-wrap: wrap; gap: 4px; }
            .ts-freq-item {
              display: inline-flex; align-items: center; gap: 4px;
              background: #1a1d23; border-radius: 4px; padding: 3px 8px; font-size: 0.8em;
            }
            .ts-freq-ch { color: #4a9eff; font-family: monospace; font-weight: 600; }
            .ts-freq-cnt { color: #888; }
            .ts-clean-opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; color: #aaa; font-size: 0.85em; }
            .ts-btn {
              padding: 4px 12px; background: #4a9eff22; border: 1px solid #4a9eff44;
              color: #4a9eff; border-radius: 4px; cursor: pointer; font-size: 0.85em;
            }
            #ts-clean-output {
              width: 100%; min-height: 80px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; padding: 8px; color: #c8ccd0; font-family: monospace; font-size: 0.85em; resize: vertical;
            }
          </style>
        </div>
      `;

      const textEl = document.getElementById('ts-text');
      const timer = { id: null };
      textEl.addEventListener('input', () => {
        clearTimeout(timer.id);
        timer.id = setTimeout(() => this.update(), 200);
      });

      document.getElementById('ts-clean-btn').addEventListener('click', () => {
        const text = document.getElementById('ts-text').value;
        const opts = {
          trimLines: document.getElementById('ts-cl-trim').checked,
          removeEmptyLines: document.getElementById('ts-cl-empty').checked,
          collapseSpaces: document.getElementById('ts-cl-space').checked,
          removeControlChars: document.getElementById('ts-cl-ctrl').checked,
          normalizeLineEndings: document.getElementById('ts-cl-eol').checked,
        };
        document.getElementById('ts-clean-output').value = this.cleanText(text, opts);
      });
    },

    update() {
      const text = document.getElementById('ts-text').value;
      const results = document.getElementById('ts-results');
      const sections = document.getElementById('ts-sections');
      const freqEl = document.getElementById('ts-freq');

      if (!text.trim()) {
        results.innerHTML = '<div class="ts-placeholder">输入文本后自动分析</div>';
        sections.style.display = 'none';
        return;
      }

      const s = this.analyze(text);
      results.innerHTML = [
        ['字符数', s.chars],
        ['去空格', s.charsNoSpace],
        ['中文字', s.chineseChars],
        ['英文词', s.englishWords],
        ['总词数', s.totalWords],
        ['行数', s.lines],
        ['空行', s.emptyLines],
        ['段落', s.paragraphs],
        ['句子', s.sentences],
        ['数字', s.numbers],
        ['阅读时间', s.readMinutes + ' min'],
        ['字节', s.bytes + ' B'],
      ].map(([label, val]) => `
        <div class="ts-stat"><div class="ts-stat-val">${val}</div><div class="ts-stat-label">${label}</div></div>
      `).join('');

      // 字频
      const freq = this.charFrequency(text);
      freqEl.innerHTML = freq.map(([ch, cnt]) => {
        const display = ch === '\n' ? '↵' : ch === '\t' ? 'Tab' : ch === ' ' ? '␣' : ch;
        return `<div class="ts-freq-item"><span class="ts-freq-ch">${display}</span><span class="ts-freq-cnt">×${cnt}</span></div>`;
      }).join('');

      sections.style.display = 'block';
    }
  };

  if (typeof window !== 'undefined') window.TextStats = TextStats;
})();
