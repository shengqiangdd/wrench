/**
 * Emoji 选择器插件
 * 搜索浏览完整 Emoji 表情库，分类筛选，点击复制
 */
(function(){
  const EmojiPicker={
    id:'emoji-picker', name:'Emoji 选择器',
    categories:{
      '😀 表情': ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
      '👋 手势': ['👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪'],
      '💕 爱心': ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','💋'],
      '🐱 动物': ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭'],
      '🍎 食物': ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🥑','🍆','🫑','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🫘','🥜','🫛','🍞','🥐','🥖','🫓','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🫔','🥙','🧆','🥚','🍳','🥘','🍲','🫕','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🥮','🍡','🥟','🥠','🥡','🦀','🦞','🦐','🦑','🦪','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🫖','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🫗','🧋','🧃','🧉','🧊'],
      '⚽ 活动': ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','🎯','🪀','🪁','🎮','🕹️','🎰','🎲','🧩','♟️','🎭','🎨','🧵','🧶','🎪','🎤','🎧','🎼','🎹','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪'],
      '🚗 旅行': ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🛵','🏍️','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','🛞','⛽','🛞','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🌍','🌎','🌏','🗺️','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽','⛪','🕌','🛕','🕍','⛩️','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','🌌','🎠','🛝','🎡','🎢','💈','🎪','🚂','🚃','🚄','🚅','🚆','🚇','🚈','🚉','🚊','🚝','🚞','🚋','🚌','🚍','🚎','🚐','🚑','🚒','🚓','🚔','🚕','🚖','🚗','🚘','🚙','🚚','🚛','🚜','🏍️','🛵','🚲','🛴','🛺','🛹','🛼','🚏','🛣️','🛤️','🛞','⛽','🚨','🚥','🚦','🛑','🚧','⚓','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸'],
      '💡 物品': ['💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔩','⚙️','🗜️','⛏️','⚒️','🛠️','🗡️','⚔️','🔫','🪃','🏹','🛡️','🪚','🔧','🪛','🔩','⚙️','🗜️','⚖️','🦯','🔗','⛓️','🪝','🧰','🪛','🧲','🪜','📦','📫','📪','📬','📭','📮','🗳️','✏️','✒️','🖊️','🖋️','📝','📁','📂','🗂️','📅','📆','🗒️','🗓️','📇','📈','📉','📊','📋','📌','📍','📎','🖇️','📏','📐','✂️','🗃️','🗄️','🗑️','🔒','🔓','🔏','🔐','🗝️','🔑','🪛'],
      '🔤 符号': ['❤️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','💠','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','🟥','🟧','🟨','🟩','🟦','🟪','⬛','⬜','🟫','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','⛎','🔀','🔁','🔂','▶️','⏩','⏭️','⏯️','◀️','⏪','⏮️','🔼','⏫','🔽','⏬','⏸️','⏹️','⏺️','⏏️','🎦','🔅','🔆','📶','🛜','📳','📴','♀️','♂️','⚧️','✖️','➕','➖','➗','🟰','♾️','‼️','⁉️','❓','❔','❕','❗','〰️','💱','💲','⚕️','♻️','⚜️','🔱','📛','🔰','⭕','✅','☑️','✔️','❌','❎','➰','➿','〽️','✳️','✴️','❇️','©️','®️','™️','#️⃣','*️⃣','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔠','🔡','🔢','🔣','🔤','🅰️','🆎','🅱️','🆑','🆒','🆓','ℹ️','🆔','Ⓜ️','🆕','🆖','🅾️','🆗','🅿️','🆘','🆙','🆚','🈁','🈂️','🈷️','🈶','🈯','🉐','🈹','🈚','🈲','🉑','🈸','🈴','🈳','㊗️','㊙️','🈺','🈵']
    },
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('emoji-panel',{title:'Emoji 选择器',icon:'smile',render:c=>this.renderPanel(c)});
      }
    },
    renderPanel(container){
      const catTabs=Object.keys(this.categories).map((c,i)=>`<button class="em-tab ${i===0?'active':''}" data-cat="${c}">${c.split(' ')[0]}</button>`).join('');
      container.innerHTML=`
        <div class="plugin-emoji">
          <input type="text" id="em-search" placeholder="🔍 搜索 Emoji（中文/英文/关键词）..." />
          <div class="em-tabs">${catTabs}</div>
          <div class="em-grid" id="em-grid"></div>
          <div class="em-preview" id="em-preview" style="display:none">
            <span class="em-big" id="em-big"></span>
            <div class="em-info" id="em-info"></div>
            <button class="em-copy" id="em-copy">📋 复制</button>
          </div>
          <div class="em-count" id="em-count"></div>
          <style>
            .plugin-emoji{padding:16px;}
            #em-search{width:100%;padding:8px 12px;background:#1a1d23;border:1px solid #3a3f47;border-radius:8px;color:#e0e0e0;font-size:0.9em;box-sizing:border-box;margin-bottom:10px;}
            #em-search:focus{border-color:#ff9800;outline:none;}
            .em-tabs{display:flex;gap:3px;flex-wrap:wrap;margin-bottom:10px;}
            .em-tab{padding:4px 8px;background:#1a1d23;border:1px solid #3a3f47;color:#888;border-radius:4px;cursor:pointer;font-size:0.85em;}
            .em-tab.active{background:#ff980022;color:#ff9800;border-color:#ff9800;}
            .em-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(38px,1fr));gap:3px;max-height:360px;overflow-y:auto;padding:4px;}
            .em-item{text-align:center;font-size:1.4em;padding:4px;cursor:pointer;border-radius:4px;transition:background 0.15s;line-height:1.2;}
            .em-item:hover{background:#ff980022;transform:scale(1.2);}
            .em-preview{display:flex;align-items:center;gap:12px;padding:10px;background:#1a1d23;border-radius:8px;margin-top:10px;}
            .em-big{font-size:2.5em;}
            .em-info{font-size:0.85em;color:#aaa;flex:1;}
            .em-info code{color:#ff9800;font-family:monospace;}
            .em-copy{padding:4px 12px;background:#ff9800;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.85em;}
            .em-count{text-align:center;color:#555;font-size:0.8em;margin-top:6px;}
          </style>
        </div>`;
      let activeCat=Object.keys(this.categories)[0];
      const render=(filter='')=>{
        const grid=document.getElementById('em-grid');
        let emojis=[];
        if(filter){
          for(const [cat,list] of Object.entries(this.categories)){
            emojis.push(...list.map(e=>({emoji:e,cat})));
          }
        }else{
          emojis=(this.categories[activeCat]||[]).map(e=>({emoji:e,cat:activeCat}));
        }
        grid.innerHTML=emojis.map(({emoji,cat})=>`<div class="em-item" data-emoji="${emoji}" data-cat="${cat}" title="${emoji}">${emoji}</div>`).join('');
        document.getElementById('em-count').textContent=`共 ${emojis.length} 个 Emoji`;
      };
      container.querySelectorAll('.em-tab').forEach(t=>t.addEventListener('click',()=>{
        container.querySelectorAll('.em-tab').forEach(b=>b.classList.remove('active'));t.classList.add('active');
        activeCat=t.dataset.cat;document.getElementById('em-search').value='';render();
      }));
      document.getElementById('em-search').addEventListener('input',e=>render(e.target.value));
      document.getElementById('em-grid').addEventListener('click',e=>{
        const item=e.target.closest('.em-item');if(!item)return;
        const emoji=item.dataset.emoji;
        document.getElementById('em-big').textContent=emoji;
        const code=[...emoji].map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' ');
        const names={'+1':'👍','-1':'👎','red_heart':'❤️','fire':'🔥','star':'⭐','sparkles':'✨','clap':'👏','wave':'👋','hundred':'💯'};
        document.getElementById('em-info').innerHTML=`${emoji} ${names[item.dataset.cat]||''}<br><code>${code}</code> | ${emoji.length} char(s)`;
        document.getElementById('em-preview').style.display='flex';
      });
      document.getElementById('em-copy').addEventListener('click',()=>{
        const emoji=document.getElementById('em-big').textContent;
        navigator.clipboard.writeText(emoji);
        const b=document.getElementById('em-copy');b.textContent='✅ 已复制';setTimeout(()=>b.textContent='📋 复制',1500);
      });
      render();
    }
  };
  if(typeof window!=='undefined') window.EmojiPicker=EmojiPicker;
})();
