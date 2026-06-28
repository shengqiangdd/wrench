const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Cq6mMs93.js","assets/rolldown-runtime-b3L32Ng1.js","assets/vendor-lucide-wK0RyqBw.js","assets/vendor-router-C6ylH-cM.js","assets/vendor-state-BDyL0Ic5.js","assets/index-BTaecXSC.css"])))=>i.map(i=>d[i]);
import{r as G}from"./rolldown-runtime-b3L32Ng1.js";import{C as O,E as X,Et as I,It as W,Lt as D,Rt as J,U as q,_ as U,et as K,f as F,lt as B,n as H,o as V,tt as Y,ut as Q,x as Z}from"./vendor-lucide-wK0RyqBw.js";import{i as ee}from"./vendor-router-C6ylH-cM.js";import{a as te,i as $,r as z}from"./index-Cq6mMs93.js";import{n as se}from"./websocket-PwStSdX1.js";var r=G(J(),1);async function ae(){try{const n=await fetch("/api/plugins");if(!n.ok)throw new Error(`HTTP ${n.status}: ${n.statusText}`);return(await n.json()).plugins||[]}catch(n){return console.error("[PluginManager] Failed to fetch plugins:",n),[]}}async function ne(n){const b=await fetch(n);if(!b.ok)throw new Error(`Failed to load plugin JS: HTTP ${b.status}`);return await b.text()}function re(n){z.getState().unregisterPlugin(n),$.unregister(n)}var e=te(),A=null;function M(){return A||ee(()=>import("./index-Cq6mMs93.js").then(n=>n.t).then(n=>{A=n.useFileStore}),__vite__mapDeps([0,1,2,3,4,5])),A}function le({manifest:n,pluginCode:b,onReady:d,onCommandRegistered:k,onPanelRegistered:j,onNotification:S,onError:p,editorContent:R,editorLanguage:P}){const m=(0,r.useRef)(null),[_,C]=(0,r.useState)(!1),[L,N]=(0,r.useState)(!0),[w,E]=(0,r.useState)(null);(0,r.useRef)(new Map);const T=(0,r.useRef)(null),h=(0,r.useRef)(null),s=(0,r.useRef)(!1),i=(0,r.useCallback)(()=>{const a=`
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: transparent; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #e2e8f0; overflow: auto; }
        #plugin-root { min-height: 100%; padding: 4px; }
      </style>
    `,o=JSON.stringify(n.id);return`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">${a}</head><body><div id="plugin-root"></div><script>${`
(function() {
  'use strict';

  var messageSeq = 0;
  var pendingCalls = {};
  var isRegistered = false;

  function sendToHost(type, payload) {
    var seq = ++messageSeq;
    window.parent.postMessage({
      source: 'smartbox-plugin-sandbox',
      pluginId: ${o},
      seq: seq,
      type: type,
      payload: payload || {}
    }, '*');
    return seq;
  }

  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === 'smartbox-host') {
      var msg = event.data;
      if (msg.seq && pendingCalls[msg.seq]) {
        var pending = pendingCalls[msg.seq];
        clearTimeout(pending.timer);
        delete pendingCalls[msg.seq];
        if (msg.error) { pending.reject(new Error(msg.error)); }
        else { pending.resolve(msg.result); }
      }
    }
  });

  // ── 受限 localStorage ──
  var STORAGE_PREFIX = 'smartbox_plugin_' + ${o} + '_';
  var MAX_STORAGE = 51200;

  function getStorageUsage() {
    var total = 0;
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) { total += (key.length + (localStorage.getItem(key) || '').length); }
    }
    return total;
  }

  var sandboxStorage = {
    getItem: function(key) { try { return localStorage.getItem(STORAGE_PREFIX + key); } catch(e) { return null; } },
    setItem: function(key, value) {
      try {
        var fullKey = STORAGE_PREFIX + key;
        var oldVal = localStorage.getItem(fullKey);
        var oldLen = oldVal ? oldVal.length : 0;
        var newLen = value ? value.length : 0;
        var usage = getStorageUsage() - oldLen + newLen;
        if (usage > MAX_STORAGE) { console.warn('[Sandbox] Storage quota exceeded'); return; }
        localStorage.setItem(fullKey, value);
      } catch(e) {}
    },
    removeItem: function(key) { try { localStorage.removeItem(STORAGE_PREFIX + key); } catch(e) {} },
    clear: function() {
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k);
        }
        keys.forEach(function(k) { localStorage.removeItem(k); });
      } catch(e) {}
    },
    get length() {
      var count = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(STORAGE_PREFIX)) count++;
      }
      return count;
    }
  };

  // ── 编辑器内容缓存（由主应用推送） ──
  var _editorContent = null;
  var _editorLanguage = null;

  // ── 插件状态 ──
  var __commandHandlers__ = {};

  // ── 受限 API ──
  var pluginAPI = Object.freeze({
    registerCommand: function(idOrDef, secondArg) {
      // 兼容两种调用方式：
      // 方式1: registerCommand('id', { label, description, execute })
      // 方式2: registerCommand({ id, label, description }, handler)
      var id, label, desc, handler;
      if (typeof idOrDef === 'string') {
        id = idOrDef;
        label = (secondArg && secondArg.label) || id;
        desc = (secondArg && secondArg.description) || '';
        handler = (secondArg && secondArg.execute) || secondArg;
      } else {
        id = idOrDef.id;
        label = idOrDef.label || id;
        desc = idOrDef.description || '';
        handler = secondArg;
      }
      if (!id) return;
      __commandHandlers__[id] = handler;
      isRegistered = true;
      sendToHost('registerCommand', { command: { id: id, label: label, description: desc } });
    },
    getEditorContent: function() { return _editorContent; },
    setEditorContent: function(content) {
      sendToHost('setEditorContent', { content: content });
    },
    getCurrentFileLanguage: function() { return _editorLanguage; },
    showNotification: function(message, type) {
      sendToHost('showNotification', { message: String(message), type: type || 'info' });
    },
    storage: Object.freeze({
      get: function(key) { return sandboxStorage.getItem(key); },
      set: function(key, value) { sandboxStorage.setItem(key, value); },
      remove: function(key) { sandboxStorage.removeItem(key); },
      clear: function() { sandboxStorage.clear(); }
    }),
    getRootElement: function() { return document.getElementById('plugin-root'); },
    getPluginId: function() { return ${o}; },
    getPluginInfo: function() { return Object.freeze(JSON.parse('${JSON.stringify(n).replace(/'/g,"\\\\'")}')); }
  });

  window.SmartBox = Object.freeze({
    getPluginAPI: function() { return pluginAPI; }
  });

  // ── 接受主应用消息 ──
  window.addEventListener('message', function(event) {
    if (event.data && event.data.source === 'smartbox-host') {
      var msg = event.data;
      if (msg.type === 'executeCommand') {
        var handler = __commandHandlers__[msg.commandId];
        if (handler) {
          try { handler(); } catch(e) { console.error('[Plugin] Command error:', e); }
        }
      } else if (msg.type === 'editorContentUpdate') {
        // 主应用推送编辑器内容更新
        if (msg.content !== undefined) _editorContent = msg.content;
        if (msg.language !== undefined) _editorLanguage = msg.language;
      }
    }
  });

  // ── 请求当前编辑器内容（初始化缓存） ──
  sendToHost('getEditorContent', {});

  sendToHost('sandboxReady', {});

  // ── 执行插件代码 ──
  try {
    ${b}
  } catch(e) {
    sendToHost('pluginError', { error: e.message || String(e) });
  }
})();
`}<\/script></body></html>`},[n.id,n.name,b]);return(0,r.useEffect)(()=>{const a=m.current;if(a){N(!0),E(null),C(!1),h.current&&(URL.revokeObjectURL(h.current),h.current=null);try{const o=i(),x=new Blob([o],{type:"text/html; charset=utf-8"}),u=URL.createObjectURL(x);return h.current=u,a.src=u,()=>{h.current&&(URL.revokeObjectURL(h.current),h.current=null)}}catch(o){const x=o.message||"Failed to create sandbox";E(x),N(!1),p?.(x)}}},[n.id,b]),(0,r.useEffect)(()=>{if(s.current)return;s.current=!0;const a=o=>{const x=o.data;if(!(!x||x.source!=="smartbox-plugin-sandbox")&&x.pluginId===n.id)switch(x.type){case"sandboxReady":C(!0),N(!1),d?.(T.current);break;case"registerCommand":{const u=x.payload.command;u?.id&&k?.(u);break}case"showNotification":{const{message:u,type:y}=x.payload;S?.(u||"",y||"info");break}case"pluginError":{const u=x.payload.error;E(u),N(!1),p?.(u);break}case"setEditorContent":{const u=M();if(u){const y=u.getState(),t=x.payload.content;y.activeTabId&&t!==void 0&&y.updateFileContent(y.activeTabId,t)}break}case"getEditorContent":{const u=M();if(u){const y=u.getState(),t=y.openTabs?.find(f=>f.id===y.activeTabId),c=m.current;c?.contentWindow&&c.contentWindow.postMessage({source:"smartbox-host",type:"editorContentUpdate",content:t?.content??null,language:t?.language??null},"*")}break}}};return window.addEventListener("message",a),()=>{window.removeEventListener("message",a),s.current=!1}},[n.id,d,k,S,p]),(0,r.useEffect)(()=>{T.current={executeCommand:(a,o)=>{m.current?.contentWindow?.postMessage({source:"smartbox-host",type:"executeCommand",commandId:a,args:o||[]},"*")},updateEditorContent:(a,o)=>{m.current?.contentWindow?.postMessage({source:"smartbox-host",type:"editorContentUpdate",content:a,language:o},"*")},destroy:()=>{const a=m.current;a&&(a.src="about:blank")},iframe:m.current,reload:(a,o)=>{}}},[]),(0,e.jsxs)("div",{className:"relative h-full w-full overflow-hidden rounded-lg bg-slate-900/50",children:[L&&!w&&(0,e.jsx)("div",{className:"absolute inset-0 z-10 flex items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)("div",{className:"mx-auto mb-2 h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-blue-400"}),(0,e.jsx)("p",{className:"text-xs text-slate-500",children:"沙箱加载中..."})]})}),w&&(0,e.jsx)("div",{className:"absolute inset-0 z-10 flex items-center justify-center bg-slate-900/80 p-4",children:(0,e.jsxs)("div",{className:"max-w-xs text-center",children:[(0,e.jsx)("p",{className:"mb-1 text-sm text-red-400",children:"沙箱加载失败"}),(0,e.jsx)("p",{className:"text-xs text-slate-500",children:w})]})}),(0,e.jsx)("iframe",{ref:m,title:`沙箱: ${n.name}`,className:"h-full w-full border-0",sandbox:"allow-scripts",style:{background:"transparent"}})]})}var ie="/api/market/index";function oe(n){switch(n?.toLowerCase()){case"easy":case"入门":return"text-emerald-400 bg-emerald-500/10";case"medium":case"中级":return"text-amber-400 bg-amber-500/10";case"hard":case"高级":return"text-red-400 bg-red-500/10";default:return"text-slate-500 bg-slate-800"}}function ce(){const[n,b]=(0,r.useState)([]),[d,k]=(0,r.useState)(!0),[j,S]=(0,r.useState)(null),[p,R]=(0,r.useState)(""),[P,m]=(0,r.useState)({}),[_,C]=(0,r.useState)(null),L=z(s=>s.plugins),N=new Set(L.map(s=>s.manifest.id)),w=(0,r.useCallback)(async()=>{k(!0),S(null);try{const s=await fetch(ie);if(!s.ok)throw new Error(`HTTP ${s.status}: ${s.statusText}`);b((await s.json()).plugins||[])}catch(s){S(s.message||"Failed to load market plugins")}finally{k(!1)}},[]);(0,r.useEffect)(()=>{w()},[w]);const E=async s=>{m(i=>({...i,[s.id]:{status:"installing",message:"正在下载..."}}));try{const i=await fetch("/api/plugins/install",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pluginId:s.id,manifestUrl:s.manifestUrl,pluginUrl:s.pluginUrl})}),a=await i.json();i.ok?m(o=>({...o,[s.id]:{status:"success",message:"安装成功，请刷新插件列表"}})):m(o=>({...o,[s.id]:{status:"error",message:a.error||"安装失败"}}))}catch(i){m(a=>({...a,[s.id]:{status:"error",message:i.message||"网络错误"}}))}},T=async s=>{if(confirm(`确定卸载插件 "${s}" ？
已安装的插件目录将被删除。`)){m(i=>({...i,[s]:{status:"installing",message:"正在卸载..."}}));try{const i=await fetch("/api/plugins/uninstall",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pluginId:s})});if(i.ok)m(a=>({...a,[s]:{status:"success",message:"已卸载"}}));else{const a=await i.json();m(o=>({...o,[s]:{status:"error",message:a.error||"卸载失败"}}))}}catch(i){m(a=>({...a,[s]:{status:"error",message:i.message||"网络错误"}}))}}},h=n.filter(s=>{if(!p.trim())return!0;const i=p.toLowerCase();return s.name.toLowerCase().includes(i)||s.id.toLowerCase().includes(i)||s.description.toLowerCase().includes(i)||s.author.toLowerCase().includes(i)||s.tags?.some(a=>a.toLowerCase().includes(i))});return(0,e.jsxs)("div",{className:"flex h-full flex-col",children:[(0,e.jsxs)("div",{className:"mb-3 flex items-center justify-between",children:[(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[(0,e.jsx)(q,{size:16,className:"text-sky-400"}),(0,e.jsx)("h3",{className:"text-sm font-medium text-slate-300",children:"插件市场"}),n.length>0&&(0,e.jsxs)("span",{className:"rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400",children:[n.length," 个可用"]})]}),(0,e.jsxs)("button",{onClick:w,disabled:d,className:"btn-ghost flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300",children:[(0,e.jsx)(I,{size:12,className:d?"animate-spin":""}),"刷新"]})]}),(0,e.jsxs)("div",{className:"relative mb-3",children:[(0,e.jsx)(U,{size:14,className:"pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"}),(0,e.jsx)("input",{className:"w-full rounded-lg border border-slate-700/50 bg-slate-800/50 py-2 pl-9 pr-3 text-xs text-slate-300 placeholder-slate-600 outline-none transition-colors focus:border-sky-500/50 focus:bg-slate-800",placeholder:"搜索插件名称、标签、作者...",value:p,onChange:s=>R(s.target.value)}),p&&(0,e.jsx)("button",{onClick:()=>R(""),className:"absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400",children:(0,e.jsx)(H,{size:14})})]}),d&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(I,{size:24,className:"mx-auto mb-2 animate-spin text-slate-500"}),(0,e.jsx)("p",{className:"text-xs text-slate-500",children:"正在加载市场列表..."})]})}),!d&&j&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(D,{size:32,className:"mx-auto mb-2 text-red-400"}),(0,e.jsx)("p",{className:"text-xs text-red-400",children:j}),(0,e.jsx)("button",{onClick:w,className:"mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700",children:"重试"})]})}),!d&&!j&&h.length===0&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(U,{size:32,className:"mx-auto mb-2 text-slate-600"}),(0,e.jsx)("p",{className:"text-xs text-slate-500",children:p?"没有匹配的插件":"市场暂无可用插件"})]})}),!d&&!j&&h.length>0&&(0,e.jsx)("div",{className:"flex-1 space-y-2 overflow-y-auto pr-1",children:h.map(s=>{const i=N.has(s.id),a=P[s.id],o=_===s.id;return(0,e.jsxs)("div",{className:`rounded-lg border transition-all ${i?"border-emerald-700/30 bg-emerald-900/10":"border-slate-700/30 bg-slate-900/40 hover:border-slate-600/50"}`,children:[(0,e.jsxs)("div",{className:"flex items-start gap-3 p-3",children:[(0,e.jsx)("div",{className:"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800",children:(0,e.jsx)(O,{size:16,className:"text-slate-400"})}),(0,e.jsxs)("div",{className:"min-w-0 flex-1",children:[(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[(0,e.jsx)("h4",{className:"text-sm font-medium text-slate-200",children:s.name}),(0,e.jsxs)("span",{className:"rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500",children:["v",s.version]}),i&&(0,e.jsx)("span",{className:"rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400",children:"已安装"})]}),(0,e.jsx)("p",{className:"mt-0.5 text-xs text-slate-500 line-clamp-2",children:s.description}),(0,e.jsxs)("div",{className:"mt-1.5 flex flex-wrap items-center gap-1.5",children:[(0,e.jsxs)("span",{className:"text-[10px] text-slate-600",children:["作者: ",s.author]}),s.tags?.map(x=>(0,e.jsx)("span",{className:`rounded px-1.5 py-0.5 text-[9px] ${oe(x)}`,children:x},x)),s.downloads!==void 0&&(0,e.jsxs)("span",{className:"text-[10px] text-slate-600",children:["↓ ",s.downloads]})]})]}),(0,e.jsxs)("div",{className:"flex shrink-0 items-center gap-1",children:[(0,e.jsx)("button",{onClick:()=>C(o?null:s.id),className:"btn btn-ghost rounded-lg p-1.5 text-slate-600 hover:text-slate-400",children:(0,e.jsx)(B,{size:14,className:`transition-transform ${o?"rotate-180":""}`})}),i?(0,e.jsx)("button",{onClick:()=>T(s.id),disabled:a?.status==="installing",className:"btn btn-ghost rounded-lg p-1.5 text-red-500/60 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40",title:"卸载",children:(0,e.jsx)(V,{size:14})}):(0,e.jsxs)("button",{onClick:()=>E(s),disabled:a?.status==="installing",className:`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${a?.status==="success"?"bg-emerald-500/10 text-emerald-400":"bg-sky-500/10 text-sky-400 hover:bg-sky-500/20"} disabled:opacity-40`,children:[a?.status==="installing"?(0,e.jsx)(I,{size:12,className:"animate-spin"}):a?.status==="success"?(0,e.jsx)(W,{size:12}):(0,e.jsx)(Y,{size:12}),a?.message||"安装"]})]})]}),o&&s.manifestUrl&&(0,e.jsx)("div",{className:"border-t border-slate-700/30 px-3 py-2",children:(0,e.jsxs)("div",{className:"flex items-center gap-3 text-[11px] text-slate-600",children:[(0,e.jsxs)("span",{children:["ID: ",(0,e.jsx)("code",{className:"text-slate-500",children:s.id})]}),s.updatedAt&&(0,e.jsxs)("span",{children:["更新: ",new Date(s.updatedAt).toLocaleDateString("zh-CN")]}),(0,e.jsxs)("a",{href:s.manifestUrl.replace("/manifest.json",""),target:"_blank",rel:"noopener noreferrer",className:"ml-auto flex items-center gap-1 text-sky-500/60 hover:text-sky-400",children:[(0,e.jsx)(K,{size:10}),"源码"]})]})})]},s.id)})}),!d&&!j&&n.length>0&&(0,e.jsx)("div",{className:"mt-2 text-center text-[10px] text-slate-700",children:"插件运行在 iframe 沙箱中，安全隔离"})]})}function ge(){const[n,b]=(0,r.useState)("installed"),[d,k]=(0,r.useState)([]),[j,S]=(0,r.useState)(!0),[p,R]=(0,r.useState)(null),P=(0,r.useRef)({}),m=(0,r.useRef)({}),_=(0,r.useRef)({}),C=(0,r.useRef)(!1),[L,N]=(0,r.useState)(0),w=z(t=>t.plugins),E=z(t=>t.enablePlugin),T=z(t=>t.disablePlugin),h=(0,r.useCallback)(async()=>{if(!C.current){C.current=!0,S(!0),R(null);try{const t=await ae();k(t);const c={},f={};for(const g of t){try{c[g.id]=await ne(g.entry)}catch(v){console.error(`[PluginsPage] Failed to fetch code for "${g.id}":`,v)}f[g.id]=Date.now()+Math.random()}P.current=c,_.current=f,m.current={};const l=z.getState();for(const g of t)l.getPlugin(g.id)||l.registerPlugin({id:g.id,name:g.name,version:g.version,description:g.description,author:g.author,icon:g.icon,entry:g.entry,commands:g.commands.map(v=>({id:v.id,name:v.label||v.id,description:v.description,icon:v.icon})),panels:g.panels.map(v=>({id:v.id,name:v.title||v.id,icon:v.icon,position:"main"}))},{});N(g=>g+1)}catch(t){R(t.message||"加载插件失败")}finally{S(!1)}}},[]);(0,r.useEffect)(()=>(h(),se().on("plugins-changed",()=>{a()})),[]);const s=t=>w.some(c=>c.manifest.id===t&&c.enabled),i=(t,c)=>{c?T(t):E(t)},a=()=>{for(const t of d)re(t.id);P.current={},m.current={},_.current={},C.current=!1,k([]),N(0),h()},o=(0,r.useCallback)((t,c)=>{m.current={...m.current,[t]:!0},N(l=>l+1);const f=d.find(l=>l.id===t);f&&$.register(t,{id:f.id,name:f.name,version:f.version,description:f.description,author:f.author,icon:f.icon,entry:f.entry,commands:(f.commands||[]).map(l=>({id:l.id,name:l.label||l.id,label:l.label,description:l.description,icon:l.icon})),panels:(f.panels||[]).map(l=>({id:l.id,name:l.title||l.id,icon:l.icon,position:"main"}))},c)},[d]),x=P.current,u=m.current,y=_.current;return(0,e.jsxs)("div",{className:"flex h-full flex-col p-4 sm:p-6",children:[(0,e.jsx)("div",{className:"mb-4",children:(0,e.jsxs)("div",{className:"flex flex-wrap items-center justify-between gap-2",children:[(0,e.jsxs)("div",{className:"flex flex-wrap items-center gap-3",children:[(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[(0,e.jsx)(O,{size:20,className:"text-slate-400"}),(0,e.jsx)("h2",{className:"text-lg font-semibold text-slate-200",children:"插件"})]}),(0,e.jsxs)("div",{className:"flex rounded-lg border border-slate-700/50 bg-slate-900 p-0.5",children:[(0,e.jsxs)("button",{onClick:()=>b("installed"),className:`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${n==="installed"?"bg-slate-700/60 text-slate-200 shadow-sm":"text-slate-500 hover:text-slate-300"}`,children:[(0,e.jsx)(O,{size:13}),"已安装",d.length>0&&(0,e.jsx)("span",{className:"ml-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400",children:d.length})]}),(0,e.jsxs)("button",{onClick:()=>b("market"),className:`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${n==="market"?"bg-slate-700/60 text-slate-200 shadow-sm":"text-slate-500 hover:text-slate-300"}`,children:[(0,e.jsx)(q,{size:13}),"市场"]})]})]}),n==="installed"&&(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[d.length>0&&(0,e.jsxs)("span",{className:"flex items-center gap-1 text-[11px] text-emerald-500/70",children:[(0,e.jsx)(F,{size:12}),"沙箱隔离"]}),(0,e.jsxs)("button",{onClick:a,disabled:j,className:"btn-secondary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200",children:[(0,e.jsx)(Z,{size:14,className:j?"animate-spin":""}),"刷新"]})]})]})}),n==="installed"&&(0,e.jsxs)(e.Fragment,{children:[j&&d.length===0&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(I,{size:32,className:"mx-auto mb-3 animate-spin text-slate-500"}),(0,e.jsx)("p",{className:"text-sm text-slate-500",children:"正在加载插件..."})]})}),p&&!j&&L>=0&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(D,{size:40,className:"mx-auto mb-3 text-red-400"}),(0,e.jsx)("p",{className:"text-sm text-red-400",children:p}),(0,e.jsx)("button",{onClick:a,className:"mt-4 rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700",children:"重试"})]})}),!j&&!p&&d.length===0&&(0,e.jsx)("div",{className:"flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-700/50",children:(0,e.jsxs)("div",{className:"text-center",children:[(0,e.jsx)(O,{size:48,className:"mx-auto mb-3 text-slate-600"}),(0,e.jsx)("p",{className:"text-sm text-slate-500",children:"没有安装任何插件"}),(0,e.jsx)("p",{className:"mt-1 text-xs text-slate-600",children:"将插件放入 plugins/ 目录后自动识别"})]})}),d.length>0&&(0,e.jsxs)("div",{className:"flex flex-1 flex-col sm:flex-row gap-4 overflow-hidden",children:[(0,e.jsx)("div",{className:"w-full sm:w-72 shrink-0 space-y-3 overflow-y-auto sm:pr-2 max-h-[40vh] sm:max-h-none",children:d.map(t=>{const c=s(t.id),f=u[t.id];return(0,e.jsx)("div",{className:`rounded-lg border p-4 transition-colors ${c?"border-slate-600/50 bg-slate-800/50":"border-slate-700/30 bg-slate-900/50"}`,children:(0,e.jsxs)("div",{className:"flex items-start justify-between",children:[(0,e.jsxs)("div",{className:"flex-1",children:[(0,e.jsxs)("div",{className:"flex items-center gap-2",children:[(0,e.jsx)("h3",{className:"text-sm font-medium text-slate-200",children:t.name}),(0,e.jsxs)("span",{className:"rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-500",children:["v",t.version]}),!f&&x[t.id]&&(0,e.jsx)(I,{size:12,className:"animate-spin text-amber-400"}),!x[t.id]&&(0,e.jsx)("span",{className:"text-[10px] text-slate-600",children:"⏳ 代码未加载"})]}),(0,e.jsx)("p",{className:"mt-1 text-xs text-slate-500",children:t.description}),(0,e.jsxs)("div",{className:"mt-2 flex items-center gap-3 text-[11px] text-slate-600",children:[(0,e.jsxs)("span",{children:["作者: ",t.author]}),t.commands?.length>0&&(0,e.jsxs)("span",{children:[t.commands.length," 个命令"]})]}),t.commands&&t.commands.length>0&&(0,e.jsx)("div",{className:"mt-2 flex flex-wrap gap-1.5",children:t.commands.map(l=>(0,e.jsxs)("button",{onClick:()=>{c&&($.executeCommand(t.id,l.id),window.dispatchEvent(new CustomEvent("smartbox-notification",{detail:{message:`已执行: ${t.name} → ${l.label||l.id}`,type:"info"}})))},disabled:!c,title:l.description||l.label||l.id,className:`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${c?"bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200":"bg-slate-800/30 text-slate-600 cursor-not-allowed"}`,children:[c&&(0,e.jsx)(X,{size:10,className:"shrink-0"}),l.label||l.id]},l.id))})]}),(0,e.jsx)("button",{onClick:()=>i(t.id,c),disabled:!f,className:`ml-4 flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${c?"border-emerald-600/50 bg-emerald-500/10 text-emerald-400":"border-slate-700 text-slate-600 hover:border-slate-600 hover:text-slate-400"} ${f?"":"cursor-not-allowed opacity-50"}`,title:c?"禁用":"启用",children:c?(0,e.jsx)(Q,{size:14}):(0,e.jsx)(H,{size:14})})]})},t.id)})}),(0,e.jsxs)("div",{className:"flex-1 overflow-hidden rounded-lg border border-slate-700/30 bg-slate-900/30 flex flex-col",children:[(0,e.jsxs)("div",{className:"border-b border-slate-700/30 px-4 py-2 flex items-center justify-between shrink-0",children:[(0,e.jsx)("h3",{className:"text-xs font-medium text-slate-400",children:"沙箱运行状态"}),(0,e.jsxs)("span",{className:"text-[10px] text-slate-600",children:[Object.keys(u).filter(t=>u[t]).length,"/",d.filter(t=>x[t.id]).length," 就绪"]})]}),(0,e.jsx)("div",{className:"flex-1 overflow-y-auto p-3 sm:p-4",children:d.filter(t=>x[t.id]).length===0?(0,e.jsx)("div",{className:"flex items-center justify-center py-12 text-center",children:(0,e.jsx)("p",{className:"text-xs text-slate-600",children:"沙箱加载中，请稍候..."})}):(0,e.jsx)("div",{className:"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4",children:d.filter(t=>x[t.id]).map(t=>(0,e.jsxs)("div",{className:"rounded-lg border border-slate-700/30 bg-slate-900/50",children:[(0,e.jsxs)("div",{className:"flex items-center justify-between border-b border-slate-700/30 px-3 py-1.5",children:[(0,e.jsx)("span",{className:"text-xs font-medium text-slate-400",children:t.name}),(0,e.jsxs)("span",{className:"flex items-center gap-1 text-[10px] text-emerald-500/70",children:[(0,e.jsx)(F,{size:10}),u[t.id]?"沙箱就绪":"加载中"]})]}),(0,e.jsx)("div",{className:"h-48 sm:h-32 flex items-center justify-center",children:y[t.id]?(0,e.jsx)(le,{manifest:{id:t.id,name:t.name,version:t.version,description:t.description,author:t.author,icon:t.icon,entry:t.entry},pluginCode:x[t.id]||"",onReady:c=>o(t.id,c),onError:c=>console.error(`[Plugins] ${t.name} error:`,c)},y[t.id]):(0,e.jsx)("span",{className:"text-[10px] text-slate-600",children:"点击左侧命令按钮执行"})})]},t.id))})})]})]})]}),n==="market"&&(0,e.jsx)("div",{className:"flex-1 overflow-hidden",children:(0,e.jsx)(ce,{})})]})}export{ge as default};
