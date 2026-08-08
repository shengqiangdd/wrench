/**
 * 终端转义序列生成器插件
 * 生成 ANSI 终端颜色、样式、光标控制转义码
 */
(function(){
  const TerminalEscape={
    id:'terminal-escape', name:'终端转义序列生成器',
    fg:37, bg:40, bold:false, dim:false, italic:false, underline:false, strikethrough:false, reverse:false,
    colors:[
      {name:'黑色',fg:30,bg:40},{name:'红色',fg:31,bg:41},{name:'绿色',fg:32,bg:42},
      {name:'黄色',fg:33,bg:43},{name:'蓝色',fg:34,bg:44},{name:'品红',fg:35,bg:45},
      {name:'青色',fg:36,bg:46},{name:'白色',fg:37,bg:47}
    ],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('termescape-panel',{title:'终端转义序列生成器',icon:'terminal',render:c=>this.renderPanel(c)});
      }
    },
    buildEscape(){
      const codes=[];
      if(this.bold) codes.push('1');
      if(this.dim) codes.push('2');
      if(this.italic) codes.push('3');
      if(this.underline) codes.push('4');
      if(this.strikethrough) codes.push('9');
      if(this.reverse) codes.push('7');
      codes.push(String(this.fg));
      codes.push(String(this.bg));
      return `\x1b[${codes.join(';')}m`;
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-termesc">
          <h3>🖥️ 终端转义序列生成器</h3>
          <div class="te-preview" id="te-preview">
            <span id="te-sample">样本文本 Sample Text</span>
          </div>
          <div class="te-section">
            <h4>🎨 前景色</h4>
            <div class="te-colors" id="te-fg-colors">
              ${this.colors.map(c=>`<button class="te-color-btn ${this.fg===c.fg?'active':''}" data-fg="${c.fg}" data-name="${c.name}" style="background:${this.hexFromAnsi(c.fg)}" title="${c.name}"></button>`).join('')}
              <button class="te-color-btn te-color-reset" data-fg="37" title="重置">↺</button>
            </div>
          </div>
          <div class="te-section">
            <h4>🖼️ 背景色</h4>
            <div class="te-colors" id="te-bg-colors">
              ${this.colors.map(c=>`<button class="te-color-btn ${this.bg===c.bg?'active':''}" data-bg="${c.bg}" data-name="${c.name}" style="background:${this.hexFromAnsi(c.bg)}" title="${c.name}"></button>`).join('')}
              <button class="te-color-btn te-color-reset" data-bg="40" title="重置">↺</button>
            </div>
          </div>
          <div class="te-section">
            <h4>✨ 文字样式</h4>
            <div class="te-styles">
              <button class="te-style-btn ${this.bold?'active':''}" data-style="bold"><b>B</b> 粗体</button>
              <button class="te-style-btn ${this.dim?'active':''}" data-style="dim"><span style="opacity:0.5">D</span> 暗淡</button>
              <button class="te-style-btn ${this.italic?'active':''}" data-style="italic"><i>I</i> 斜体</button>
              <button class="te-style-btn ${this.underline?'active':''}" data-style="underline"><u>U</u> 下划线</button>
              <button class="te-style-btn ${this.strikethrough?'active':''}" data-style="strikethrough"><s>S</s> 删除线</button>
              <button class="te-style-btn ${this.reverse?'active':''}" data-style="reverse">🔄 反转</button>
            </div>
          </div>
          <div class="te-section">
            <h4>📝 自定义文本</h4>
            <input id="te-text" value="样本文本 Sample Text" placeholder="输入要着色的文本" style="width:100%;background:#1a1d23;border:1px solid #3a3f47;color:#c8ccd0;padding:6px 10px;border-radius:4px;font-family:monospace;">
          </div>
          <div class="te-output">
            <div class="te-output-row"><span class="te-label">转义序列:</span><code id="te-escape"></code><button class="te-copy" data-target="te-escape">📋</button></div>
            <div class="te-output-row"><span class="te-label">Shell 输出:</span><code id="te-shell"></code><button class="te-copy" data-target="te-shell">📋</button></div>
            <div class="te-output-row"><span class="te-label">JS 模板:</span><code id="te-js"></code><button class="te-copy" data-target="te-js">📋</button></div>
          </div>
          <div class="te-presets">
            <h4>⚡ 常用预设</h4>
            <div class="te-preset-row">
              <button class="te-preset" data-codes="1;31">❌ 错误 (红色粗体)</button>
              <button class="te-preset" data-codes="1;32">✅ 成功 (绿色粗体)</button>
              <button class="te-preset" data-codes="1;33">⚠️ 警告 (黄色粗体)</button>
              <button class="te-preset" data-codes="36">ℹ️ 信息 (青色)</button>
              <button class="te-preset" data-codes="90">📝 次要 (灰色)</button>
              <button class="te-preset" data-codes="1;35;40">💀 致命 (品红粗体黑底)</button>
            </div>
          </div>
          <style>
            .plugin-termesc{padding:16px;}
            .plugin-termesc h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-termesc h4{margin:12px 0 6px;font-size:0.9em;color:#888;}
            .te-preview{background:#1a1d23;border-radius:8px;padding:14px;margin-bottom:12px;font-family:monospace;font-size:1.1em;border:1px solid #3a3f47;min-height:40px;}
            .te-section{margin-bottom:8px;}
            .te-colors{display:flex;gap:4px;flex-wrap:wrap;}
            .te-color-btn{width:36px;height:32px;border-radius:6px;border:2px solid transparent;cursor:pointer;transition:all 0.15s;}
            .te-color-btn:hover{transform:scale(1.15);}
            .te-color-btn.active{border-color:#fff;box-shadow:0 0 8px rgba(255,255,255,0.3);}
            .te-color-reset{background:#3a3f47!important;color:#aaa;display:flex;align-items:center;justify-content:center;font-size:1.1em;}
            .te-styles{display:flex;gap:4px;flex-wrap:wrap;}
            .te-style-btn{padding:5px 10px;background:#1a1d23;border:1px solid #3a3f47;color:#aaa;border-radius:4px;cursor:pointer;font-size:0.82em;}
            .te-style-btn.active{border-color:#ff9800;color:#ff9800;background:#ff980022;}
            .te-output{margin-top:12px;background:#0d0f14;border-radius:8px;padding:10px;border:1px solid #2a2e35;}
            .te-output-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1a1d23;}
            .te-output-row:last-child{border-bottom:none;}
            .te-label{color:#888;font-size:0.8em;min-width:100px;}
            .te-output code{flex:1;color:#c8ccd0;font-family:monospace;font-size:0.8em;word-break:break-all;background:#1a1d23;padding:3px 6px;border-radius:3px;}
            .te-copy{background:none;border:none;color:#888;cursor:pointer;font-size:0.9em;}
            .te-copy:hover{color:#fff;}
            .te-presets{margin-top:12px;}
            .te-preset-row{display:flex;gap:4px;flex-wrap:wrap;}
            .te-preset{padding:4px 10px;background:#1a1d23;border:1px solid #3a3f47;color:#aaa;border-radius:4px;cursor:pointer;font-size:0.78em;}
            .te-preset:hover{border-color:#ff9800;color:#ff9800;}
          </style>
        </div>`;
      // 前景色
      container.querySelectorAll('#te-fg-colors .te-color-btn').forEach(b=>b.addEventListener('click',()=>{
        this.fg=+b.dataset.fg;this.renderPanel(container);
      }));
      // 背景色
      container.querySelectorAll('#te-bg-colors .te-color-btn').forEach(b=>b.addEventListener('click',()=>{
        this.bg=+b.dataset.bg;this.renderPanel(container);
      }));
      // 样式
      container.querySelectorAll('.te-style-btn').forEach(b=>b.addEventListener('click',()=>{
        const s=b.dataset.style;this[s]=!this[s];this.renderPanel(container);
      }));
      // 自定义文本
      document.getElementById('te-text').addEventListener('input',()=>this.updateOutput());
      // 复制
      container.querySelectorAll('.te-copy').forEach(b=>b.addEventListener('click',()=>{
        const t=document.getElementById(b.dataset.target).textContent;
        navigator.clipboard.writeText(t);
      }));
      // 预设
      container.querySelectorAll('.te-preset').forEach(b=>b.addEventListener('click',()=>{
        const codes=b.dataset.codes.split(';').map(Number);
        this.bold=codes.includes(1);this.dim=codes.includes(2);this.italic=codes.includes(3);
        this.underline=codes.includes(4);this.strikethrough=codes.includes(9);this.reverse=codes.includes(7);
        codes.forEach(c=>{if(c>=30&&c<=37) this.fg=c;if(c>=40&&c<=47) this.bg=c;});
        this.renderPanel(container);
      }));
      this.updateOutput();
    },
    updateOutput(){
      const text=document.getElementById('te-text')?.value||'样本文本 Sample Text';
      const esc=this.buildEscape();
      const reset='\x1b[0m';
      document.getElementById('te-escape').textContent=`${esc}${text}${reset}`;
      document.getElementById('te-shell').textContent=`echo -e "${esc}${text}${reset}"`;
      document.getElementById('te-js').textContent="`"+`${esc}${text}${reset}`+"`";
    },
    hexFromAnsi(code){
      const colorMap={30:'#222',31:'#e53935',32:'#43a047',33:'#fdd835',34:'#1e88e5',35:'#d81b60',36:'#00acc1',37:'#e0e0e0',
        40:'#000',41:'#b71c1c',42:'#1b5e20',43:'#f57f17',44:'#0d47a1',45:'#880e4f',46:'#006064',47:'#424242'};
      return colorMap[code]||'#888';
    }
  };
  if(typeof window!=='undefined') window.TerminalEscape=TerminalEscape;
})();
