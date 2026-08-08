/**
 * 色觉障碍模拟器插件
 * 模拟 8 种色觉障碍，辅助无障碍设计验证
 */
(function(){
  const ColorBlindSim={
    id:'color-blind-sim', name:'色觉障碍模拟器',
    types:[
      {id:'normal',name:'正常视觉',desc:'无色觉障碍',matrix:[[1,0,0],[0,1,0],[0,0,1]]},
      {id:'protanopia',name:'红色盲',desc:'无法感知红色光',matrix:[[0.567,0.433,0],[0.558,0.442,0],[0,0.242,0.758]]},
      {id:'deuteranopia',name:'绿色盲',desc:'无法感知绿色光',matrix:[[0.625,0.375,0],[0.7,0.3,0],[0,0.3,0.7]]},
      {id:'tritanopia',name:'蓝色盲',desc:'无法感知蓝色光',matrix:[[0.95,0.05,0],[0,0.433,0.567],[0,0.475,0.525]]},
      {id:'protanomaly',name:'红色弱',desc:'红色感知减弱',matrix:[[0.817,0.183,0],[0.333,0.667,0],[0,0.125,0.875]]},
      {id:'deuteranomaly',name:'绿色弱',desc:'绿色感知减弱',matrix:[[0.8,0.2,0],[0.258,0.742,0],[0,0.142,0.858]]},
      {id:'tritanomaly',name:'蓝色弱',desc:'蓝色感知减弱',matrix:[[0.967,0.033,0],[0,0.733,0.267],[0,0.183,0.817]]},
      {id:'achromatopsia',name:'全色盲',desc:'完全无彩色视觉',matrix:[[0.299,0.587,0.114],[0.299,0.587,0.114],[0.299,0.587,0.114]]},
    ],
    testColors:['#e53935','#43a047','#1e88e5','#fb8c00','#8e24aa','#00acc1','#fdd835','#f4511e','#546e7a','#d81b60','#3949ab','#00897b'],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('cbsim-panel',{title:'色觉障碍模拟器',icon:'eye',render:c=>this.renderPanel(c)});
      }
    },
    hexToRgb(hex){
      const r=parseInt(hex.slice(1,3),16)/255;
      const g=parseInt(hex.slice(3,5),16)/255;
      const b=parseInt(hex.slice(5,7),16)/255;
      return[r,g,b];
    },
    rgbToHex(r,g,b){
      return'#'+[r,g,b].map(v=>{
        const h=Math.round(Math.max(0,Math.min(255,v*255))).toString(16);
        return h.length===1?'0'+h:h;
      }).join('');
    },
    simulate(hex,matrix){
      const[r,g,b]=this.hexToRgb(hex);
      return this.rgbToHex(
        matrix[0][0]*r+matrix[0][1]*g+matrix[0][2]*b,
        matrix[1][0]*r+matrix[1][1]*g+matrix[1][2]*b,
        matrix[2][0]*r+matrix[2][1]*g+matrix[2][2]*b
      );
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-cbsim">
          <h3>👁️ 色觉障碍模拟器</h3>
          <div class="cb-custom">
            <label>自定义颜色</label>
            <div class="cb-custom-row">
              <input type="color" id="cb-custom-color" value="#e53935">
              <input id="cb-custom-hex" value="#e53935" placeholder="#RRGGBB">
              <button id="cb-add-color">+ 添加</button>
            </div>
          </div>
          <div class="cb-grid" id="cb-grid"></div>
          <style>
            .plugin-cbsim{padding:16px;}
            .plugin-cbsim h3{margin:0 0 10px;font-size:1.1em;}
            .cb-custom{margin-bottom:14px;}
            .cb-custom label{color:#888;font-size:0.85em;display:block;margin-bottom:4px;}
            .cb-custom-row{display:flex;gap:6px;}
            .cb-custom-row input[type=color]{width:40px;height:32px;border:1px solid #3a3f47;border-radius:4px;cursor:pointer;padding:0;}
            .cb-custom-row input[type=text]{flex:1;background:#1a1d23;border:1px solid #3a3f47;color:#c8ccd0;padding:4px 8px;border-radius:4px;font-family:monospace;}
            .cb-custom-row button{padding:4px 12px;background:#1a1d23;border:1px solid #3a3f47;color:#aaa;border-radius:4px;cursor:pointer;}
            .cb-custom-row button:hover{border-color:#ff9800;color:#ff9800;}
            .cb-grid{display:grid;gap:10px;}
            .cb-type-card{background:#1a1d23;border-radius:8px;padding:10px;border:1px solid #2a2e35;}
            .cb-type-header{display:flex;justify-content:space-between;margin-bottom:8px;}
            .cb-type-name{font-weight:600;color:#e0e0e0;font-size:0.9em;}
            .cb-type-desc{color:#888;font-size:0.8em;}
            .cb-colors{display:flex;gap:4px;flex-wrap:wrap;}
            .cb-swatch{width:40px;height:32px;border-radius:4px;border:1px solid #3a3f47;position:relative;cursor:pointer;}
            .cb-swatch:hover{transform:scale(1.2);z-index:1;}
            .cb-swatch .cb-hex{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:0.6em;color:#888;white-space:nowrap;font-family:monospace;display:none;}
            .cb-swatch:hover .cb-hex{display:block;}
          </style>
        </div>`;
      document.getElementById('cb-custom-color').addEventListener('input',e=>{
        document.getElementById('cb-custom-hex').value=e.target.value;
      });
      document.getElementById('cb-custom-hex').addEventListener('input',e=>{
        if(/^#[0-9a-f]{6}$/i.test(e.target.value)) document.getElementById('cb-custom-color').value=e.target.value;
      });
      document.getElementById('cb-add-color').addEventListener('click',()=>{
        const hex=document.getElementById('cb-custom-hex').value;
        if(/^#[0-9a-f]{6}$/i.test(hex)){
          this.testColors.push(hex);this.renderGrid();
        }
      });
      this.renderGrid();
    },
    renderGrid(){
      document.getElementById('cb-grid').innerHTML=this.types.map(type=>`
        <div class="cb-type-card">
          <div class="cb-type-header">
            <span class="cb-type-name">${type.name}</span>
            <span class="cb-type-desc">${type.desc}</span>
          </div>
          <div class="cb-colors">
            ${this.testColors.map(hex=>{
              const sim=type.id==='normal'?hex:this.simulate(hex,type.matrix);
              return `<div class="cb-swatch" style="background:${sim}" title="${hex} → ${sim}"><span class="cb-hex">${sim}</span></div>`;
            }).join('')}
          </div>
        </div>`).join('');
    }
  };
  if(typeof window!=='undefined') window.ColorBlindSim=ColorBlindSim;
})();
