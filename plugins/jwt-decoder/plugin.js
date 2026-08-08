/**
 * JWT 解析器插件
 * 解码 JWT Token 的 Header / Payload / Signature，显示过期状态
 */
(function(){
  const JwtDecoder={
    id:'jwt-decoder', name:'JWT 解析器',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('jwt-panel',{title:'JWT 解析器',icon:'key',render:c=>this.renderPanel(c)});
      }
    },
    b64urlDecode(s){
      try{
        let str=s.replace(/-/g,'+').replace(/_/g,'/');
        while(str.length%4) str+='=';
        return decodeURIComponent(atob(str).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      }catch(e){ return null; }
    },
    parse(token){
      token=token.trim();
      if(!token.startsWith('ey')) return null;
      const parts=token.split('.');
      if(parts.length<2) return null;
      const header=JSON.parse(this.b64urlDecode(parts[0])||'null');
      const payload=JSON.parse(this.b64urlDecode(parts[1])||'null');
      return { header, payload, signature: parts[2]||'', parts };
    },
    formatTime(ts){
      if(!ts) return '—';
      const d=new Date(ts*1000);
      return d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
    },
    getStatus(payload){
      if(!payload||!payload.exp) return {text:'无过期时间',cls:'jwt-info'};
      const now=Math.floor(Date.now()/1000);
      const diff=payload.exp-now;
      if(diff<0) return {text:'⚠️ 已过期 '+this.formatTime(payload.exp),cls:'jwt-expired'};
      if(diff<3600) return {text:'⏰ 即将过期 ('+Math.floor(diff/60)+'分钟后)',cls:'jwt-warn'};
      if(diff<86400) return {text:'✅ 有效 ('+Math.floor(diff/3600)+'小时后过期)',cls:'jwt-ok'};
      return {text:'✅ 有效 ('+Math.floor(diff/86400)+'天后过期)',cls:'jwt-ok'};
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-jwt">
          <h3>🔑 JWT Token 解析器</h3>
          <textarea id="jwt-input" placeholder="粘贴 JWT Token（eyJhbGci...）\n\n支持标准 JWT 和 JWE 格式的前两个部分">eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW8oOS4iSIsImlhdCI6MTcxMDAwMDAwMCwiZXhwIjoxNzEwMDM2MDAwLCJyb2xlIjoiYWRtaW4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c</textarea>
          <button class="jwt-parse-btn" id="jwt-parse-btn">🔍 解析</button>
          <div class="jwt-status" id="jwt-status"></div>
          <div class="jwt-results" id="jwt-results"></div>
          <style>
            .plugin-jwt{padding:16px;}
            .plugin-jwt h3{margin:0 0 10px;font-size:1.1em;}
            #jwt-input{width:100%;min-height:80px;background:#1a1d23;border:1px solid #3a3f47;border-radius:8px;padding:10px;color:#c8ccd0;font-family:monospace;font-size:0.8em;resize:vertical;box-sizing:border-box;}
            #jwt-input:focus{border-color:#e91e63;outline:none;}
            .jwt-parse-btn{margin:10px 0;padding:8px 20px;background:#e91e63;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .jwt-status{padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:0.9em;display:none;}
            .jwt-status.jwt-ok{background:#4caf5022;color:#4caf50;border:1px solid #4caf5044;display:block;}
            .jwt-status.jwt-expired{background:#f4433622;color:#f44336;border:1px solid #f4433644;display:block;}
            .jwt-status.jwt-warn{background:#ff980022;color:#ff9800;border:1px solid #ff980044;display:block;}
            .jwt-status.jwt-info{background:#4a9eff22;color:#4a9eff;border:1px solid #4a9eff44;display:block;}
            .jwt-section{margin-bottom:14px;}
            .jwt-section h4{margin:0 0 6px;font-size:0.9em;color:#888;}
            .jwt-card{background:#1a1d23;border-radius:8px;padding:12px;border:1px solid #3a3f47;}
            .jwt-kv{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #2a2e35;font-size:0.85em;}
            .jwt-kv:last-child{border-bottom:none;}
            .jwt-kv .k{color:#888;}
            .jwt-kv .v{color:#e0e0e0;font-family:monospace;word-break:break-all;}
            .jwt-kv .v.v-pink{color:#e91e63;}
            .jwt-kv .v.v-blue{color:#4a9eff;}
            .jwt-copy{padding:2px 8px;background:#3a3f47;border:none;color:#aaa;border-radius:3px;cursor:pointer;font-size:0.75em;margin-left:8px;}
            .jwt-copy:hover{background:#e91e6333;color:#e91e63;}
          </style>
        </div>`;
      document.getElementById('jwt-parse-btn').addEventListener('click',()=>this.doParse());
      document.getElementById('jwt-input').addEventListener('input',()=>this.doParse());
      this.doParse();
    },
    doParse(){
      const input=document.getElementById('jwt-input').value.trim();
      const status=document.getElementById('jwt-status');
      const results=document.getElementById('jwt-results');
      if(!input){ status.style.display='none'; results.innerHTML=''; return; }
      try{
        const jwt=this.parse(input);
        if(!jwt){ status.textContent='❌ 无效的 JWT 格式'; status.className='jwt-status jwt-expired'; results.innerHTML=''; return; }
        const st=this.getStatus(jwt.payload);
        status.textContent=st.text;
        status.className='jwt-status '+st.cls;

        const headerRows=Object.entries(jwt.header).map(([k,v])=>`<div class="jwt-kv"><span class="k">${k}</span><span class="v v-pink">${typeof v==='object'?JSON.stringify(v):v}</span></div>`).join('');
        const payloadRows=Object.entries(jwt.payload).map(([k,v])=>{
          let cls='';
          if(k==='exp'||k==='nbf'||k==='iat') cls='v-blue';
          return `<div class="jwt-kv"><span class="k">${k}</span><span class="v ${cls}">${typeof v==='object'?JSON.stringify(v):(k==='exp'||k==='nbf'||k==='iat')?v+' → '+this.formatTime(v):v}</span></div>`;
        }).join('');

        results.innerHTML=`
          <div class="jwt-section"><h4>📋 Header <button class="jwt-copy" onclick="navigator.clipboard.writeText(document.querySelector('.jwt-card').dataset.header)">复制</button></h4>
            <div class="jwt-card" data-header='${JSON.stringify(jwt.header)}'>${headerRows}</div></div>
          <div class="jwt-section"><h4>📦 Payload <button class="jwt-copy" onclick="navigator.clipboard.writeText(document.querySelector('[data-payload]').dataset.payload)">复制</button></h4>
            <div class="jwt-card" data-payload='${JSON.stringify(jwt.payload)}'>${payloadRows}</div></div>
          <div class="jwt-section"><h4>🔏 Signature</h4>
            <div class="jwt-card"><div class="jwt-kv"><span class="k">签名</span><span class="v" style="font-size:0.75em;color:#666">${jwt.signature}</span></div></div></div>`;
      }catch(e){
        status.textContent='❌ 解析失败: '+e.message;
        status.className='jwt-status jwt-expired';
        results.innerHTML='';
      }
    }
  };
  if(typeof window!=='undefined') window.JwtDecoder=JwtDecoder;
})();
