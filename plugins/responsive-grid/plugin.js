/**
 * 响应式栅格生成器插件
 * 可视化配置断点、列数，生成 CSS Grid/Flexbox 响应式代码
 */
(function(){
  const ResponsiveGrid={
    id:'responsive-grid', name:'响应式栅格生成器',
    breakpoints:[{name:'sm',width:640,cols:4},{name:'md',width:768,cols:6},{name:'lg',width:1024,cols:8},{name:'xl',width:1280,cols:12}],
    gap:16,
    mode:'grid',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('respgrid-panel',{title:'响应式栅格生成器',icon:'grid',render:c=>this.renderPanel(c)});
      }
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-respgrid">
          <h3>📐 响应式栅格生成器</h3>
          <div class="rg-mode">
            <button class="rg-mode-btn active" data-mode="grid">CSS Grid</button>
            <button class="rg-mode-btn" data-mode="flex">Flexbox</button>
          </div>
          <div class="rg-gap">
            <label>列间距 (gap)</label>
            <input type="range" id="rg-gap" min="0" max="40" value="16" style="flex:1">
            <span id="rg-gap-val">16px</span>
          </div>
          <h4>📱 断点配置</h4>
          <div id="rg-bps"></div>
          <button class="rg-add-bp" id="rg-add-bp">+ 添加断点</button>
          <h4>👁️ 预览</h4>
          <div class="rg-preview" id="rg-preview"></div>
          <h4>📋 导出代码</h4>
          <pre class="rg-output" id="rg-output"></pre>
          <button class="rg-copy" id="rg-copy">📋 复制 CSS</button>
          <style>
            .plugin-respgrid{padding:16px;}
            .plugin-respgrid h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-respgrid h4{margin:14px 0 6px;font-size:0.9em;color:#888;}
            .rg-mode{display:flex;gap:4px;margin-bottom:12px;}
            .rg-mode-btn{padding:6px 16px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:6px;cursor:pointer;}
            .rg-mode-btn.active{background:#9c27b022;color:#9c27b0;border-color:#9c27b0;}
            .rg-gap{display:flex;align-items:center;gap:8px;margin-bottom:10px;}
            .rg-gap label{color:#888;font-size:0.85em;}
            .rg-gap input[type=range]{accent-color:#9c27b0;}
            .rg-gap span{color:#9c27b0;font-size:0.85em;min-width:40px;}
            .rg-bp{display:flex;align-items:center;gap:6px;padding:6px 8px;background:#1a1d23;border:1px solid #2a2e35;border-radius:6px;margin-bottom:4px;}
            .rg-bp input{background:#0d0f14;border:1px solid #3a3f47;color:#c8ccd0;padding:3px 6px;border-radius:3px;font-size:0.82em;width:60px;}
            .rg-bp label{color:#888;font-size:0.8em;}
            .rg-bp .rg-del{background:none;border:none;color:#f44336;cursor:pointer;font-size:0.9em;}
            .rg-add-bp{width:100%;padding:6px;background:#1a1d23;border:1px dashed #3a3f47;color:#888;border-radius:6px;cursor:pointer;margin-top:4px;}
            .rg-add-bp:hover{border-color:#9c27b0;color:#9c27b0;}
            .rg-preview{background:#1a1d23;border-radius:8px;padding:12px;border:1px solid #3a3f47;min-height:100px;}
            .rg-preview-grid{display:grid;gap:var(--gap);}
            .rg-preview-flex{display:flex;flex-wrap:wrap;gap:var(--gap);}
            .rg-cell{background:#9c27b033;border:1px solid #9c27b066;border-radius:4px;padding:6px;color:#9c27b0;font-size:0.8em;text-align:center;}
            .rg-output{background:#1a1d23;border-radius:8px;padding:12px;color:#c8ccd0;font-family:monospace;font-size:0.8em;white-space:pre-wrap;max-height:300px;overflow-y:auto;border:1px solid #3a3f47;}
            .rg-copy{margin-top:8px;padding:6px 16px;background:#9c27b0;color:#fff;border:none;border-radius:6px;cursor:pointer;}
            .rg-copy:hover{background:#8e24aa;}
          </style>
        </div>`;
      document.querySelectorAll('.rg-mode-btn').forEach(b=>b.addEventListener('click',()=>{
        document.querySelectorAll('.rg-mode-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');
        this.mode=b.dataset.mode;this.update();
      }));
      document.getElementById('rg-gap').addEventListener('input',e=>{this.gap=+e.target.value;document.getElementById('rg-gap-val').textContent=this.gap+'px';this.update();});
      document.getElementById('rg-add-bp').addEventListener('click',()=>{
        this.breakpoints.push({name:'custom',width:900,cols:6});this.renderBps();this.update();
      });
      document.getElementById('rg-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('rg-output').textContent);
      });
      this.renderBps();this.update();
    },
    renderBps(){
      document.getElementById('rg-bps').innerHTML=this.breakpoints.map((bp,i)=>`
        <div class="rg-bp">
          <input value="${bp.name}" data-i="${i}" data-f="name" class="rg-bp-input" placeholder="名称">
          <label>≥</label>
          <input type="number" value="${bp.width}" data-i="${i}" data-f="width" class="rg-bp-input" placeholder="宽度">
          <label>px /</label>
          <input type="number" value="${bp.cols}" data-i="${i}" data-f="cols" class="rg-bp-input" style="width:40px" placeholder="列">
          <label>列</label>
          <button class="rg-del" data-i="${i}">✕</button>
        </div>`).join('');
      document.querySelectorAll('.rg-bp-input').forEach(inp=>inp.addEventListener('change',e=>{
        const i=+e.target.dataset.i,f=e.target.dataset.f;
        this.breakpoints[i][f]=f==='name'?e.target.value:+e.target.value;this.update();
      }));
      document.querySelectorAll('.rg-del').forEach(b=>b.addEventListener('click',e=>{
        this.breakpoints.splice(+e.target.dataset.i,1);this.renderBps();this.update();
      }));
    },
    update(){
      const sorted=[...this.breakpoints].sort((a,b)=>a.width-b.width);
      const cols=sorted[sorted.length-1]?.cols||12;
      // Preview
      const preview=document.getElementById('rg-preview');
      preview.style.setProperty('--gap',this.gap+'px');
      preview.innerHTML=`<div class="rg-preview-${this.mode}" id="rg-pv-inner">${Array.from({length:cols},(_,i)=>`<div class="rg-cell">col</div>`).join('')}</div>`;
      // CSS output
      let css='';
      if(this.mode==='grid'){
        css=`/* 响应式 CSS Grid */\n.container {\n  display: grid;\n  gap: ${this.gap}px;\n  grid-template-columns: repeat(${sorted[0]?.cols||4}, 1fr);\n}\n\n`;
        sorted.forEach(bp=>{
          css+=`@media (min-width: ${bp.width}px) {\n  .container {\n    grid-template-columns: repeat(${bp.cols}, 1fr);\n  }\n}\n\n`;
        });
      }else{
        css=`/* 响应式 Flexbox */\n.container {\n  display: flex;\n  flex-wrap: wrap;\n  gap: ${this.gap}px;\n}\n\n.container > * {\n  flex: 1 1 calc(${100/(sorted[0]?.cols||4)}% - ${this.gap}px);\n}\n\n`;
        sorted.forEach(bp=>{
          css+=`@media (min-width: ${bp.width}px) {\n  .container > * {\n    flex: 1 1 calc(${100/bp.cols}% - ${this.gap}px);\n  }\n}\n\n`;
        });
      }
      css+=`.item { padding: ${this.gap}px; box-sizing: border-box; }`;
      document.getElementById('rg-output').textContent=css;
    }
  };
  if(typeof window!=='undefined') window.ResponsiveGrid=ResponsiveGrid;
})();
