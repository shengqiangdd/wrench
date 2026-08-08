/**
 * 正则构建器插件
 * 交互式点击组件拼装正则，实时预览，代码导出
 */
(function(){
  const RegexBuilder={
    id:'regex-builder', name:'正则构建器',
    tokens:[],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('regexbuild-panel',{title:'正则构建器',icon:'regex',render:c=>this.renderPanel(c)});
      }
    },
    components:[
      {cat:'字符类',items:[
        {label:'任意字符',token:'.',desc:'匹配除换行外的任意字符'},
        {label:'数字',token:'\\d',desc:'等价 [0-9]'},
        {label:'非数字',token:'\\D',desc:'等价 [^0-9]'},
        {label:'字母/数字/_',token:'\\w',desc:'等价 [a-zA-Z0-9_]'},
        {label:'非字母数字',token:'\\W',desc:'等价 [^a-zA-Z0-9_]'},
        {label:'空白',token:'\\s',desc:'空格、制表符等'},
        {label:'非空白',token:'\\S',desc:'非空白字符'},
      ]},
      {cat:'量词',items:[
        {label:'0 或 1',token:'?',desc:'可选'},
        {label:'0+',token:'*',desc:'零或多个'},
        {label:'1+',token:'+',desc:'一个或多个'},
        {label:'{n}',token:'{n}',desc:'恰好 n 次',input:true},
        {label:'{n,}',token:'{n,}',desc:'至少 n 次',input:true},
        {label:'{n,m}',token:'{n,m}',desc:'n 到 m 次',input:true},
      ]},
      {cat:'分组/引用',items:[
        {label:'分组 (...)',token:'(...)',desc:'捕获分组',wrap:true},
        {label:'非捕获 (?:...)',token:'(?:...)',desc:'非捕获分组',wrap:true},
        {label:'或 |',token:'|',desc:'或运算'},
        {label:'转义 \\',token:'\\',desc:'转义特殊字符',escape:true},
      ]},
      {cat:'位置/边界',items:[
        {label:'行首',token:'^',desc:'字符串/行开头'},
        {label:'行尾',token:'$',desc:'字符串/行结尾'},
        {label:'单词边界',token:'\\b',desc:'单词开始/结束'},
        {label:'非单词边界',token:'\\B',desc:'非单词边界'},
      ]},
      {cat:'常用预设',items:[
        {label:'📧 邮箱',token:'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',desc:'常见邮箱格式'},
        {label:'📱 手机号',token:'1[3-9]\\d{9}',desc:'中国手机号'},
        {label:'🔗 URL',token:'https?://[\\w.-]+(?:/[\\w./?#&-]*)?',desc:'HTTP/HTTPS URL'},
        {label:'🔢 IP地址',token:'\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',desc:'IPv4 地址'},
        {label:'📅 日期',token:'\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}',desc:'YYYY-MM-DD'},
        {label:'🕐 时间',token:'\\d{1,2}:\\d{2}(?::\\d{2})?',desc:'HH:MM 或 HH:MM:SS'},
        {label:'🆔 中文名',token:'[\\u4e00-\\u9fff]{2,4}',desc:'2-4 个汉字'},
      ]},
    ],
    renderPanel(container){
      this.tokens=[];
      const compHtml=this.components.map(cat=>{
        const items=cat.items.map(item=>`<button class="rb-chip" data-token="${item.token.replace(/"/g,'&quot;')}" data-label="${item.label}" data-wrap="${item.wrap||''}" data-escape="${item.escape||''}" data-input="${item.input||''}" title="${item.desc}">${item.label}</button>`).join('');
        return `<div class="rb-cat"><div class="rb-cat-title">${cat.cat}</div><div class="rb-items">${items}</div></div>`;
      }).join('');
      container.innerHTML=`
        <div class="plugin-regex-build">
          <h3>🧩 正则构建器</h3>
          <div class="rb-comps">${compHtml}</div>
          <div class="rb-workspace">
            <div class="rb-regex-line">
              <span class="rb-slash">/</span>
              <span class="rb-pattern" id="rb-pattern"></span>
              <span class="rb-slash">/</span>
              <span class="rb-flags" id="rb-flags">g</span>
            </div>
            <div class="rb-tokens" id="rb-tokens">
              <div class="rb-empty">👆 点击上方组件添加到正则</div>
            </div>
            <div class="rb-actions">
              <button class="rb-btn rb-add-group" id="rb-undo">↩ 撤销</button>
              <button class="rb-btn rb-clear" id="rb-clear">🗑 清空</button>
              <button class="rb-btn rb-flag-toggle" id="rb-g">g</button>
              <button class="rb-btn rb-flag-toggle" id="rb-i">i</button>
              <button class="rb-btn rb-flag-toggle" id="rb-m">m</button>
              <button class="rb-btn rb-flag-toggle" id="rb-s">s</button>
              <button class="rb-btn rb-copy" id="rb-copy">📋 复制</button>
            </div>
          </div>
          <div class="rb-test">
            <h4>🧪 测试文本</h4>
            <textarea id="rb-test" rows="3" placeholder="输入测试文本..."></textarea>
            <div class="rb-matches" id="rb-matches"></div>
          </div>
          <div class="rb-export" id="rb-export"></div>
          <style>
            .plugin-regex-build{padding:16px;}
            .plugin-regex-build h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-regex-build h4{margin:14px 0 6px;font-size:0.9em;color:#888;}
            .rb-comps{margin-bottom:14px;}
            .rb-cat{margin-bottom:8px;}
            .rb-cat-title{font-size:0.8em;color:#888;margin-bottom:3px;}
            .rb-items{display:flex;flex-wrap:wrap;gap:4px;}
            .rb-chip{padding:3px 8px;background:#1a1d23;border:1px solid #3a3f47;color:#c8ccd0;border-radius:4px;cursor:pointer;font-size:0.78em;font-family:monospace;transition:all 0.15s;}
            .rb-chip:hover{border-color:#e91e63;color:#e91e63;background:#e91e6311;}
            .rb-workspace{background:#1a1d23;border-radius:8px;padding:12px;margin-bottom:14px;border:1px solid #3a3f47;}
            .rb-regex-line{font-family:monospace;font-size:1.3em;color:#e91e63;margin-bottom:8px;display:flex;align-items:center;}
            .rb-slash{color:#666;}
            .rb-pattern{margin:0 2px;min-width:20px;color:#e91e63;word-break:break-all;}
            .rb-flags{color:#ff9800;margin-left:2px;}
            .rb-tokens{min-height:30px;padding:6px 0;border-top:1px solid #2a2e35;}
            .rb-empty{color:#555;font-size:0.85em;}
            .rb-token{display:inline-block;padding:2px 6px;background:#e91e6322;border:1px solid #e91e6344;border-radius:3px;margin:2px;font-family:monospace;font-size:0.8em;color:#e91e63;cursor:pointer;}
            .rb-token:hover{background:#f4433622;border-color:#f44336;}
            .rb-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;}
            .rb-btn{padding:4px 10px;background:#2a2e35;border:1px solid #3a3f47;color:#aaa;border-radius:4px;cursor:pointer;font-size:0.8em;transition:all 0.15s;}
            .rb-btn:hover{background:#e91e6322;color:#e91e63;border-color:#e91e63;}
            .rb-btn.active{background:#e91e6322;color:#e91e63;border-color:#e91e63;}
            .rb-flag-toggle{font-family:monospace;font-weight:700;}
            .rb-test textarea{width:100%;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;padding:8px;color:#c8ccd0;font-family:monospace;font-size:0.85em;resize:vertical;box-sizing:border-box;}
            .rb-test textarea:focus{border-color:#e91e63;outline:none;}
            .rb-matches{margin-top:6px;font-size:0.85em;color:#c8ccd0;max-height:120px;overflow-y:auto;}
            .rb-match{padding:2px 0;border-bottom:1px solid #2a2e35;font-family:monospace;}
            .rb-match em{background:#e91e6344;color:#e91e63;font-style:normal;padding:0 2px;border-radius:2px;}
            .rb-export{background:#1a1d23;border-radius:6px;padding:10px;font-family:monospace;font-size:0.85em;color:#888;margin-top:10px;white-space:pre-wrap;cursor:pointer;}
            .rb-export:hover{color:#e91e63;}
          </style>
        </div>`;
      // 标记活动 flags
      ['g','i','m','s'].forEach(f=>{
        if('g'.includes(f)) document.getElementById('rb-'+f).classList.add('active');
      });
      // 组件点击
      container.querySelectorAll('.rb-chip').forEach(chip=>{
        chip.addEventListener('click',()=>{
          const token=chip.dataset.token;
          const wrap=chip.dataset.wrap==='true';
          const escape=chip.dataset.escape==='true';
          const input=chip.dataset.input==='true';
          if(wrap){
            this.tokens.push({text:token.replace('...',''),wrap:true});
          }else if(input){
            const val=prompt('请输入值（如 3,5 或 10）:',token.replace(/[{}]/g,''));
            if(val!==null) this.tokens.push({text:token.replace('n',val.split(',')[0]||'0').replace('m',val.split(',')[1]||'0'),input:true});
          }else if(escape){
            const val=prompt('请输入要转义的字符:');
            if(val!==null) this.tokens.push({text:'\\'+val});
          }else{
            this.tokens.push({text:token});
          }
          this.update();
        });
      });
      document.getElementById('rb-undo').addEventListener('click',()=>{this.tokens.pop();this.update();});
      document.getElementById('rb-clear').addEventListener('click',()=>{this.tokens=[];this.update();});
      ['g','i','m','s'].forEach(f=>{
        document.getElementById('rb-'+f).addEventListener('click',e=>{
          e.target.classList.toggle('active');
          this.update();
        });
      });
      document.getElementById('rb-copy').addEventListener('click',()=>{
        const pattern=this.getPattern();
        const flags=this.getFlags();
        navigator.clipboard.writeText(pattern+'/'+flags);
        const b=document.getElementById('rb-copy');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='📋 复制',1500);
      });
      document.getElementById('rb-test').addEventListener('input',()=>this.testRegex());
      document.getElementById('rb-tokens').addEventListener('click',e=>{
        const t=e.target.closest('.rb-token');
        if(!t)return;
        const idx=[...t.parentNode.children].indexOf(t);
        if(confirm(`删除 "${t.textContent}"？`)){this.tokens.splice(idx,1);this.update();}
      });
      this.update();
    },
    getPattern(){return this.tokens.map(t=>t.text).join('');},
    getFlags(){return['g','i','m','s'].filter(f=>document.getElementById('rb-'+f)?.classList.contains('active')).join('');},
    update(){
      const pattern=this.getPattern();
      const flags=this.getFlags();
      document.getElementById('rb-pattern').textContent=pattern||'空';
      document.getElementById('rb-flags').textContent=flags;
      document.getElementById('rb-tokens').innerHTML=this.tokens.length===0?'<div class="rb-empty">👆 点击上方组件添加到正则</div>':
        this.tokens.map(t=>`<span class="rb-token" title="点击删除">${t.text}</span>`).join('');
      document.getElementById('rb-export').textContent=pattern?`// JavaScript\nconst regex = /${pattern}/${flags};\n\n// Python\nimport re\nregex = re.compile(r'${pattern}', re.${flags.includes('g')?'MULTILINE':flags.includes('i')?'IGNORECASE':flags.includes('m')?'MULTILINE':''})`:'// 在上方点击组件开始构建正则';
      this.testRegex();
    },
    testRegex(){
      const pattern=this.getPattern();
      const flags=this.getFlags();
      const text=document.getElementById('rb-test').value;
      const el=document.getElementById('rb-matches');
      if(!pattern||!text){el.innerHTML='';return;}
      try{
        const regex=new RegExp(pattern,flags);
        const matches=[];
        let m;
        if(flags.includes('g')){
          while((m=regex.exec(text))!==null){
            matches.push({value:m[0],index:m.index});
            if(!m[0])break;
          }
        }else{
          m=regex.exec(text);
          if(m) matches.push({value:m[0],index:m.index});
        }
        el.innerHTML=matches.length===0?'<div style="color:#f44">无匹配</div>':
          matches.map(m=>`<div class="rb-match"><span style="color:#888">[${m.index}]</span> <em>${m.value}</em></div>`).join('');
      }catch(e){
        el.innerHTML=`<div style="color:#f44">⚠️ ${e.message}</div>`;
      }
    }
  };
  if(typeof window!=='undefined') window.RegexBuilder=RegexBuilder;
})();
