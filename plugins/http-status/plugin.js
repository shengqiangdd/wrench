/**
 * HTTP 状态码速查插件
 * 
 * 完整 HTTP 状态码参考表，按类别筛选，搜索，快速复制
 */
(function() {
  const HttpStatus = {
    id: 'http-status',
    name: 'HTTP 状态码速查',

    codes: [
      // 1xx 信息
      [100, 'Continue', '继续', '客户端应继续发送请求的剩余部分'],
      [101, 'Switching Protocols', '切换协议', '服务器同意客户端切换协议（如 WebSocket）'],
      [102, 'Processing', '处理中', '服务器正在处理请求，但尚无响应'],
      [103, 'Early Hints', '早期提示', '帮助用户代理预加载资源'],

      // 2xx 成功
      [200, 'OK', '成功', '请求成功，返回结果'],
      [201, 'Created', '已创建', '请求成功并创建了新资源'],
      [202, 'Accepted', '已接受', '请求已接受但尚未处理完成'],
      [203, 'Non-Authoritative Information', '非权威信息', '返回的信息来自第三方缓存'],
      [204, 'No Content', '无内容', '请求成功，但没有返回内容'],
      [205, 'Reset Content', '重置内容', '请求成功，客户端应重置视图'],
      [206, 'Partial Content', '部分内容', '服务器返回了部分资源（Range 请求）'],
      [207, 'Multi-Status', '多状态', 'WebDAV：返回多个子请求的状态'],
      [208, 'Already Reported', '已报告', 'WebDAV：元素已在之前的响应中列出'],
      [226, 'IM Used', '增量编码已用', '服务器成功处理了 GET 请求的增量编码'],

      // 3xx 重定向
      [300, 'Multiple Choices', '多种选择', '请求有多种可能的响应'],
      [301, 'Moved Permanently', '永久移动', '资源已永久移至新 URL'],
      [302, 'Found', '临时移动', '资源临时移至新 URL（历史上误用为 303）'],
      [303, 'See Other', '查看其他', '应使用 GET 方法获取新资源'],
      [304, 'Not Modified', '未修改', '资源未修改，使用缓存'],
      [305, 'Use Proxy', '使用代理', '必须通过指定代理访问'],
      [307, 'Temporary Redirect', '临时重定向', '资源临时移至新 URL，方法不变'],
      [308, 'Permanent Redirect', '永久重定向', '资源永久移至新 URL，方法不变'],

      // 4xx 客户端错误
      [400, 'Bad Request', '错误请求', '请求语法有误，服务器无法理解'],
      [401, 'Unauthorized', '未认证', '需要用户身份验证'],
      [402, 'Payment Required', '需要付费', '预留用于未来支付系统'],
      [403, 'Forbidden', '禁止访问', '服务器拒绝请求，无权访问'],
      [404, 'Not Found', '未找到', '请求的资源不存在'],
      [405, 'Method Not Allowed', '方法不允许', '请求方法不被目标资源支持'],
      [406, 'Not Acceptable', '不可接受', '无法生成满足 Accept 头的内容'],
      [407, 'Proxy Authentication Required', '代理认证需要', '需要先通过代理认证'],
      [408, 'Request Timeout', '请求超时', '服务器等待请求超时'],
      [409, 'Conflict', '冲突', '请求与服务器当前状态冲突'],
      [410, 'Gone', '已删除', '资源已永久删除'],
      [411, 'Length Required', '需要长度', '需要 Content-Length 头'],
      [412, 'Precondition Failed', '前置条件失败', '请求头中的条件不满足'],
      [413, 'Content Too Large', '内容过大', '请求体超过服务器限制'],
      [414, 'URI Too Long', 'URI 过长', '请求 URI 超过服务器限制'],
      [415, 'Unsupported Media Type', '不支持的媒体类型', '请求格式不被支持'],
      [416, 'Range Not Satisfiable', '范围不可满足', '无法满足请求的字节范围'],
      [417, 'Expectation Failed', '期望失败', 'Expect 头的期望无法满足'],
      [418, "I'm a Teapot", '我是茶壶', '愚人节彩蛋：拒绝冲泡咖啡（我是茶壶）'],
      [421, 'Misdirected Request', '请求指向错误', '请求被路由到无法产生响应的服务器'],
      [422, 'Unprocessable Content', '不可处理内容', '语法正确但语义错误'],
      [423, 'Locked', '已锁定', 'WebDAV：资源被锁定'],
      [424, 'Failed Dependency', '依赖失败', 'WebDAV：前序请求失败'],
      [425, 'Too Early', '太早', '服务器担心请求可能被重放'],
      [426, 'Upgrade Required', '需要升级', '需要切换到其他协议'],
      [428, 'Precondition Required', '需要前置条件', '需要先满足条件请求'],
      [429, 'Too Many Requests', '请求过多', '客户端发送请求太快'],
      [431, 'Request Header Fields Too Large', '请求头过大', '请求头字段太大'],
      [451, 'Unavailable For Legal Reasons', '因法律原因不可用', '资源因法律要求被删除'],

      // 5xx 服务端错误
      [500, 'Internal Server Error', '服务器内部错误', '服务器遇到意外情况，无法完成请求'],
      [501, 'Not Implemented', '未实现', '服务器不支持请求的功能'],
      [502, 'Bad Gateway', '网关错误', '作为网关/代理的服务器从上游收到无效响应'],
      [503, 'Service Unavailable', '服务不可用', '服务器暂时过载或维护中'],
      [504, 'Gateway Timeout', '网关超时', '作为网关/代理的服务器等待上游响应超时'],
      [505, 'HTTP Version Not Supported', 'HTTP 版本不支持', '服务器不支持请求中的 HTTP 版本'],
      [506, 'Variant Also Negotiates', '变体也协商', '服务器有内部配置错误'],
      [507, 'Insufficient Storage', '存储不足', 'WebDAV：服务器存储不足'],
      [508, 'Loop Detected', '检测到循环', 'WebDAV：处理请求时检测到无限循环'],
      [510, 'Not Extended', '未扩展', '需要进一步扩展请求'],
      [511, 'Network Authentication Required', '网络认证需要', '需要网络认证才能访问'],
    ],

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('http-panel', {
          title: 'HTTP 状态码速查',
          icon: 'globe',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    getColor(code) {
      if (code < 200) return '#4a9eff';     // 蓝色 1xx
      if (code < 300) return '#4caf50';     // 绿色 2xx
      if (code < 400) return '#ff9800';     // 橙色 3xx
      if (code < 500) return '#f44336';     // 红色 4xx
      return '#e91e63';                      // 粉色 5xx
    },

    getCategory(code) {
      if (code < 200) return '1xx 信息';
      if (code < 300) return '2xx 成功';
      if (code < 400) return '3xx 重定向';
      if (code < 500) return '4xx 客户端错误';
      return '5xx 服务端错误';
    },

    renderPanel(container) {
      container.innerHTML = `
        <div class="plugin-http-status">
          <div class="hs-controls">
            <input type="text" id="hs-search" placeholder="🔍 搜索状态码或关键词..." />
            <div class="hs-filters">
              <button class="hs-filter active" data-cat="all">全部</button>
              <button class="hs-filter" data-cat="1" style="color:#4a9eff">1xx</button>
              <button class="hs-filter" data-cat="2" style="color:#4caf50">2xx</button>
              <button class="hs-filter" data-cat="3" style="color:#ff9800">3xx</button>
              <button class="hs-filter" data-cat="4" style="color:#f44336">4xx</button>
              <button class="hs-filter" data-cat="5" style="color:#e91e63">5xx</button>
            </div>
          </div>
          <div class="hs-table-wrap">
            <table class="hs-table">
              <thead>
                <tr>
                  <th>状态码</th>
                  <th>英文名</th>
                  <th>中文名</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody id="hs-tbody"></tbody>
            </table>
          </div>
          <div class="hs-count" id="hs-count"></div>
          <style>
            .plugin-http-status { padding: 16px; }
            .hs-controls { margin-bottom: 12px; }
            .hs-controls input {
              width: 100%; padding: 8px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 6px; color: #e0e0e0; font-size: 0.9em; box-sizing: border-box;
            }
            .hs-controls input:focus { border-color: #4a9eff; outline: none; }
            .hs-filters { display: flex; gap: 4px; margin-top: 8px; }
            .hs-filter {
              padding: 4px 12px; background: #1a1d23; border: 1px solid #3a3f47;
              color: #888; border-radius: 4px; cursor: pointer; font-size: 0.85em;
            }
            .hs-filter.active { background: #4a9eff22; color: #4a9eff; border-color: #4a9eff; }
            .hs-table-wrap { max-height: 500px; overflow-y: auto; }
            .hs-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
            .hs-table th {
              position: sticky; top: 0; background: #2a2e35; padding: 8px 10px;
              text-align: left; color: #888; font-weight: 600;
            }
            .hs-table td { padding: 6px 10px; border-top: 1px solid #2a2e35; }
            .hs-table tr { cursor: pointer; transition: background 0.15s; }
            .hs-table tbody tr:hover { background: #4a9eff11; }
            .hs-code {
              font-family: monospace; font-weight: 700; font-size: 1em;
              padding: 2px 8px; border-radius: 4px; display: inline-block; min-width: 40px; text-align: center;
            }
            .hs-en { color: #c8ccd0; }
            .hs-cn { color: #aaa; }
            .hs-desc { color: #777; font-size: 0.9em; }
            .hs-count { text-align: center; color: #555; font-size: 0.8em; margin-top: 8px; }
          </style>
        </div>
      `;

      // 筛选按钮
      container.querySelectorAll('.hs-filter').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.hs-filter').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.renderTable();
        });
      });

      // 搜索
      document.getElementById('hs-search').addEventListener('input', () => this.renderTable());

      this.renderTable();
    },

    renderTable() {
      const activeCat = document.querySelector('.hs-filter.active')?.dataset.cat || 'all';
      const search = (document.getElementById('hs-search')?.value || '').toLowerCase();
      const tbody = document.getElementById('hs-tbody');
      if (!tbody) return;

      const filtered = this.codes.filter(([code, en, cn, desc]) => {
        if (activeCat !== 'all' && !String(code).startsWith(activeCat)) return false;
        if (search) {
          const text = `${code} ${en} ${cn} ${desc}`.toLowerCase();
          if (!text.includes(search)) return false;
        }
        return true;
      });

      tbody.innerHTML = filtered.map(([code, en, cn, desc]) => {
        const color = this.getColor(code);
        return `<tr onclick="HttpStatus.copyCode(${code})" title="点击复制状态码">
          <td><span class="hs-code" style="background:${color}22;color:${color}">${code}</span></td>
          <td class="hs-en">${en}</td>
          <td class="hs-cn">${cn}</td>
          <td class="hs-desc">${desc}</td>
        </tr>`;
      }).join('');

      document.getElementById('hs-count').textContent = `共 ${filtered.length} 个状态码`;
    },

    copyCode(code) {
      navigator.clipboard.writeText(String(code));
    }
  };

  if (typeof window !== 'undefined') window.HttpStatus = HttpStatus;
})();
