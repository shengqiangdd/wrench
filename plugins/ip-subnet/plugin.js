/**
 * IP/子网计算器插件
 * CIDR 子网计算、IP 分类、可用地址范围、二进制表示
 */
(function(){
  const IpSubnet={
    id:'ip-subnet', name:'IP/子网计算器',
    init(){
      if(typeof wrench!=='undefined'&&wrench.panels){
        wrench.panels.register('ip-panel',{title:'IP/子网计算器',icon:'wifi',render:c=>this.renderPanel(c)});
      }
    },
    ip2long(ip){ const p=ip.split('.').map(Number); if(p.length!==4||p.some(x=>isNaN(x)||x<0||x>255))return null; return ((p[0]<<24)|(p[1]<<16)|(p[2]<<8)|p[3])>>>0; },
    long2ip(n){ return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.'); },
    toBin(ip){ return ip.split('.').map(o=>('00000000'+(parseInt(o)||0).toString(2)).slice(-8)).join('.'); },
    getIpClass(ip){
      const first=parseInt(ip.split('.')[0]);
      if(first>=1&&first<=126) return {cls:'A',range:'1.0.0.0 – 126.255.255.255',desc:'大型网络'};
      if(first>=128&&first<=191) return {cls:'B',range:'128.0.0.0 – 191.255.255.255',desc:'中型网络'};
      if(first>=192&&first<=223) return {cls:'C',range:'192.0.0.0 – 223.255.255.255',desc:'小型网络'};
      if(first>=224&&first<=239) return {cls:'D',range:'224.0.0.0 – 239.255.255.255',desc:'多播'};
      if(first>=240) return {cls:'E',range:'240.0.0.0 – 255.255.255.255',desc:'保留实验'};
      return {cls:'-',range:'-',desc:'无效'};
    },
    isPrivate(ip){
      const p=ip.split('.').map(Number);
      if(p[0]===10) return true;
      if(p[0]===172&&p[1]>=16&&p[1]<=31) return true;
      if(p[0]===192&&p[1]===168) return true;
      if(p[0]===127) return true;
      if(p[0]===169&&p[1]===254) return true;
      return false;
    },
    calc(cidr){
      const [ipStr,prefixStr]=cidr.split('/');
      const prefix=parseInt(prefixStr)||32;
      const ip=this.ip2long(ipStr);
      if(ip===null) return null;
      const mask=prefix===0?0:(~0<<(32-prefix))>>>0;
      const network=(ip&mask)>>>0;
      const broadcast=(network|(~mask>>>0))>>>0;
      const total=Math.pow(2,32-prefix);
      const usable=prefix>=31?total:total-2;
      return {
        ip:ipStr, prefix, mask:this.long2ip(mask),
        network:this.long2ip(network), broadcast:this.long2ip(broadcast),
        firstUsable:prefix>=31?this.long2ip(network):this.long2ip(network+1),
        lastUsable:prefix>=31?this.long2ip(broadcast):this.long2ip(broadcast-1),
        total, usable, maskBin:this.toBin(this.long2ip(mask)),
        networkBin:this.toBin(this.long2ip(network)),
        wildcard:this.long2ip((~mask)>>>0),
        classInfo:this.getIpClass(ipStr),
        private:this.isPrivate(ipStr),
        hostBits:32-prefix
      };
    },
    renderPanel(container){
      container.innerHTML=`
        <div class="plugin-ip-sub">
          <h3>🌐 IP/子网计算器</h3>
          <div class="ip-input-row">
            <input type="text" id="ip-cidr" placeholder="IP/CIDR，如 192.168.1.0/24" value="192.168.1.0/24" />
            <button class="ip-calc-btn" id="ip-calc-btn">计算</button>
          </div>
          <div class="ip-results" id="ip-results"></div>
          <h4>📊 常用子网速查</h4>
          <div class="ip-ref" id="ip-ref"></div>
          <style>
            .plugin-ip-sub{padding:16px;}
            .plugin-ip-sub h3{margin:0 0 10px;font-size:1.1em;}
            .plugin-ip-sub h4{margin:16px 0 8px;font-size:0.9em;color:#888;}
            .ip-input-row{display:flex;gap:8px;margin-bottom:12px;}
            #ip-cidr{flex:1;padding:8px 12px;background:#1a1d23;border:1px solid #3a3f47;border-radius:6px;color:#e0e0e0;font-family:monospace;font-size:1em;}
            #ip-cidr:focus{border-color:#4caf50;outline:none;}
            .ip-calc-btn{padding:8px 20px;background:#4caf50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.9em;}
            .ip-results{background:#1a1d23;border-radius:8px;padding:12px;border:1px solid #3a3f47;}
            .ip-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #2a2e35;font-size:0.85em;}
            .ip-row:last-child{border-bottom:none;}
            .ip-row .k{color:#888;min-width:120px;}
            .ip-row .v{color:#4caf50;font-family:monospace;word-break:break-all;text-align:right;}
            .ip-row .v.v-blue{color:#4a9eff;}
            .ip-row .v.v-orange{color:#ff9800;}
            .ip-row .v.v-red{color:#f44336;}
            .ip-badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:0.8em;margin-left:6px;}
            .ip-badge.private{background:#4caf5022;color:#4caf50;}
            .ip-badge.public{background:#4a9eff22;color:#4a9eff;}
            .ip-ref-table{width:100%;font-size:0.8em;border-collapse:collapse;}
            .ip-ref-table th{text-align:left;padding:4px 8px;color:#888;border-bottom:1px solid #3a3f47;}
            .ip-ref-table td{padding:4px 8px;border-bottom:1px solid #2a2e35;font-family:monospace;}
            .ip-ref-table td:nth-child(2){color:#4caf50;}
            .ip-ref-table td:nth-child(3){color:#4a9eff;}
          </style>
        </div>`;
      document.getElementById('ip-calc-btn').addEventListener('click',()=>this.doCalc());
      document.getElementById('ip-cidr').addEventListener('keydown',e=>{if(e.key==='Enter')this.doCalc();});
      this.doCalc();
      this.renderRef();
    },
    doCalc(){
      const cidr=document.getElementById('ip-cidr').value.trim();
      const el=document.getElementById('ip-results');
      if(!cidr.includes('/')){el.innerHTML='<div style="color:#f44">请输入 IP/CIDR 格式（如 192.168.1.0/24）</div>';return;}
      const r=this.calc(cidr);
      if(!r){el.innerHTML='<div style="color:#f44">无效 IP 地址</div>';return;}
      const privBadge=r.private?'<span class="ip-badge private">私有</span>':'<span class="ip-badge public">公网</span>';
      el.innerHTML=[
        ['网络地址',r.network,''],
        ['广播地址',r.broadcast,''],
        ['子网掩码',r.mask,r.maskBin],
        ['通配符掩码',r.wildcard,''],
        ['CIDR 前缀','/'+r.prefix,`主机位: ${r.hostBits} 位`],
        ['IP 类别',r.classInfo.cls+' 类',r.classInfo.desc+privBadge],
        ['第一可用',r.firstUsable,''],
        ['最后可用',r.lastUsable,''],
        ['总地址数',r.total.toLocaleString(),r.total>1048576?(r.total/1048576).toFixed(1)+'M':r.total>1024?(r.total/1024).toFixed(1)+'K':r.total],
        ['可用地址',r.usable.toLocaleString(),''],
      ].map(([k,v,extra])=>`<div class="ip-row"><span class="k">${k}</span><span class="v">${v}</span>${extra?`<span class="v v-blue" style="min-width:200px;">${extra}</span>`:''}</div>`).join('');
    },
    renderRef(){
      document.getElementById('ip-ref').innerHTML=`<table class="ip-ref-table"><thead><tr><th>CIDR</th><th>子网掩码</th><th>地址数</th><th>说明</th></tr></thead><tbody>
        <tr><td>/32</td><td>255.255.255.255</td><td>1</td><td>主机路由</td></tr>
        <tr><td>/31</td><td>255.255.255.254</td><td>2</td><td>点对点链路</td></tr>
        <tr><td>/30</td><td>255.255.255.252</td><td>4</td><td>2 可用</td></tr>
        <tr><td>/29</td><td>255.255.255.248</td><td>8</td><td>6 可用</td></tr>
        <tr><td>/28</td><td>255.255.255.240</td><td>16</td><td>14 可用</td></tr>
        <tr><td>/27</td><td>255.255.255.224</td><td>32</td><td>30 可用</td></tr>
        <tr><td>/24</td><td>255.255.255.0</td><td>256</td><td>254 可用（C 类默认）</td></tr>
        <tr><td>/16</td><td>255.255.0.0</td><td>65,536</td><td>65,534 可用（B 类默认）</td></tr>
        <tr><td>/8</td><td>255.0.0.0</td><td>16,777,216</td><td>A 类默认</td></tr>
      </tbody></table>`;
    }
  };
  if(typeof window!=='undefined') window.IpSubnet=IpSubnet;
})();
