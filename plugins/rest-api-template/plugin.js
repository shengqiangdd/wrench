/**
 * REST API 模板生成器插件
 * 生成 API 文档模板、cURL / fetch / axios 代码
 */
(function(){
  const RestApiTemplate={
    id:'rest-api-template', name:'REST API 模板生成器',
    methods:['GET','POST','PUT','PATCH','DELETE'],
    authTypes:['none','bearer','basic','api-key'],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('restapi-panel',{title:'REST API 模板生成器',icon:'terminal',render:c=>this.renderPanel(c)});
      }
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-restapi">
          <h3>🌐 REST API 模板生成器</h3>
          <div class="ra-form">
            <div class="ra-row"><label>方法</label><select id="ra-method">${this.methods.map(m=>`<option value="${m}">${m}</option>`).join('')}</select></div>
            <div class="ra-row"><label>URL</label><input id="ra-url" placeholder="https://api.example.com/users" value="https://api.example.com/users"></div>
            <div class="ra-row"><label>认证</label><select id="ra-auth">${this.authTypes.map(a=>`<option value="${a}">${a==='none'?'无':a==='bearer'?'Bearer Token':a==='basic'?'Basic Auth':'API Key'}</option>`).join('')}</select></div>
            <div class="ra-row" id="ra-token-row" style="display:none"><label>Token</label><input id="ra-token" placeholder="your-token-here"></div>
            <div class="ra-row" id="ra-apikey-row" style="display:none"><label>Key 名</label><input id="ra-keyname" placeholder="X-API-Key" value="X-API-Key"></div>
            <div class="ra-row"><label>Content-Type</label>
              <select id="ra-ctype"><option value="json">application/json</option><option value="form">multipart/form-data</option><option value="urlencoded">application/x-www-form-urlencoded</option><option value="text">text/plain</option></select>
            </div>
            <div class="ra-row"><label>Body</label></div>
            <textarea id="ra-body" rows="4" placeholder='{"name":"张三","email":"test@example.com"}'></textarea>
          </div>
          <button class="ra-gen" id="ra-gen">⚡ 生成代码</button>
          <div class="ra-tabs" id="ra-tabs" style="display:none">
            <button class="ra-tab active" data-tab="curl">cURL</button>
            <button class="ra-tab" data-tab="fetch">Fetch API</button>
            <button class="ra-tab" data-tab="axios">Axios</button>
            <button class="ra-tab" data-tab="python">Python</button>
          </div>
          <pre class="ra-output" id="ra-output"></pre>
          <button class="ra-copy" id="ra-copy">📋 复制代码</button>
          <style>
            .plugin-restapi{padding:16px;}
            .plugin-restapi h3{margin:0 0 10px;font-size:1.1em;}
            .ra-form{margin-bottom:12px;}
            .ra-row{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
            .ra-row label{color:#888;font-size:0.85em;min-width:80px;}
            .ra-row select,.ra-row input{flex:1;background:#1a1d23;border:1px solid #3a3f47;color:#c8ccd0;padding:5px 8px;border-radius:4px;font-size:0.85em;}
            .ra-row select{max-width:160px;}
            .ra-form textarea{width:100%;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;padding:8px;color:#c8ccd0;font-family:monospace;font-size:0.82em;resize:vertical;box-sizing:border-box;}
            .ra-form textarea:focus{border-color:#00bcd4;outline:none;}
            .ra-gen{width:100%;padding:8px;background:#00bcd4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9em;margin-bottom:10px;}
            .ra-gen:hover{background:#00acc1;}
            .ra-tabs{display:flex;gap:4px;margin-bottom:8px;}
            .ra-tab{padding:5px 12px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:4px;cursor:pointer;font-size:0.82em;}
            .ra-tab.active{background:#00bcd422;color:#00bcd4;border-color:#00bcd4;}
            .ra-output{background:#1a1d23;border-radius:8px;padding:12px;color:#c8ccd0;font-family:monospace;font-size:0.8em;white-space:pre-wrap;max-height:300px;overflow-y:auto;border:1px solid #3a3f47;}
            .ra-copy{margin-top:8px;padding:6px 14px;background:#00bcd4;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.85em;}
            .ra-copy:hover{background:#00acc1;}
          </style>
        </div>`;
      document.getElementById('ra-auth').addEventListener('change',e=>{
        document.getElementById('ra-token-row').style.display=e.target.value==='bearer'?'flex':'none';
        document.getElementById('ra-apikey-row').style.display=e.target.value==='api-key'?'flex':'none';
      });
      document.getElementById('ra-gen').addEventListener('click',()=>this.generate());
      document.querySelectorAll('.ra-tab').forEach(t=>t.addEventListener('click',()=>{
        document.querySelectorAll('.ra-tab').forEach(b=>b.classList.remove('active'));t.classList.add('active');
        this.currentTab=t.dataset.tab;this.showOutput();
      }));
      document.getElementById('ra-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('ra-output').textContent);
      });
      this.currentTab='curl';
      this.generate();
    },
    getParams(){
      return{
        method:document.getElementById('ra-method').value,
        url:document.getElementById('ra-url').value,
        auth:document.getElementById('ra-auth').value,
        token:document.getElementById('ra-token')?.value||'',
        keyname:document.getElementById('ra-keyname')?.value||'X-API-Key',
        ctype:document.getElementById('ra-ctype').value,
        body:document.getElementById('ra-body').value
      };
    },
    generate(){
      this.codes=this.buildCodes(this.getParams());
      document.getElementById('ra-tabs').style.display='flex';
      this.showOutput();
    },
    showOutput(){
      document.getElementById('ra-output').textContent=this.codes[this.currentTab]||'';
    },
    buildCodes(p){
      const ct={json:'application/json',form:'multipart/form-data',urlencoded:'application/x-www-form-urlencoded',text:'text/plain'}[p.ctype];
      const hasBody=['POST','PUT','PATCH'].includes(p.method);
      // cURL
      let curl=`curl -X ${p.method} '${p.url}'`;
      curl+=` \\\n  -H 'Content-Type: ${ct}'`;
      if(p.auth==='bearer'&&p.token) curl+=` \\\n  -H 'Authorization: Bearer ${p.token}'`;
      if(p.auth==='basic') curl+=` \\\n  -u 'username:password'`;
      if(p.auth==='api-key') curl+=` \\\n  -H '${p.keyname}: your-api-key'`;
      if(hasBody&&p.body) curl+=` \\\n  -d '${p.body.replace(/\n/g,'\\n')}'`;
      // Fetch
      let fetch=`const response = await fetch('${p.url}', {\n  method: '${p.method}',`;
      fetch+=`\n  headers: {`;
      fetch+=`\n    'Content-Type': '${ct}',`;
      if(p.auth==='bearer'&&p.token) fetch+=`\n    'Authorization': 'Bearer ${p.token}',`;
      if(p.auth==='api-key') fetch+=`\n    '${p.keyname}': 'your-api-key',`;
      fetch+=`\n  },`;
      if(hasBody&&p.body){
        if(p.ctype==='json') fetch+=`\n  body: JSON.stringify(${p.body}),`;
        else fetch+=`\n  body: ${p.body.startsWith('{')?p.body:`'${p.body}'`},`;
      }
      fetch+=`\n});\nconst data = await response.json();`;
      // Axios
      let axios=`import axios from 'axios';\n\n`;
      axios+=`const response = await axios({\n  method: '${p.method.toLowerCase()}',\n  url: '${p.url}',`;
      axios+=`\n  headers: {`;
      if(p.auth==='bearer'&&p.token) axios+=`\n    'Authorization': 'Bearer ${p.token}',`;
      if(p.auth==='api-key') axios+=`\n    '${p.keyname}': 'your-api-key',`;
      axios+=`\n  },`;
      if(hasBody&&p.body) axios+=`\n  data: ${p.body},`;
      axios+=`\n});`;
      // Python
      let py=`import requests\n\n`;
      py+=`response = requests.${p.method.toLowerCase()}(\n    '${p.url}',`;
      if(p.auth==='bearer'&&p.token) py+=`\n    headers={'Authorization': 'Bearer ${p.token}'},`;
      if(p.auth==='api-key') py+=`\n    headers={'${p.keyname}': 'your-api-key'},`;
      if(hasBody&&p.body){
        if(p.ctype==='json') py+=`\n    json=${p.body},`;
        else py+=`\n    data='${p.body}',`;
      }
      py+=`\n)\ndata = response.json()`;
      return{curl,fetch,axios,python:py};
    }
  };
  if(typeof window!=='undefined') window.RestApiTemplate=RestApiTemplate;
})();
