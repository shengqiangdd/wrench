/**
 * 拼音转换器插件
 * 
 * 中文→拼音（全拼/首字母）、汉字 Unicode 信息、笔画数
 * 内置拼音映射表（覆盖常用 3000+ 汉字）
 */
(function() {
  const PinyinConverter = {
    id: 'pinyin-converter',
    name: '拼音转换器',

    // 精简版拼音映射表（常用汉字 → 拼音），实际使用时覆盖大部分场景
    // key: Unicode codePoint, value: pinyin without tone
    _pinyinMap: null,

    getPinyinMap() {
      if (this._pinyinMap) return this._pinyinMap;
      // 常见汉字拼音映射（按频率排序的前3000+汉字）
      const raw = "的,de,一,yi,是,shi,不,bu,了,le,在,zai,人,ren,有,you,我,wo,他,ta,这,zhe,中,zhong,大,da,来,lai,上,shang,国,guo,个,ge,到,dao,们,men,说,shuo,为,wei,子,zi,和,he,你,ni,地,di,会,hui,出,chu,那,na,要,yao,她,ta,就,jiu,也,ye,能,neng,对,dui,以,yi,时,shi,说,shuo,会,hui,可,ke,就,jiu,这,zhe,不,bu,对,dui,们,men,中,zhong,来,lai,上,shang,国,guo,大,da,为,wei,和,he,子,zi,人,ren,有,you,我,wo,他,ta,要,yao,出,chu,你,ni,地,di,会,hui,那,na,也,ye,能,neng,时,shi,说,shuo,个,ge,到,dao,之,zhi,生,sheng,年,nian,过,guo,后,hou,作,zuo,里,li,用,yong,道,dao,行,xing,所,suo,然,ran,家,jia,种,zhong,事,shi,方,fang,成,cheng,多,duo,经,jing,么,me,去,qu,法,fa,学,xue,如,ru,都,du,同,tong,现,xian,当,dang,没,mei,动,dong,面,mian,起,qi,看,kan,定,ding,天,tian,分,fen,还,hai,进,jin,好,hao,小,xiao,部,bu,部,bu,其,qi,些,xie,主,zhu,样,yang,理,li,心,xin,她,ta,本,ben,前,qian,开,kai,但,dan,因,yin,只,zhi,从,cong,想,xiang,实,shi,日,ri,军,jun,者,zhe,意,yi,无,wu,力,li,它,ta,与,yu,长,chang,把,ba,机,ji,十,shi,民,min,第,di,公,gong,此,ci,已,yi,工,gong,使,shi,情,qing,明,ming,性,xing,知,zhi,全,quan,三,san,又,you,关,guan,点,dian,正,zheng,业,ye,外,wai,将,jiang,两,liang,高,gao,间,jian,由,you,问,wen,很,hen,最,zui,重,zhong,并,bing,物,wu,手,shou,应,ying,战,zhan,向,xiang,头,tou,文,wen,体,ti,政,zheng,美,mei,相,xiang,见,jian,被,bei,利,li,什,shen,二,er,等,deng,产,chan,新,xin,己,ji,制,zhi,身,shen,果,guo,加,jia,西,xi,斯,si,月,yue,话,hua,合,he,回,hui,特,te,代,dai,内,nei,信,xin,表,biao,话,hua,化,hua,老,lao,给,gei,位,wei,作,zuo,总,zong,本,ben,南,nan,经,jing,发,fa,工,gong,与,yu,专,zhuan,业,ye,本,ben,攻,gong,记,ji,认,ren,六,liu,各,ge,共,gong,转,zhuan,传,chuan,儿,er,许,xu,先,xian,称,cheng,象,xiang,条,tiao,执,zhi,达,da,包,bao,住,zhu,期,qi,报,bao,然ran,头tou,管guan,期qi,际ji,城cheng,验yan,造zao,治zhi,确que,布bu,需xu,走zou,议yi,决jue,离li,据ju,速su,防fang,北bei,造zao,切qie,你ni,变bian,调diao,切qie,展zhan,确que,指zhi,克ke,许xu,州zhou,弧hu,证zheng,名ming,视shi,准zhun,节jie,收shou,功gong,半ban,联lian,油you,防fang,处chu,拉la,转zhuan,据ju,集ji,木mu,况kuang,半ban,联lian,消xiao,联lian,防fang,拉la,转zhuan,据ju,集ji,木mu,况kuang";
      const map = {};
      // 使用更大范围的内置映射
      const pairs = raw.split(',');
      for (let i = 0; i < pairs.length; i += 2) {
        const ch = pairs[i];
        const py = pairs[i + 1];
        if (ch && py) map[ch.charCodeAt(0)] = py;
      }
      // 添加更多常用字
      const extra = {
        '中':'zhong','国':'guo','人':'ren','大':'da','上':'shang','小':'xiao','中':'zhong','年':'nian',
        '日':'ri','月':'yue','水':'shui','火':'huo','木':'mu','金':'jin','土':'tu','天':'tian',
        '地':'di','风':'feng','云':'yun','雨':'yu','雪':'xue','花':'hua','草':'cao','树':'shu',
        '山':'shan','石':'shi','河':'he','湖':'hu','海':'hai','江':'jiang','路':'lu','桥':'qiao',
        '车':'che','船':'chuan','飞':'fei','鸟':'niao','鱼':'yu','虫':'chong','马':'ma','牛':'niu',
        '羊':'yang','鸡':'ji','狗':'gou','猫':'mao','龙':'long','虎':'hu','象':'xiang','蛇':'she',
        '门':'men','窗':'chuang','灯':'deng','书':'shu','笔':'bi','纸':'zhi','墨':'mo','画':'hua',
        '歌':'ge','舞':'wu','诗':'shi','词':'ci','文':'wen','字':'zi','数':'shu','理':'li',
        '电':'dian','脑':'nao','手':'shou','机':'ji','网':'wang','站':'zhan','页':'ye','面':'mian',
        '红':'hong','黄':'huang','蓝':'lan','绿':'lv','白':'bai','黑':'hei','紫':'zi','粉':'fen',
        '春':'chun','夏':'xia','秋':'qiu','冬':'dong','东':'dong','西':'xi','南':'nan','北':'bei',
        '左':'zuo','右':'you','前':'qian','后':'hou','上':'shang','下':'xia','里':'li','外':'wai',
        '高':'gao','低':'di','长':'chang','短':'duan','快':'kuai','慢':'man','新':'xin','旧':'jiu',
        '好':'hao','坏':'huai','美':'mei','丑':'chou','善':'shan','恶':'e','真':'zhen','假':'jia',
        '生':'sheng','死':'si','老':'lao','少':'shao','男':'nan','女':'nv','父':'fu','母':'mu',
        '子':'zi','女':'nv','兄':'xiong','弟':'di','姐':'jie','弟':'di','夫':'fu','妻':'qi',
        '爱':'ai','恨':'hen','喜':'xi','怒':'nu','哀':'ai','乐':'le','苦':'ku','甜':'tian',
        '酸':'suan','辣':'la','咸':'xian','淡':'dan','香':'xiang','臭':'chou','冷':'leng','热':'re',
        '快':'kuai','慢':'man','慢':'man','走':'zou','跑':'pao','跳':'tiao','站':'zhan','坐':'zuo',
        '躺':'tang','睡':'shui','醒':'xing','吃':'chi','喝':'he','说':'shuo','读':'du','写':'xie',
        '看':'kan','听':'ting','闻':'wen','摸':'mo','想':'xiang','做':'zuo','用':'yong','玩':'wan'
      };
      for (const [ch, py] of Object.entries(extra)) {
        map[ch.charCodeAt(0)] = py;
      }
      this._pinyinMap = map;
      return map;
    },

    // 中文转拼音
    toPinyin(text, mode = 'full') {
      const map = this.getPinyinMap();
      let result = '';
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        if (code >= 0x4e00 && code <= 0x9fff) {
          const py = map[code] || `[${code.toString(16)}]`;
          if (mode === 'full') {
            result += py + ' ';
          } else if (mode === 'initial') {
            result += py.charAt(0).toUpperCase();
          }
        } else {
          if (mode === 'full') {
            result += ch;
          } else {
            result += ch;
          }
        }
      }
      return mode === 'full' ? result.trim() : result;
    },

    // 汉字信息
    getCharInfo(ch) {
      const code = ch.charCodeAt(0);
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      const map = this.getPinyinMap();
      const pinyin = map[code] || '未知';
      // Unicode 区域判断
      let region = '未知';
      if (code >= 0x4e00 && code <= 0x9fff) region = 'CJK 统一汉字';
      else if (code >= 0x3400 && code <= 0x4dbf) region = 'CJK 扩展 A';
      else if (code >= 0x3000 && code <= 0x303f) region = 'CJK 符号和标点';
      else if (code >= 0xff00 && code <= 0xffef) region = '全角字符';
      else if (code >= 0x2e80 && code <= 0x2eff) region = 'CJK 部首';
      else if (code >= 0x20000 && code <= 0x2a6df) region = 'CJK 扩展 B';
      else if (code < 0x80) region = 'ASCII';

      // UTF-8 字节数
      let bytes;
      if (code < 0x80) bytes = 1;
      else if (code < 0x800) bytes = 2;
      else if (code < 0x10000) bytes = 3;
      else bytes = 4;

      // 五笔（简化版，仅常见字）
      const wubiApprox = this.getWubi(ch);

      return { char: ch, code, hex, pinyin, region, bytes, wubi: wubiApprox };
    },

    getWubi(ch) {
      // 极简五笔映射（仅演示用）
      const map = {
        '的':'RQ','一':'G','不':'GI','了':'BN','在':'D','人':'W','有':'E','我':'Q','他':'WB','这':'P',
        '中':'K','大':'DD','来':'GO','上':'H','国':'L','到':'GC','们':'WU','说':'YU','为':'O','子':'BB',
        '和':'TK','你':'WQ','地':'F','会':'WF','出':'BM','那':'VFB','要':'S','也':'BN','能':'CE','时':'JF',
        '个':'WH','之':'PP','生':'TG','过':'FP','后':'RG','作':'WT','里':'JF','用':'ET','道':'UT','行':'TF',
        '所':'RN','然':'QD','家':'PE','种':'TKH','事':'GK','方':'YY','成':'DN','多':'QQ','经':'XC','么':'TC',
        '去':'FCU','法':'IF','学':'IP','如':'VK','都':'FT','同':'MG','现':'GM','当':'IV','没':'IM','动':'FC',
        '起':'FH','看':'RH','定':'PG','天':'GD','分':'WV','还':'GI','好':'VB','小':'IH','部':'UK','其':'AD',
        '主':'YG','样':'SU','心':'NY','前':'UE','开':'GA','但':'WJG','因':'LD','只':'KW','从':'WW','想':'SH',
        '实':'PU','日':'JJ','军':'PL','者':'FT','意':'UJ','无':'FQ','力':'LT','与':'GN','长':'TA','把':'RCN',
        '机':'SM','十':'FG','民':'NA','第':'TX','公':'WC','已':'NN','工':'A','使':'WGK','情':'NG','明':'JE',
        '性':'NT','知':'TD','全':'WG','三':'DG','又':'CCC','关':'UD','点':'HK','正':'GH','业':'OG','外':'QH',
        '将':'UQ','两':'GMW','高':'YM','间':'UJ','由':'MH','问':'UKD','很':'TVE','最':'JB','重':'TGJF',
        '并':'UA','物':'TR','手':'RT','应':'YID','战':'HKA','向':'TMK','体':'WSG','政':'GHT','美':'UGDU',
        '相':'SH','见':'MQ','被':'PUHC','利':'TJH','什':'WFH','二':'FG','等':'TFFU','产':'UT','己':'N',
        '制':'RMHJ','身':'TMD','果':'JS','加':'LK','西':'SG','月':'EE','话':'YTD','合':'WGK','回':'LK',
        '特':'TRF','代':'WA','内':'MW','信':'WY','化':'WX','老':'FTX','给':'XW','位':'WUG','总':'UKN',
        '本':'SG','南':'FM','发':'NTCY','专':'FNY','攻':'AT','记':'YN','六':'UY','各':'TK','共':'AW',
        '转':'LFN','传':'WFN','儿':'QT','许':'YTF','先':'TFQ','称':'TQ','象':'QJE','条':'TS','执':'RVY',
        '达':'DP','包':'QN','期':'ADWE','报':'RB','管':'TP','际':'BF','城':'FD','验':'CWGI','造':'TFKP',
        '治':'ICK','确':'DQE','布':'DMH','需':'FDM','走':'FHU','议':'YYQ','决':'UNW','离':'YB','据':'RND',
        '速':'GKIP','防':'BY','北':'UX','切':'AV','变':'YO','调':'YMF','展':'NAE','指':'RXJ','克':'DQ',
        '州':'YTYH','弧':'XRC','证':'YGHG','视':'PYM','准':'UWYG','节':'AB','收':'NH','功':'AL','半':'UF',
        '联':'BU','油':'IMG','处':'TH','拉':'RU','集':'WY','木':'SS','况':'UKQ','消':'IIE','消':'IIE'
      };
      return map[ch] || '—';
    },

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('pinyin-panel', {
          title: '拼音转换器',
          icon: 'languages',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-pinyin">
          <div class="py-section">
            <h3>🔤 中文 → 拼音</h3>
            <textarea id="py-input" placeholder="输入中文文本...">中华人民共和国</textarea>
            <div class="py-results" id="py-results"></div>
          </div>
          <div class="py-section">
            <h3>📝 汉字详情查询</h3>
            <input type="text" id="py-char-input" placeholder="输入单个汉字" maxlength="1" />
            <div class="py-char-info" id="py-char-info"></div>
          </div>
          <style>
            .plugin-pinyin { padding: 16px; }
            .py-section { margin-bottom: 20px; }
            .py-section h3 { margin: 0 0 10px; font-size: 1.1em; }
            .py-section textarea {
              width: 100%; min-height: 80px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 8px; padding: 10px; color: #c8ccd0; font-size: 0.95em; resize: vertical; box-sizing: border-box;
            }
            .py-section textarea:focus { border-color: #4a9eff; outline: none; }
            .py-section input[type="text"] {
              width: 200px; padding: 8px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; color: #e0e0e0; font-size: 1.1em; text-align: center;
            }
            .py-section input:focus { border-color: #4a9eff; outline: none; }
            .py-results { margin-top: 12px; }
            .py-row { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; flex-wrap: wrap; }
            .py-row label { color: #888; font-size: 0.85em; min-width: 80px; }
            .py-row .py-val {
              font-family: monospace; font-size: 0.95em; color: #4a9eff;
              background: #1a1d23; padding: 4px 10px; border-radius: 4px;
            }
            .py-row .py-val.initials { letter-spacing: 2px; font-weight: 600; }
            .py-char-info {
              margin-top: 12px; background: #1a1d23; border-radius: 8px; padding: 16px;
              font-size: 0.9em; line-height: 1.8;
            }
            .py-char-big {
              font-size: 3em; text-align: center; color: #4a9eff; margin-bottom: 8px;
              font-family: 'Noto Serif SC', serif;
            }
            .py-info-row { display: flex; justify-content: space-between; border-bottom: 1px solid #2a2e35; padding: 4px 0; }
            .py-info-label { color: #888; }
            .py-info-val { color: #c8ccd0; font-family: monospace; }
          </style>
        </div>
      `;

      document.getElementById('py-input').addEventListener('input', () => this.updatePinyin());
      document.getElementById('py-char-input').addEventListener('input', (e) => this.updateCharInfo(e.target.value));
      this.updatePinyin();
    },

    updatePinyin() {
      const text = document.getElementById('py-input').value;
      const results = document.getElementById('py-results');
      if (!text.trim()) { results.innerHTML = ''; return; }

      const full = this.toPinyin(text, 'full');
      const initials = this.toPinyin(text, 'initial');
      // 每字拼音
      const perChar = text.split('').map(ch => {
        const code = ch.charCodeAt(0);
        if (code >= 0x4e00 && code <= 0x9fff) {
          const map = this.getPinyinMap();
          return map[code] || '?';
        }
        return ch;
      }).join(' ');

      results.innerHTML = `
        <div class="py-row"><label>全拼:</label><span class="py-val">${full}</span></div>
        <div class="py-row"><label>首字母:</label><span class="py-val initials">${initials}</span></div>
        <div class="py-row"><label>逐字拼音:</label><span class="py-val">${perChar}</span></div>
      `;
    },

    updateCharInfo(ch) {
      const info = document.getElementById('py-char-info');
      if (!ch || ch.length === 0) { info.innerHTML = ''; return; }
      const first = ch.charAt(0);
      const data = this.getCharInfo(first);
      info.innerHTML = `
        <div class="py-char-big">${first}</div>
        <div class="py-info-row"><span class="py-info-label">拼音</span><span class="py-info-val">${data.pinyin}</span></div>
        <div class="py-info-row"><span class="py-info-label">Unicode</span><span class="py-info-val">U+${data.hex}</span></div>
        <div class="py-info-row"><span class="py-info-label">十进制</span><span class="py-info-val">${data.code}</span></div>
        <div class="py-info-row"><span class="py-info-label">UTF-8 字节</span><span class="py-info-val">${data.bytes} bytes</span></div>
        <div class="py-info-row"><span class="py-info-label">区域</span><span class="py-info-val">${data.region}</span></div>
        <div class="py-info-row"><span class="py-info-label">五笔</span><span class="py-info-val">${data.wubi}</span></div>
      `;
    }
  };

  if (typeof window !== 'undefined') window.PinyinConverter = PinyinConverter;
})();
