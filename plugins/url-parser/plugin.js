/**
 * URL 解析器插件
 * 分解 URL 各部分，查询参数查看/编辑，批量提取链接
 */
(function(){
  const UrlParser={
    id:'url-parser', name:'URL 解析器',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('urlparse-panel',{title:'URL 解析器',icon:'link',render:c=>this.renderPanel(c)});
      }
    },
    parse(url){
      try{ return new URL(url); }catch(e){ return null; }
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-url-parser">
          <h3>🔗 URL 解析器</h3>
          <textarea id="url-input" rows="2" placeholder="粘贴 URL...">https://example.com:8080/path/to/page?name=test&lang=zh-CN#section2</textarea>
          <div class="url-parts" id="url-parts"></div>
          <h4>📋 查询参数</h4>
          <div id="url-params"></div>
          <h4>🔗 批量提取链接</h4>
          <textarea id="url-batch" rows="4" placeholder="粘贴 HTML 或文本，自动提取所有 URL..."></textarea>
          <div id="url-extracted"></div>
          <style>
            .plugin-url-parser{padding:16px;}
            .plugin-url-parser h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-url-parser h4{margin:16px 0 6px;font-size:0.9em;color:#888;}
            #url-input,#url-batch{width:100%;background:#1a1d23;border:1px solid #3a3f47;border-radius:8px;padding:10px;color:#c8ccd0;font-family:monospace;font-size:0.85em;resize:vertical;box-sizing:border-box;}
            #url-input:focus,#url-batch:focus{border-color:#4a9eff;outline:none;}
            .url-part{display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid #2a2e35;font-size:0.85em;}
            .url-part .label{min-width:90px;color:#888;}
            .url-part .value{color:#4a9eff;font-family:monospace;word-break:break-all;}
            .url-part .value.v-scheme{color:#e91e63;}
            .url-part .value.v-host{color:#4caf50;}
            .url-part .value.v-port{color:#ff9800;}
            .url-part .value.v-path{color:#2196f3;}
            .url-part .value.v-hash{color:#9c27b0;}
            .url-params-table{width:100%;font-size:0.85em;border-collapse:collapse;}
            .url-params-table th{text-align:left;padding:4px 8px;color:#888;border-bottom:1px solid #3a3f47;}
            .url-params-table td{padding:4px 8px;border-bottom:1px solid #2a2e35;}
            .url-params-table td:first-child{color:#e91e63;font-family:monospace;}
            .url-params-table td:nth-child(2){color:#4a9eff;font-family:monospace;}
            .url-extracted-list{list-style:none;padding:0;margin:0;}
            .url-extracted-list li{padding:4px 8px;font-size:0.8em;font-family:monospace;color:#c8ccd0;border-bottom:1px solid #2a2e35;word-break:break-all;cursor:pointer;}
            .url-extracted-list li:hover{background:#4a9eff11;}
            .url-count{color:#555;font-size:0.8em;margin-top:4px;}
          </style>
        </div>`;
      const input=document.getElementById('url-input');
      input.addEventListener('input',()=>this.renderParts());
      document.getElementById('url-batch').addEventListener('input',()=>this.extractLinks());
      this.renderParts();
    },
    renderParts(){
      const raw=document.getElementById('url-input').value.trim();
      const parts=document.getElementById('url-parts');
      const paramsEl=document.getElementById('url-params');
      if(!raw){parts.innerHTML='';paramsEl.innerHTML='';return;}
      const u=this.parse(raw);
      if(!u){parts.innerHTML='<div style="color:#f44336;padding:8px;">❌ 无效 URL</div>';paramsEl.innerHTML='';return;}
      parts.innerHTML=[
        ['协议',u.protocol.replace(':',''),'v-scheme'],
        ['主机',u.hostname,'v-host'],
        ['端口',u.port||'(默认)','v-port'],
        ['路径',u.pathname,''],
        ['查询',u.search||'(无)',''],
        ['锚点',u.hash||'(无)','v-hash'],
      ].map(([l,v,c])=>`<div class="url-part"><span class="label">${l}</span><span class="value ${c}">${v}</span></div>`).join('');
      const params=[...u.searchParams.entries()];
      if(params.length===0){paramsEl.innerHTML='<div style="color:#555;font-size:0.85em;padding:4px 8px;">无查询参数</div>';return;}
      paramsEl.innerHTML=`<table class="url-params-table"><thead><tr><th>参数名</th><th>值</th><th>解码值</th></tr></thead><tbody>${
        params.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td><td style="color:#888;">${decodeURIComponent(v)}</td></tr>`).join('')
      }</tbody></table>`;
    },
    extractLinks(){
      const text=document.getElementById('url-batch').value;
      const el=document.getElementById('url-extracted');
      const regex=/https?:\/\/[^\s"'<>\]]+/g;
      const matches=[...new Set(text.match(regex)||[])];
      if(matches.length===0){el.innerHTML='<div class="url-count">未找到链接</div>';return;}
      el.innerHTML=`<div class="url-count">找到 ${matches.length} 个链接:</div><ul class="url-extracted-list">${
        matches.map(u=>`<li onclick="navigator.clipboard.writeText('${u.replace(/'/g,"\\'")}')">${u}</li>`).join('')
      }</ul>`;
    }
  };
  if(typeof window!=='undefined') window.UrlParser=UrlParser;
})();
