/**
 * JSON Schema 验证器插件
 * JSON Schema Draft-07 验证，错误定位，Schema 自动生成
 */
(function(){
  const JsonSchemaValidator={
    id:'json-schema-validator', name:'JSON Schema 验证器',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('jsonschema-panel',{title:'JSON Schema 验证器',icon:'check-square',render:c=>this.renderPanel(c)});
      }
    },
    // 简化版 JSON Schema 验证器（Draft-07 子集）
    validate(data,schema,path=''){
      const errors=[];
      if(schema.type){
        const types=Array.isArray(schema.type)?schema.type:[schema.type];
        const actual=Array.isArray(data)?'array':data===null?'null':typeof data;
        if(!types.includes(actual)) errors.push({path:path||'root',message:`期望类型 ${types.join('|')}，实际 ${actual}`});
      }
      if(schema.properties&&typeof data==='object'&&data!==null&&!Array.isArray(data)){
        for(const[key,propSchema]of Object.entries(schema.properties)){
          if(key in data){
            errors.push(...this.validate(data[key],propSchema,path?path+'.'+key:key));
          }else if(schema.required&&schema.required.includes(key)){
            errors.push({path:path?path+'.'+key:key,message:`缺少必需字段 "${key}"`});
          }
        }
        if(schema.additionalProperties===false){
          const allowed=Object.keys(schema.properties);
          for(const key of Object.keys(data)){
            if(!allowed.includes(key)) errors.push({path:path?path+'.'+key:key,message:`不允许的字段 "${key}"`});
          }
        }
      }
      if(Array.isArray(data)&&schema.items){
        data.forEach((item,i)=>{errors.push(...this.validate(item,schema.items,path?`${path}[${i}]`:`[${i}]`));});
      }
      if(typeof data==='string'){
        if(schema.minLength!==undefined&&data.length<schema.minLength) errors.push({path,message:`最小长度 ${schema.minLength}，实际 ${data.length}`});
        if(schema.maxLength!==undefined&&data.length>schema.maxLength) errors.push({path,message:`最大长度 ${schema.maxLength}，实际 ${data.length}`});
        if(schema.pattern&&!new RegExp(schema.pattern).test(data)) errors.push({path,message:`不匹配正则 ${schema.pattern}`});
        if(schema.format){
          const fmts={email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/,uri:/^https?:\/\//,date:/^\d{4}-\d{2}-\d{2}$/,'date-time':/^\d{4}-\d{2}-\d{2}T/};
          if(fmts[schema.format]&&!fmts[schema.format].test(data)) errors.push({path,message:`不匹配格式 ${schema.format}`});
        }
      }
      if(typeof data==='number'){
        if(schema.minimum!==undefined&&data<schema.minimum) errors.push({path,message:`最小值 ${schema.minimum}，实际 ${data}`});
        if(schema.maximum!==undefined&&data>schema.maximum) errors.push({path,message:`最大值 ${schema.maximum}，实际 ${data}`});
        if(schema.multipleOf&&data/schema.multipleOf%1!==0) errors.push({path,message:`必须是 ${schema.multipleOf} 的倍数`});
        if(schema.enum&&!schema.enum.includes(data)) errors.push({path,message:`值必须是 [${schema.enum.join(', ')}] 之一`});
      }
      if(schema.enum&&typeof data!=='number') {
        if(!schema.enum.includes(data)) errors.push({path,message:`值必须是 [${schema.enum.map(v=>JSON.stringify(v)).join(', ')}] 之一`});
      }
      if(schema.const!==undefined&&data!==schema.const) errors.push({path,message:`值必须等于 ${JSON.stringify(schema.const)}`});
      if(schema.allOf){schema.allOf.forEach(s=>{errors.push(...this.validate(data,s,path));});}
      if(schema.anyOf){
        const allErrs=schema.anyOf.map(s=>this.validate(data,s,path));
        if(allErrs.every(e=>e.length>0)) errors.push({path,message:'不匹配 anyOf 中的任何 schema'});
      }
      if(schema.oneOf){
        const matchCount=schema.oneOf.filter(s=>this.validate(data,s,path).length===0).length;
        if(matchCount!==1) errors.push({path,message:`恰好匹配 oneOf 中的 1 个，实际匹配 ${matchCount} 个`});
      }
      if(schema.not){
        if(this.validate(data,schema.not,path).length===0) errors.push({path,message:'不匹配 not 中的 schema'});
      }
      return errors;
    },
    generateSchema(data){
      if(data===null) return {type:'null'};
      if(Array.isArray(data)){
        return {type:'array',items:data.length>0?this.generateSchema(data[0]):{}};
      }
      if(typeof data==='object'){
        const props={};
        for(const[k,v]of Object.entries(data)){props[k]=this.generateSchema(v);}
        return {type:'object',properties:props,required:Object.keys(props)};
      }
      if(typeof data==='number'){
        return Number.isInteger(data)?{type:'integer'}:{type:'number'};
      }
      return {type:typeof data};
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-jsonschema">
          <div class="js-tabs">
            <button class="js-tab active" data-mode="validate">✅ 验证模式</button>
            <button class="js-tab" data-mode="generate">🔧 生成 Schema</button>
          </div>
          <div id="js-validate-mode">
            <div class="js-panels">
              <div class="js-panel"><label>JSON 数据</label><textarea id="js-data" rows="12" placeholder='{"name":"张三","age":25,"email":"test@example.com"}'></textarea></div>
              <div class="js-panel"><label>JSON Schema</label><textarea id="js-schema" rows="12" placeholder='{"type":"object","properties":{...},"required":["name"]}'></textarea></div>
            </div>
            <button class="js-go" id="js-validate-btn">🔍 验证</button>
          </div>
          <div id="js-generate-mode" style="display:none">
            <div class="js-panel"><label>输入 JSON 数据（自动生成 Schema）</label><textarea id="js-gen-data" rows="10" placeholder="粘贴 JSON 数据..."></textarea></div>
            <button class="js-go" id="js-gen-btn">🔧 生成 Schema</button>
            <div class="js-panel" style="margin-top:10px"><label>生成的 Schema <button class="js-copy" id="js-gen-copy">📋 复制</button></label>
              <textarea id="js-gen-output" rows="10" readonly></textarea></div>
          </div>
          <div class="js-results" id="js-results"></div>
          <style>
            .plugin-jsonschema{padding:16px;}
            .js-tabs{display:flex;gap:4px;margin-bottom:12px;}
            .js-tab{padding:6px 14px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .js-tab.active{background:#4caf5022;color:#4caf50;border-color:#4caf50;}
            .js-panels{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
            .js-panel{display:flex;flex-direction:column;}
            .js-panel label{color:#888;font-size:0.85em;margin-bottom:4px;display:flex;justify-content:space-between;}
            .js-panel textarea{flex:1;min-height:200px;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;padding:10px;color:#c8ccd0;font-family:monospace;font-size:0.82em;resize:vertical;}
            .js-panel textarea:focus{border-color:#4caf50;outline:none;}
            .js-go{margin:10px 0;padding:8px 20px;background:#4caf50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .js-go:hover{background:#43a047;}
            .js-results{margin-top:12px;background:#1a1d23;border-radius:8px;padding:12px;border:1px solid #3a3f47;}
            .js-ok{color:#4caf50;font-size:0.9em;}
            .js-err{color:#f44336;font-size:0.85em;padding:3px 0;border-bottom:1px solid #2a2e35;}
            .js-err:last-child{border-bottom:none;}
            .js-err .path{color:#ff9800;font-family:monospace;}
            .js-copy{padding:2px 8px;background:#3a3f47;border:none;color:#aaa;border-radius:3px;cursor:pointer;font-size:0.8em;}
            .js-copy:hover{background:#4caf5033;color:#4caf50;}
            @media(max-width:700px){.js-panels{grid-template-columns:1fr;}}
          </style>
        </div>`;
      container.querySelectorAll('.js-tab').forEach(t=>t.addEventListener('click',()=>{
        container.querySelectorAll('.js-tab').forEach(b=>b.classList.remove('active'));t.classList.add('active');
        document.getElementById('js-validate-mode').style.display=t.dataset.mode==='validate'?'':'none';
        document.getElementById('js-generate-mode').style.display=t.dataset.mode==='generate'?'':'none';
      }));
      document.getElementById('js-validate-btn').addEventListener('click',()=>this.doValidate());
      document.getElementById('js-gen-btn').addEventListener('click',()=>{
        try{
          const data=JSON.parse(document.getElementById('js-gen-data').value);
          const schema=this.generateSchema(data);
          document.getElementById('js-gen-output').value=JSON.stringify(schema,null,2);
        }catch(e){document.getElementById('js-gen-output').value='❌ JSON 解析错误: '+e.message;}
      });
      document.getElementById('js-gen-copy').addEventListener('click',()=>{
        navigator.clipboard.writeText(document.getElementById('js-gen-output').value);
      });
    },
    doValidate(){
      const results=document.getElementById('js-results');
      try{
        const data=JSON.parse(document.getElementById('js-data').value);
        const schema=JSON.parse(document.getElementById('js-schema').value);
        const errors=this.validate(data,schema);
        if(errors.length===0){
          results.innerHTML='<div class="js-ok">✅ 验证通过！数据完全符合 Schema 定义。</div>';
        }else{
          results.innerHTML=`<div style="color:#f44;font-size:0.9em;margin-bottom:6px;">❌ 发现 ${errors.length} 个错误：</div>`+
            errors.map(e=>`<div class="js-err"><span class="path">${e.path}</span>: ${e.message}</div>`).join('');
        }
      }catch(e){
        results.innerHTML=`<div style="color:#f44">❌ 解析错误: ${e.message}</div>`;
      }
    }
  };
  if(typeof window!=='undefined') window.JsonSchemaValidator=JsonSchemaValidator;
})();
