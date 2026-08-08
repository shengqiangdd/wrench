/**
 * HTML 压缩/美化插件
 */
(function(){
  const HtmlMinifier={
    id:'html-minifier', name:'HTML 压缩/美化',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('htmlmin-panel',{title:'HTML 压缩/美化',icon:'minimize-2',render:c=>this.renderPanel(c)});
      }
    },
    minify(html,opts={}){
      let s=html;
      if(opts.removeComments!==false) s=s.replace(/<!--[\s\S]*?-->/g,'');
      if(opts.removeWhitespace!==false){
        s=s.replace(/\s+/g,' ');
        s=s.replace(/>\s+</g,'><');
        s=s.trim();
      }
      if(opts.collapseBoolean!==false) s=s.replace(/ (checked|disabled|selected|readonly|multiple|required|autofocus|autoplay|controls|loop|muted|hidden|defer|async|novalidate|formnovalidate)(?=[\s\/>])/gi,' $1');
      if(opts.removeOptionalTags) s=s.replace(/<\/?(?:head|body|html)(?:\s[^>]*)?>\s*/gi,'');
      return s;
    },
    beautify(html,indent='  '){
      let s=html.replace(/\s+/g,' ').trim();
      let result='',level=0;
      const tagRegex=/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
      let lastIdx=0;
      let match;
      const selfClosing=['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'];
      while((match=tagRegex.exec(s))!==null){
        if(match.index>lastIdx){
          const text=s.substring(lastIdx,match.index).trim();
          if(text) result+=indent.repeat(level)+text+'\n';
        }
        const tag=match[0];
        const isClosing=tag.startsWith('</');
        const isOpening=!isClosing&&!tag.endsWith('/>');
        const tagName=match[1].toLowerCase();
        if(isClosing){
          level=Math.max(0,level-1);
          result+=indent.repeat(level)+tag+'\n';
        }else if(selfClosing.includes(tagName)||tag.endsWith('/>')){
          result+=indent.repeat(level)+tag+'\n';
        }else{
          result+=indent.repeat(level)+tag+'\n';
          level++;
        }
        lastIdx=match.index+tag.length;
      }
      if(lastIdx<s.length){
        const text=s.substring(lastIdx).trim();
        if(text) result+=indent.repeat(level)+text+'\n';
      }
      return result.trim();
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-html-min">
          <div class="hm-tabs">
            <button class="hm-tab active" data-m="minify">🗜️ 压缩</button>
            <button class="hm-tab" data-m="beautify">✨ 美化</button>
          </div>
          <div class="hm-opts" id="hm-opts">
            <label><input type="checkbox" id="hm-comm" checked> 去注释</label>
            <label><input type="checkbox" id="hm-ws" checked> 去空白</label>
            <label><input type="checkbox" id="hm-bool" checked> 布尔属性</label>
            <label>缩进: <select id="hm-indent"><option value="  ">2空格</option><option value="    ">4空格</option><option value="\\t">Tab</option></select></label>
          </div>
          <textarea id="hm-input" rows="10" placeholder="粘贴 HTML 代码..."></textarea>
          <button class="hm-go" id="hm-go">⚡ 执行</button>
          <div class="hm-stats" id="hm-stats"></div>
          <textarea id="hm-output" rows="10" readonly placeholder="结果..."></textarea>
          <div class="hm-actions"><button id="hm-copy" class="hm-copy">📋 复制</button></div>
          <style>
            .plugin-html-min{padding:16px;}
            .hm-tabs{display:flex;gap:4px;margin-bottom:10px;}
            .hm-tab{padding:6px 16px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .hm-tab.active{background:#ff980022;color:#ff9800;border-color:#ff9800;}
            .hm-opts{display:flex;gap:12px;align-items:center;margin-bottom:10px;color:#aaa;font-size:0.85em;}
            .hm-opts select{padding:4px 8px;background:#1a1d23;border:1px solid #3a3f47;color:#e0e0e0;border-radius:4px;}
            #hm-input,#hm-output{width:100%;background:#1a1d23;border:1px solid #3a3f47;border-radius:8px;padding:10px;color:#c8ccd0;font-family:monospace;font-size:0.8em;resize:vertical;box-sizing:border-box;}
            #hm-input:focus{border-color:#ff9800;outline:none;}
            #hm-output{opacity:0.9;}
            .hm-go{margin:10px 0;padding:8px 20px;background:#ff9800;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .hm-go:hover{background:#f57c00;}
            .hm-stats{text-align:center;color:#888;font-size:0.85em;margin:6px 0;}
            .hm-actions{text-align:right;margin-top:6px;}
            .hm-copy{padding:4px 12px;background:#3a3f47;border:none;color:#aaa;border-radius:4px;cursor:pointer;}
            .hm-copy:hover{background:#ff980033;color:#ff9800;}
          </style>
        </div>`;
      container.querySelectorAll('.hm-tab').forEach(t=>t.addEventListener('click',()=>{
        container.querySelectorAll('.hm-tab').forEach(b=>b.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('hm-opts').style.display=t.dataset.m==='minify'?'flex':'none';
        this.doWork();
      }));
      document.getElementById('hm-go').addEventListener('click',()=>this.doWork());
      document.getElementById('hm-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('hm-output').value);
        const b=document.getElementById('hm-copy');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='📋 复制',1500);
      });
    },
    doWork(){
      const input=document.getElementById('hm-input').value;
      const mode=document.querySelector('.hm-tab.active').dataset.m;
      let output;
      if(mode==='minify'){
        output=this.minify(input,{
          removeComments:document.getElementById('hm-comm').checked,
          removeWhitespace:document.getElementById('hm-ws').checked,
          collapseBoolean:document.getElementById('hm-bool').checked,
        });
      }else{
        const indent=document.getElementById('hm-indent').value==='\\t'?'\t':document.getElementById('hm-indent').value;
        output=this.beautify(input,indent);
      }
      document.getElementById('hm-output').value=output;
      const ratio=input.length>0?Math.round((1-output.length/input.length)*100):0;
      const saved=input.length-output.length;
      document.getElementById('hm-stats').textContent=input.length>0?`原始: ${input.length} 字符 → 结果: ${output.length} 字符 | ${mode==='minify'?'压缩':'美化'} ${Math.abs(ratio)}% | ${saved>=0?'节省':'增加'} ${Math.abs(saved)} 字符`:'';
    }
  };
  if(typeof window!=='undefined') window.HtmlMinifier=HtmlMinifier;
})();
