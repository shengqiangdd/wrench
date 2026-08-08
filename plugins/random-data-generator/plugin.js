/**
 * 随机数据生成器插件
 * 
 * 生成各种类型的随机测试数据：姓名、邮箱、手机号、地址、IP、UUID、数字、日期
 */
(function() {
  const RandDataGen = {
    id: 'random-data-generator',
    name: '随机数据生成器',

    // 中文姓氏库
    surnames: ['张','李','王','刘','陈','杨','黄','赵','吴','周','徐','孙','马','朱','胡','林','郭','何','高','罗',
               '郑','梁','谢','宋','唐','许','韩','冯','邓','曹','彭','曾','萧','田','董','袁','潘','于','蒋','蔡',
               '余','杜','叶','程','苏','魏','吕','丁','任','沈','姚','卢','姜','崔','钟','谭','陆','汪','范','金'],
    // 中文名字库
    givenNames: ['伟','芳','娜','秀英','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀兰','霞',
                 '平','刚','桂英','文','云','建华','玉兰','桂兰','素珍','红','玉梅','建国','建军','志强','志明','志远',
                 '学明','学峰','文博','天翔','浩然','子轩','梓涵','宇航','思远','博文','嘉豪','俊杰','志豪','天宇','逸飞',
                 '文杰','明辉','国强','国华','建平','建明','海涛','海燕','晓燕','晓明','晓红','小芳','小刚','小强','小伟'],
    // 英文名库
    firstNamesEn: ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Elizabeth',
                   'David','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen',
                   'Daniel','Lisa','Matthew','Nancy','Anthony','Betty','Mark','Margaret','Donald','Sandra',
                   'Steven','Ashley','Paul','Dorothy','Andrew','Kimberly','Joshua','Emily','Kenneth','Donna',
                   'Kevin','Michelle','Brian','Carol','George','Amanda','Timothy','Melissa','Ronald','Deborah'],
    lastNamesEn: ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez',
                  'Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin',
                  'Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson',
                  'Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores',
                  'Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'],
    // 邮箱域名
    emailDomains: ['qq.com','163.com','126.com','gmail.com','outlook.com','hotmail.com','yahoo.com','foxmail.com','sina.com','sohu.com'],
    // 中国省份
    provinces: ['北京市','上海市','天津市','重庆市','河北省','山西省','辽宁省','吉林省','黑龙江省',
                '江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省',
                '广东省','海南省','四川省','贵州省','云南省','陕西省','甘肃省','青海省','台湾省',
                '内蒙古自治区','广西壮族自治区','西藏自治区','宁夏回族自治区','新疆维吾尔自治区'],
    cityPrefixes: ['石家庄','太原','沈阳','长春','哈尔滨','南京','杭州','合肥','福州','南昌',
                   '济南','郑州','武汉','长沙','广州','南宁','海口','成都','贵阳','昆明',
                   '拉萨','西安','兰州','西宁','银川','乌鲁木齐','呼和浩特','大连','青岛','深圳',
                   '厦门','宁波','苏州','无锡','佛山','东莞','珠海','中山','惠州','温州'],
    streets: ['人民路','中山路','解放路','建设路','和平路','光明路','文化路','科技路','创新路','学院路',
              '长江路','黄河路','西湖路','大学路','金融街','创业大道','中关村大街','天府大道','深南大道','世纪大道'],

    init() {
      this.registerCommands();
      this.registerPanels();
    },

    registerCommands() {
      this.registerCommand('rand-names', '随机姓名', () => this.generateNames());
      this.registerCommand('rand-emails', '随机邮箱', () => this.generateEmails());
      this.registerCommand('rand-numbers', '随机数字', () => this.generateNumbers());
      this.registerCommand('rand-ip', '随机 IP', () => this.generateIPs());
      this.registerCommand('rand-phones', '随机手机号', () => this.generatePhones());
      this.registerCommand('rand-address', '随机地址', () => this.generateAddresses());
      this.registerCommand('rand-json', '随机 JSON', () => this.generateJSON());
      this.registerCommand('rand-date', '随机日期', () => this.generateDates());
    },

    registerPanels() {
      this.registerPanel('rand-panel', {
        title: '随机数据生成器',
        icon: 'shuffle',
        render: (container) => this.renderPanel(container)
      });
    },

    registerCommand(id, label, handler) {
      if (typeof wrench !== 'undefined' && wrench.commands) {
        wrench.commands.register(id, label, handler);
      }
    },

    registerPanel(id, config) {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register(id, config);
      }
    },

    // ========== 通用工具函数 ==========
    randInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    randItem(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },

    randItems(arr, count) {
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.min(count, shuffled.length));
    },

    formatOutput(lines, title) {
      return `<div class="rand-output"><h4>${title}</h4><pre>${lines.join('\n')}</pre></div>`;
    },

    // ========== 各数据类型生成器 ==========
    generateChineseName() {
      return this.randItem(this.surnames) + this.randItem(this.givenNames);
    },

    generateEnglishName() {
      return this.randItem(this.firstNamesEn) + ' ' + this.randItem(this.lastNamesEn);
    },

    generateNames() {
      const count = 10;
      const lines = [];
      lines.push(`--- 随机中文姓名 (${count} 个) ---`);
      for (let i = 0; i < count; i++) lines.push(this.generateChineseName());
      lines.push('');
      lines.push(`--- 随机英文姓名 (${count} 个) ---`);
      for (let i = 0; i < count; i++) lines.push(this.generateEnglishName());
      return this.formatOutput(lines, '随机姓名');
    },

    generateEmails() {
      const count = 10;
      const lines = [`--- 随机邮箱 (${count} 个) ---`];
      for (let i = 0; i < count; i++) {
        const name = Math.random() > 0.5
          ? this.generateChineseName().replace(/\s/g, '') + this.randInt(1, 999)
          : (this.randItem(this.firstNamesEn).toLowerCase() + this.randItem(this.lastNamesEn).toLowerCase() + this.randInt(1, 999));
        lines.push(`${name}@${this.randItem(this.emailDomains)}`);
      }
      return this.formatOutput(lines, '随机邮箱');
    },

    generateNumbers() {
      const count = 20;
      const min = 1, max = 10000;
      const lines = [`--- 随机整数 [${min}, ${max}] (${count} 个) ---`];
      const nums = [];
      for (let i = 0; i < count; i++) nums.push(this.randInt(min, max));
      lines.push(nums.join(', '));
      lines.push('');
      lines.push(`--- 随机小数 [0, 1) (${count} 个) ---`);
      const floats = [];
      for (let i = 0; i < count; i++) floats.push(Math.random().toFixed(4));
      lines.push(floats.join(', '));
      return this.formatOutput(lines, '随机数字');
    },

    generateIPs() {
      const count = 10;
      const lines = [`--- 随机 IPv4 地址 (${count} 个) ---`];
      for (let i = 0; i < count; i++) {
        lines.push(`${this.randInt(1, 223)}.${this.randInt(0, 255)}.${this.randInt(0, 255)}.${this.randInt(1, 254)}`);
      }
      return this.formatOutput(lines, '随机 IP');
    },

    generatePhones() {
      const count = 10;
      const prefixes = ['130','131','132','133','134','135','136','137','138','139',
                        '150','151','152','153','155','156','157','158','159',
                        '170','171','172','173','175','176','177','178',
                        '180','181','182','183','184','185','186','187','188','189',
                        '191','193','195','196','197','198','199'];
      const lines = [`--- 随机手机号 (${count} 个) ---`];
      for (let i = 0; i < count; i++) {
        let num = this.randItem(prefixes);
        for (let j = 0; j < 8; j++) num += this.randInt(0, 9);
        lines.push(num);
      }
      return this.formatOutput(lines, '随机手机号');
    },

    generateAddresses() {
      const count = 5;
      const lines = [`--- 随机中文地址 (${count} 个) ---`];
      for (let i = 0; i < count; i++) {
        const prov = this.randItem(this.provinces);
        const city = this.randItem(this.cityPrefixes);
        const street = this.randItem(this.streets);
        const num = this.randInt(1, 300);
        lines.push(`${prov}${city}${street}${num}号`);
      }
      return this.formatOutput(lines, '随机地址');
    },

    generateJSON() {
      const count = 3;
      const lines = [`--- 随机 JSON 对象 ---`];
      for (let i = 0; i < count; i++) {
        const obj = {
          id: this.randInt(1000, 9999),
          name: this.randItem([...this.surnames.slice(0, 10), ...this.firstNamesEn.slice(0, 10)]) + this.randItem([...this.givenNames.slice(0, 10), ...this.lastNamesEn.slice(0, 10)]),
          email: `user${this.randInt(1, 999)}@${this.randItem(this.emailDomains)}`,
          age: this.randInt(18, 65),
          active: Math.random() > 0.3,
          score: parseFloat((Math.random() * 100).toFixed(1)),
          tags: this.randItems(['admin','user','vip','editor','guest','moderator','premium','test'], this.randInt(2, 4))
        };
        lines.push(JSON.stringify(obj, null, 2));
      }
      lines.push('');
      lines.push(`--- 随机 JSON 数组 ---`);
      const arr = [];
      for (let i = 0; i < 5; i++) {
        arr.push({ index: i, value: this.randInt(1, 100), label: `item_${this.randInt(100, 999)}` });
      }
      lines.push(JSON.stringify(arr, null, 2));
      return this.formatOutput(lines, '随机 JSON');
    },

    generateDates() {
      const count = 10;
      const start = new Date(2020, 0, 1);
      const end = new Date(2026, 11, 31);
      const lines = [`--- 随机日期 [2020-01-01 ~ 2026-12-31] (${count} 个) ---`];
      for (let i = 0; i < count; i++) {
        const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
        lines.push(d.toISOString().split('T')[0]);
      }
      lines.push('');
      lines.push(`--- 随机日期时间 (${count} 个) ---`);
      for (let i = 0; i < count; i++) {
        const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
        const h = String(this.randInt(0, 23)).padStart(2, '0');
        const m = String(this.randInt(0, 59)).padStart(2, '0');
        const s = String(this.randInt(0, 59)).padStart(2, '0');
        lines.push(`${d.toISOString().split('T')[0]} ${h}:${m}:${s}`);
      }
      return this.formatOutput(lines, '随机日期');
    },

    // ========== 面板渲染 ==========
    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-random-data">
          <div class="rd-controls">
            <h3>🎯 随机数据生成器</h3>
            <p class="rd-desc">一键生成各类测试数据，支持批量导出</p>
            <div class="rd-buttons">
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-names')">👤 随机姓名</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-emails')">📧 随机邮箱</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-numbers')">🔢 随机数字</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-ip')">🌐 随机 IP</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-phones')">📱 随机手机号</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-address')">📍 随机地址</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-json')">{ } 随机 JSON</button>
              <button class="rd-btn" onclick="RandDataGen.panelCmd('rand-date')">📅 随机日期</button>
            </div>
          </div>
          <div class="rd-output" id="rd-output">
            <p class="rd-placeholder">👆 点击上方按钮生成数据</p>
          </div>
          <style>
            .plugin-random-data { padding: 16px; }
            .rd-controls h3 { margin: 0 0 4px; font-size: 1.2em; }
            .rd-desc { color: #888; margin: 0 0 12px; font-size: 0.9em; }
            .rd-buttons { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-bottom: 16px; }
            .rd-btn {
              padding: 8px 12px; border: 1px solid #3a3f47; background: #2a2e35;
              color: #e0e0e0; border-radius: 6px; cursor: pointer; font-size: 0.9em;
              transition: all 0.2s;
            }
            .rd-btn:hover { background: #4a9eff33; border-color: #4a9eff; color: #4a9eff; }
            .rd-output {
              background: #1a1d23; border-radius: 8px; padding: 16px;
              max-height: 400px; overflow-y: auto;
            }
            .rd-output pre { margin: 0; white-space: pre-wrap; word-break: break-all; font-size: 0.85em; color: #c8ccd0; font-family: 'Cascadia Code', 'Fira Code', monospace; }
            .rd-placeholder { color: #555; text-align: center; padding: 24px 0; }
            .rand-output h4 { margin: 0 0 8px; color: #4a9eff; font-size: 0.95em; }
          </style>
        </div>
      `;
      window.RandDataGen = this;
    },

    panelCmd(cmdId) {
      const handler = {
        'rand-names': () => this.generateNames(),
        'rand-emails': () => this.generateEmails(),
        'rand-numbers': () => this.generateNumbers(),
        'rand-ip': () => this.generateIPs(),
        'rand-phones': () => this.generatePhones(),
        'rand-address': () => this.generateAddresses(),
        'rand-json': () => this.generateJSON(),
        'rand-date': () => this.generateDates(),
      }[cmdId];
      if (handler) {
        const output = document.getElementById('rd-output');
        if (output) output.innerHTML = handler();
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.RandDataGen = RandDataGen;
  }
})();
