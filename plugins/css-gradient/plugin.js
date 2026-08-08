/**
 * CSS 渐变构建器插件
 * 可视化创建 linear-gradient / radial-gradient / conic-gradient
 */
(function(){
  const CssGradient={
    id:'css-gradient', name:'CSS 渐变构建器',
    type:'linear',
    angle:90,
    stops:[
      {color:'#667eea',pos:0},
      {color:'#764ba2',pos:100}
    ],
    presets:[
      {name:'日落',type:'linear',angle:135,stops:[{color:'#fa709a',pos:0},{color:'#fee140',pos:100}]},
      {name:'海洋',type:'linear',angle:180,stops:[{color:'#667eea',pos:0},{color:'#764ba2',pos:100}]},
      {name:'极光',type:'linear',angle:135,stops:[{color:'#00c6ff',pos:0},{color:'#0072ff',pos:100}]},
      {name:'火焰',type:'linear',angle:0,stops:[{color:'#f12711',pos:0},{color:'#f5af19',pos:100}]},
      {name:'森林',type:'linear',angle:135,stops:[{color:'#11998e',pos:0},{color:'#38ef7d',pos:100}]},
      {name:'霓虹',type:'linear',angle:90,stops:[{color:'#fc5c7d',pos:0},{color:'#6a82fb',pos:100}]},
      {name:'暗夜',type:'radial',angle:0,stops:[{color:'#0f0c29',pos:0},{color:'#302b63',pos:50},{color:'#24243e',pos:100}]},
      {name:'蜜桃',type:'linear',angle:135,stops:[{color:'#ffecd2',pos:0},{color:'#fcb69f',pos:100}]},
      {name:'紫罗兰',type:'radial',angle:0,stops:[{color:'#a18cd1',pos:0},{color:'#fbc2eb',pos:100}]},
    ],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('cssgrad-panel',{title:'CSS 渐变构建器',icon:'sunrise',render:c=>this.renderPanel(c)});
      }
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-cssgrad">
          <h3>🌈 CSS 渐变构建器</h3>
          <div class="cg-presets">${this.presets.map((p,i)=>`<button class="cg-preset" data-i="${i}" style="background:linear-gradient(135deg,${p.stops.map(s=>s.color).join(',')})">${p.name}</button>`).join('')}</div>
          <div class="cg-preview" id="cg-preview"></div>
          <div class="cg-controls">
            <div class="cg-row"><label>类型</label>
              <select id="cg-type"><option value="linear">线性渐变</option><option value="radial">径向渐变</option><option value="conic">锥形渐变</option></select>
            </div>
            <div class="cg-row" id="cg-angle-row"><label>角度</label><input type="range" id="cg-angle" min="0" max="360" value="90" style="flex:1"><span id="cg-angle-val">90°</span></div>
            </div>
          <div class="cg-stops">
            <div class="cg-stops-title"><span>颜色停靠点</span><button class="cg-add-stop" id="cg-add-stop">+ 添加</button></div>
            <div id="cg-stop-list"></div>
          </div>
          <div class="cg-css" id="cg-css"></div>
          <button class="cg-copy" id="cg-copy">📋 复制 CSS</button>
          <style>
            .plugin-cssgrad{padding:16px;}
            .plugin-cssgrad h3{margin:0 0 10px;font-size:1.1em;}
            .cg-presets{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;}
            .cg-preset{width:60px;height:36px;border-radius:6px;border:2px solid transparent;color:#fff;font-size:0.6em;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;text-shadow:0 1px 3px rgba(0,0,0,0.7);cursor:pointer;}
            .cg-preset:hover{border-color:#fff;transform:scale(1.1);}
            .cg-preview{height:160px;border-radius:10px;margin-bottom:14px;border:1px solid #3a3f47;}
            .cg-controls{margin-bottom:12px;}
            .cg-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
            .cg-row label{color:#888;font-size:0.85em;min-width:50px;}
            .cg-row select,.cg-row input{background:#1a1d23;border:1px solid #3a3f47;color:#c8ccd0;padding:4px 8px;border-radius:4px;font-size:0.85em;}
            .cg-row input[type=range]{accent-color:#9c27b0;}
            .cg-row span{color:#9c27b0;font-size:0.85em;min-width:40px;}
            .cg-stops{margin-bottom:12px;}
            .cg-stops-title{display:flex;justify-content:space-between;margin-bottom:6px;color:#888;font-size:0.85em;}
            .cg-add-stop{background:none;border:1px solid #3a3f47;color:#aaa;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:0.8em;}
            .cg-add-stop:hover{border-color:#9c27b0;color:#9c27b0;}
            .cg-stop{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #2a2e35;}
            .cg-stop input[type=color]{width:36px;height:28px;border:1px solid #3a3f47;border-radius:4px;cursor:pointer;padding:0;}
            .cg-stop input[type=range]{flex:1;accent-color:#9c27b0;}
            .cg-stop span{font-size:0.8em;color:#888;min-width:36px;}
            .cg-stop .cg-del{background:none;border:none;color:#f44336;cursor:pointer;}
            .cg-css{background:#1a1d23;border-radius:6px;padding:10px;color:#c8ccd0;font-family:monospace;font-size:0.82em;white-space:pre-wrap;border:1px solid #3a3f47;margin-bottom:8px;word-break:break-all;}
            .cg-copy{padding:6px 16px;background:#9c27b0;color:#fff;border:none;border-radius:6px;cursor:pointer;}
            .cg-copy:hover{background:#8e24aa;}
          </style>
        </div>`;
      document.getElementById('cg-type').addEventListener('change',e=>{this.type=e.target.value;this.update();});
      document.getElementById('cg-angle').addEventListener('input',e=>{this.angle=+e.target.value;document.getElementById('cg-angle-val').textContent=this.angle+'°';this.update();});
      document.getElementById('cg-add-stop').addEventListener('click',()=>{
        const last=this.stops[this.stops.length-1];
        this.stops.push({color:'#ffffff',pos:last?Math.min(last.pos+20,100):0});
        this.renderStops();this.update();
      });
      document.getElementById('cg-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('cg-css').textContent);
      });
      container.querySelectorAll('.cg-preset').forEach(b=>b.addEventListener('click',()=>{
        const p=this.presets[+b.dataset.i];
        this.type=p.type;this.angle=p.angle;this.stops=p.stops.map(s=>({...s}));
        document.getElementById('cg-type').value=this.type;
        document.getElementById('cg-angle').value=this.angle;
        document.getElementById('cg-angle-val').textContent=this.angle+'°';
        this.renderStops();this.update();
      }));
      this.renderStops();this.update();
    },
    renderStops(){
      document.getElementById('cg-stop-list').innerHTML=this.stops.map((s,i)=>`
        <div class="cg-stop">
          <input type="color" value="${s.color}" data-i="${i}" class="cg-color">
          <input type="range" min="0" max="100" value="${s.pos}" data-i="${i}" class="cg-pos">
          <span>${s.pos}%</span>
          ${this.stops.length>2?`<button class="cg-del" data-i="${i}">✕</button>`:''}
        </div>`).join('');
      document.querySelectorAll('.cg-color').forEach(inp=>inp.addEventListener('input',e=>{
        this.stops[+e.target.dataset.i].color=e.target.value;this.update();
      }));
      document.querySelectorAll('.cg-pos').forEach(inp=>inp.addEventListener('input',e=>{
        this.stops[+e.target.dataset.i].pos=+e.target.value;
        e.target.parentNode.querySelector('span').textContent=e.target.value+'%';
        this.update();
      }));
      document.querySelectorAll('.cg-del').forEach(b=>b.addEventListener('click',e=>{
        this.stops.splice(+e.target.dataset.i,1);this.renderStops();this.update();
      }));
    },
    buildGradient(){
      const stops=this.stops.sort((a,b)=>a.pos-b.pos).map(s=>`${s.color} ${s.pos}%`).join(', ');
      if(this.type==='linear') return `linear-gradient(${this.angle}deg, ${stops})`;
      if(this.type==='radial') return `radial-gradient(circle, ${stops})`;
      return `conic-gradient(${stops})`;
    },
    update(){
      const grad=this.buildGradient();
      document.getElementById('cg-preview').style.background=grad;
      document.getElementById('cg-css').textContent=`background: ${grad};`;
    }
  };
  if(typeof window!=='undefined') window.CssGradient=CssGradient;
})();
