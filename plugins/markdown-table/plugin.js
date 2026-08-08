/**
 * Markdown 表格生成器插件
 * 可视化编辑表格，设置对齐，CSV 导入，一键导出 Markdown
 */
(function(){
  const MdTable={
    id:'markdown-table', name:'Markdown 表格生成器',
    data:[['列1','列2','列3'],['数据1','数据2','数据3'],['数据4','数据5','数据6']],
    aligns:['left','left','left'],
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('mdtable-panel',{title:'Markdown 表格生成器',icon:'table',render:c=>this.renderPanel(c)});
      }
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-mdtable">
          <h3>📊 Markdown 表格生成器</h3>
          <div class="mt-controls">
            <button class="mt-btn" id="mt-add-row">+ 添加行</button>
            <button class="mt-btn" id="mt-add-col">+ 添加列</button>
            <button class="mt-btn" id="mt-del-row">- 删除行</button>
            <button class="mt-btn" id="mt-del-col">- 删除列</button>
            <button class="mt-btn" id="mt-csv-import">📥 导入 CSV</button>
            <button class="mt-btn" id="mt-sample">📝 示例数据</button>
          </div>
          <div class="mt-editor-wrap">
            <div class="mt-editor" id="mt-editor"></div>
          </div>
          <h4>⚙️ 列对齐</h4>
          <div class="mt-aligns" id="mt-aligns"></div>
          <h4>📋 导出</h4>
          <div class="mt-actions">
            <button class="mt-btn mt-export" id="mt-export">复制 Markdown</button>
            <button class="mt-btn mt-export" id="mt-export-html">复制 HTML</button>
          </div>
          <pre class="mt-output" id="mt-output"></pre>
          <textarea id="mt-csv-input" style="display:none" placeholder="粘贴 CSV 数据..."></textarea>
          <div class="mt-csv-bar" id="mt-csv-bar" style="display:none">
            <button class="mt-btn" id="mt-csv-go">确认导入</button>
            <button class="mt-btn" id="mt-csv-cancel">取消</button>
          </div>
          <style>
            .plugin-mdtable{padding:16px;}
            .plugin-mdtable h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-mdtable h4{margin:14px 0 6px;font-size:0.9em;color:#888;}
            .mt-controls{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;}
            .mt-btn{padding:5px 10px;background:#1a1d23;border:1px solid #3a3f47;color:#aaa;border-radius:4px;cursor:pointer;font-size:0.82em;transition:all 0.15s;}
            .mt-btn:hover{border-color:#2196f3;color:#2196f3;}
            .mt-export{background:#2196f322;border-color:#2196f344;color:#2196f3;}
            .mt-editor-wrap{overflow-x:auto;margin-bottom:10px;}
            .mt-editor{display:inline-grid;gap:0;border:1px solid #3a3f47;border-radius:6px;overflow:hidden;}
            .mt-cell{padding:4px 8px;border-right:1px solid #2a2e35;border-bottom:1px solid #2a2e35;background:#1a1d23;min-width:80px;min-height:28px;}
            .mt-cell input{width:100%;background:transparent;border:none;color:#e0e0e0;font-size:0.85em;padding:2px 0;font-family:inherit;}
            .mt-cell input:focus{outline:none;color:#fff;}
            .mt-cell.header{background:#2a2e35;font-weight:600;}
            .mt-cell.header input{color:#2196f3;}
            .mt-aligns{display:flex;gap:8px;flex-wrap:wrap;}
            .mt-align-btn{padding:4px 10px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:4px;cursor:pointer;font-size:0.8em;}
            .mt-align-btn.active{border-color:#2196f3;color:#2196f3;background:#2196f322;}
            .mt-output{background:#1a1d23;border-radius:8px;padding:12px;color:#c8ccd0;font-family:monospace;font-size:0.8em;white-space:pre-wrap;max-height:250px;overflow-y:auto;border:1px solid #3a3f47;}
            #mt-csv-input{width:100%;min-height:80px;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;padding:8px;color:#c8ccd0;font-family:monospace;font-size:0.85em;resize:vertical;box-sizing:border-box;}
            .mt-csv-bar{display:flex;gap:6px;margin-top:6px;}
          </style>
        </div>`;
      document.getElementById('mt-add-row').addEventListener('click',()=>{this.data.push(new Array(this.data[0].length).fill(''));this.renderEditor();});
      document.getElementById('mt-add-col').addEventListener('click',()=>{this.data.forEach(r=>r.push(''));this.aligns.push('left');this.renderEditor();this.renderAligns();});
      document.getElementById('mt-del-row').addEventListener('click',()=>{if(this.data.length>1){this.data.pop();this.renderEditor();}});
      document.getElementById('mt-del-col').addEventListener('click',()=>{if(this.data[0].length>1){this.data.forEach(r=>r.pop());this.aligns.pop();this.renderEditor();this.renderAligns();}});
      document.getElementById('mt-sample').addEventListener('click',()=>{
        this.data=[['功能','状态','优先级','负责人'],['用户登录','✅ 已完成','P0','张三'],['数据导出','🔄 进行中','P1','李四'],['暗黑模式','📋 待开始','P2','王五']];
        this.aligns=['left','center','center','center'];
        this.renderEditor();this.renderAligns();
      });
      document.getElementById('mt-csv-import').addEventListener('click',()=>{
        const el=document.getElementById('mt-csv-input');
        const bar=document.getElementById('mt-csv-bar');
        el.style.display=el.style.display==='none'?'block':'none';
        bar.style.display=el.style.display;
      });
      document.getElementById('mt-csv-go').addEventListener('click',()=>{
        const csv=document.getElementById('mt-csv-input').value;
        if(!csv.trim())return;
        const lines=csv.trim().split('\n').map(l=>l.split(/[,\t]/).map(c=>c.trim()));
        if(lines.length>0){this.data=lines;this.aligns=lines[0].map(()=>'left');}
        this.renderEditor();this.renderAligns();
        document.getElementById('mt-csv-input').style.display='none';
        document.getElementById('mt-csv-bar').style.display='none';
      });
      document.getElementById('mt-csv-cancel').addEventListener('click',()=>{
        document.getElementById('mt-csv-input').style.display='none';
        document.getElementById('mt-csv-bar').style.display='none';
      });
      document.getElementById('mt-export').addEventListener('click',()=>{
        navigator.clipboard.writeText(this.toMarkdown());
        const b=document.getElementById('mt-export');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='复制 Markdown',1500);
      });
      document.getElementById('mt-export-html').addEventListener('click',()=>{
        navigator.clipboard.writeText(this.toHtml());
        const b=document.getElementById('mt-export-html');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='复制 HTML',1500);
      });
      this.renderEditor();this.renderAligns();this.updateOutput();
    },
    renderEditor(){
      const cols=this.data[0]?.length||3;
      const editor=document.getElementById('mt-editor');
      editor.style.gridTemplateColumns=`repeat(${cols},minmax(80px,1fr))`;
      editor.innerHTML='';
      this.data.forEach((row,ri)=>{
        row.forEach((cell,ci)=>{
          const div=document.createElement('div');
          div.className='mt-cell'+(ri===0?' header':'');
          const input=document.createElement('input');
          input.value=cell;
          input.addEventListener('input',e=>{this.data[ri][ci]=e.target.value;this.updateOutput();});
          div.appendChild(input);
          editor.appendChild(div);
        });
      });
      this.updateOutput();
    },
    renderAligns(){
      const el=document.getElementById('mt-aligns');
      el.innerHTML=this.aligns.map((a,i)=>
        `<div><span style="color:#888;font-size:0.8em;">列${i+1}:</span>
        ${['left','center','right'].map(al=>`<button class="mt-align-btn ${a===al?'active':''}" data-col="${i}" data-align="${al}">${al==='left'?'左':al==='center'?'中':'右'}</button>`).join('')}</div>`
      ).join('');
      el.querySelectorAll('.mt-align-btn').forEach(b=>b.addEventListener('click',()=>{
        this.aligns[parseInt(b.dataset.col)]=b.dataset.align;
        this.renderAligns();this.updateOutput();
      }));
    },
    updateOutput(){
      document.getElementById('mt-output').textContent=this.toMarkdown();
    },
    toMarkdown(){
      if(this.data.length===0)return'';
      const cols=this.data[0].length;
      const widths=new Array(cols).fill(0);
      this.data.forEach(row=>row.forEach((c,i)=>{widths[i]=Math.max(widths[i],c.length);}));
      const pad=(s,w)=>{
        const len=s.length;
        if(this.aligns[0]==='right') return s.padStart(w);
        return s.padEnd(w);
      };
      const lines=this.data.map((row,ri)=>{
        return '| '+row.map((c,i)=>pad(c,widths[i])).join(' | ')+' |';
      });
      const sep='| '+this.aligns.map((a,i)=>{
        const w=widths[i];
        if(a==='left') return ':'.padEnd(2,'-').padEnd(w,'-');
        if(a==='right') return ':'.padEnd(w,'-')+':';
        return ':'.padEnd(2,'-').padEnd(w,'-')+':';
      }).join(' | ')+' |';
      lines.splice(1,0,sep);
      return lines.join('\n');
    },
    toHtml(){
      if(this.data.length===0)return'';
      let html='<table>\n<thead>\n<tr>\n';
      this.data[0].forEach(h=>{html+=`<th style="text-align:${this.aligns[0]}">${h}</th>\n`;});
      html+='</tr>\n</thead>\n<tbody>\n';
      for(let i=1;i<this.data.length;i++){
        html+='<tr>\n';
        this.data[i].forEach((c,j)=>{html+=`<td style="text-align:${this.aligns[j]||'left'}">${c}</td>\n`;});
        html+='</tr>\n';
      }
      html+='</tbody>\n</table>';
      return html;
    }
  };
  if(typeof window!=='undefined') window.MdTable=MdTable;
})();
