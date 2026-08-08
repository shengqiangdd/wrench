/**
 * 配色方案生成器插件
 * 基于颜色生成互补色、类似色、三色组、四色组、分裂互补、WCAG对比度检查
 */
(function(){
  const ColorPalette={
    id:'color-palette', name:'配色方案生成器',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('colorpal-panel',{title:'配色方案生成器',icon:'palette',render:c=>this.renderPanel(c)});
      }
    },
    hex2hsl(hex){
      let r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;
      let h=0,s=0;
      if(max!==min){
        const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
        if(max===r)h=((g-b)/d+(g<b?6:0))*60;
        else if(max===g)h=((b-r)/d+2)*60;
        else h=((r-g)/d+4)*60;
      }
      return {h:Math.round(h),s:Math.round(s*100),l:Math.round(l*100)};
    },
    hsl2hex(h,s,l){
      s/=100;l/=100;
      const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;
      let r=0,g=0,b=0;
      if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}
      else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}
      r=Math.round((r+m)*255);g=Math.round((g+m)*255);b=Math.round((b+m)*255);
      return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
    },
    shiftHue(hex,deg){const hsl=this.hex2hsl(hex);return this.hsl2hex((hsl.h+deg+360)%360,hsl.s,hsl.l);},
    setL(hex,l){const hsl=this.hex2hsl(hex);return this.hsl2hex(hsl.h,hsl.s,l);},
    luminance(hex){
      const rgb=[hex.slice(1,3),hex.slice(3,5),hex.slice(5,7)].map(h=>{const v=parseInt(h,16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
      return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
    },
    contrastRatio(c1,c2){
      const l1=this.luminance(c1),l2=this.luminance(c2);
      const lighter=Math.max(l1,l2),darker=Math.min(l1,l2);
      return ((lighter+0.05)/(darker+0.05));
    },
    wcagLevel(ratio){
      if(ratio>=7) return {level:'AAA ✅',color:'#4caf50',desc:'大文本和小文本均可'};
      if(ratio>=4.5) return {level:'AA ✅',color:'#4caf50',desc:'大文本和小文本均可'};
      if(ratio>=3) return {level:'AA 大文本 ✅',color:'#ff9800',desc:'仅大文本（≥18px）'};
      return {level:'不合格 ❌',color:'#f44336',desc:'不满足任何标准'};
    },
    generateHarmony(hex){
      const hsl=this.hex2hsl(hex);
      return {
        '🎨 原色': [hex],
        '🔄 互补色': [hex, this.hsl2hex((hsl.h+180)%360, hsl.s, hsl.l)],
        '🔀 类似色': [this.hsl2hex((hsl.h-30+360)%360, hsl.s, hsl.l), hex, this.hsl2hex((hsl.h+30)%360, hsl.s, hsl.l)],
        '🔺 三色组': [hex, this.hsl2hex((hsl.h+120)%360, hsl.s, hsl.l), this.hsl2hex((hsl.h+240)%360, hsl.s, hsl.l)],
        '⬛ 四色组': [hex, this.hsl2hex((hsl.h+90)%360, hsl.s, hsl.l), this.hsl2hex((hsl.h+180)%360, hsl.s, hsl.l), this.hsl2hex((hsl.h+270)%360, hsl.s, hsl.l)],
        '🔀 分裂互补': [hex, this.hsl2hex((hsl.h+150)%360, hsl.s, hsl.l), this.hsl2hex((hsl.h+210)%360, hsl.s, hsl.l)],
      };
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-color-pal">
          <h3>🎨 配色方案生成器</h3>
          <div class="cp-input-row">
            <input type="color" id="cp-color" value="#4a9eff" />
            <input type="text" id="cp-hex" value="#4a9eff" placeholder="#4a9eff" />
            <div class="cp-hsl" id="cp-hsl">H:213 S:100 L:80</div>
          </div>
          <div class="cp-schemes" id="cp-schemes"></div>
          <h4>🔍 WCAG 对比度检查</h4>
          <div class="cp-contrast-row">
            <div class="cp-cc-box"><label>前景</label><input type="color" id="cp-fg" value="#ffffff" /><input type="text" id="cp-fg-hex" value="#ffffff" /></div>
            <div class="cp-cc-box"><label>背景</label><input type="color" id="cp-bg" value="#4a9eff" /><input type="text" id="cp-bg-hex" value="#4a9eff" /></div>
            <div class="cp-cc-result" id="cp-cc-result"></div>
          </div>
          <div class="cp-preview-box" id="cp-preview-box">
            <span style="font-size:1.5em;font-weight:700;">Aa 预览文本</span><br>
            <span style="font-size:0.85em;">The quick brown fox jumps over the lazy dog</span>
          </div>
          <style>
            .plugin-color-pal{padding:16px;}
            .plugin-color-pal h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-color-pal h4{margin:16px 0 8px;font-size:0.9em;color:#888;}
            .cp-input-row{display:flex;gap:8px;align-items:center;margin-bottom:14px;}
            #cp-color{width:50px;height:36px;border:none;cursor:pointer;border-radius:6px;}
            #cp-hex{flex:1;padding:6px 10px;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;color:#e0e0e0;font-family:monospace;}
            .cp-hsl{color:#888;font-size:0.85em;min-width:160px;}
            .cp-scheme{margin-bottom:12px;}
            .cp-scheme-title{font-size:0.85em;color:#888;margin-bottom:4px;}
            .cp-swatches{display:flex;gap:6px;flex-wrap:wrap;}
            .cp-swatch{width:50px;height:50px;border-radius:8px;cursor:pointer;position:relative;display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;transition:transform 0.15s;}
            .cp-swatch:hover{transform:scale(1.1);}
            .cp-swatch-label{font-size:0.55em;color:rgba(0,0,0,0.6);font-family:monospace;text-shadow:0 0 3px rgba(255,255,255,0.8);}
            .cp-contrast-row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;}
            .cp-cc-box{display:flex;align-items:center;gap:6px;}
            .cp-cc-box label{color:#888;font-size:0.85em;}
            .cp-cc-box input[type="color"]{width:36px;height:30px;border:none;cursor:pointer;}
            .cp-cc-box input[type="text"]{width:80px;padding:4px 8px;background:#1a1d23;border:1px solid #3a3f47;border-radius:4px;color:#e0e0e0;font-family:monospace;font-size:0.85em;}
            .cp-cc-result{background:#1a1d23;border-radius:8px;padding:10px 14px;flex:1;min-width:200px;}
            .cp-ratio{font-size:1.3em;font-weight:700;color:#4caf50;}
            .cp-level{font-size:0.9em;margin-top:2px;}
            .cp-preview-box{margin-top:10px;padding:16px;border-radius:8px;border:1px solid #3a3f47;text-align:center;transition:all 0.3s;}
          </style>
        </div>`;
      const colorInput=document.getElementById('cp-color');
      const hexInput=document.getElementById('cp-hex');
      const sync=(hex)=>{
        if(!/^#[0-9a-fA-F]{6}$/.test(hex))return;
        colorInput.value=hex;hexInput.value=hex;
        const hsl=this.hex2hsl(hex);
        document.getElementById('cp-hsl').textContent=`H:${hsl.h} S:${hsl.s}% L:${hsl.l}%`;
        this.renderSchemes(hex);
        this.updateContrast();
      };
      colorInput.addEventListener('input',e=>sync(e.target.value));
      hexInput.addEventListener('input',e=>{if(e.target.value.length===7)sync(e.target.value);});
      // 对比度
      const syncCc=()=>{
        const fg=document.getElementById('cp-fg').value,bg=document.getElementById('cp-bg').value;
        document.getElementById('cp-fg-hex').value=fg;document.getElementById('cp-bg-hex').value=bg;
        this.updateContrast();
      };
      document.getElementById('cp-fg').addEventListener('input',()=>{document.getElementById('cp-fg-hex').value=document.getElementById('cp-fg').value;this.updateContrast();});
      document.getElementById('cp-bg').addEventListener('input',()=>{document.getElementById('cp-bg-hex').value=document.getElementById('cp-bg').value;this.updateContrast();});
      document.getElementById('cp-fg-hex').addEventListener('input',e=>{if(e.target.value.length===7){document.getElementById('cp-fg').value=e.target.value;this.updateContrast();}});
      document.getElementById('cp-bg-hex').addEventListener('input',e=>{if(e.target.value.length===7){document.getElementById('cp-bg').value=e.target.value;this.updateContrast();}});
      sync('#4a9eff');
    },
    renderSchemes(hex){
      const schemes=this.generateHarmony(hex);
      document.getElementById('cp-schemes').innerHTML=Object.entries(schemes).map(([name,colors])=>`
        <div class="cp-scheme">
          <div class="cp-scheme-title">${name}</div>
          <div class="cp-swatches">${colors.map(c=>`<div class="cp-swatch" style="background:${c}" onclick="navigator.clipboard.writeText('${c}')" title="${c}"><span class="cp-swatch-label">${c}</span></div>`).join('')}</div>
        </div>`).join('');
    },
    updateContrast(){
      const fg=document.getElementById('cp-fg').value,bg=document.getElementById('cp-bg').value;
      const ratio=this.contrastRatio(fg,bg);
      const wcag=this.wcagLevel(ratio);
      document.getElementById('cp-cc-result').innerHTML=`
        <div class="cp-ratio">${ratio.toFixed(2)}:1</div>
        <div class="cp-level" style="color:${wcag.color}">${wcag.level}</div>
        <div style="color:#888;font-size:0.8em;margin-top:2px;">${wcag.desc}</div>`;
      const preview=document.getElementById('cp-preview-box');
      preview.style.color=fg;preview.style.background=bg;
    }
  };
  if(typeof window!=='undefined') window.ColorPalette=ColorPalette;
})();
