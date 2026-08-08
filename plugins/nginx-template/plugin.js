/**
 * Nginx 配置生成器插件
 * 
 * 反向代理、静态服务、SSL、负载均衡、限流、Gzip 等常见配置一键生成
 */
(function() {
  const NginxTemplate = {
    id: 'nginx-template',
    name: 'Nginx 配置生成器',

    templates: {
      reverseProxy: {
        name: '反向代理',
        fields: [
          { id: 'np-domain', label: '域名', default: 'example.com', placeholder: 'example.com' },
          { id: 'np-port', label: '后端端口', default: '3000', placeholder: '3000' },
          { id: 'np-ws', label: '启用 WebSocket', type: 'checkbox', default: false },
          { id: 'np-gzip', label: '启用 Gzip', type: 'checkbox', default: true },
          { id: 'np-cache', label: '启用静态缓存', type: 'checkbox', default: false },
          { id: 'np-timeout', label: '超时时间(s)', default: '60', placeholder: '60' },
        ],
        generate: (vals) => {
          let ws = '';
          if (vals['np-ws']) {
            ws = `
    # WebSocket 支持
    location /ws {
        proxy_pass http://127.0.0.1:${vals['np-port']};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }`;
          }
          let gzip = '';
          if (vals['np-gzip']) {
            gzip = `
    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;`;
          }
          let cache = '';
          if (vals['np-cache']) {
            cache = `
    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:${vals['np-port']};
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }`;
          }
          return `# Nginx 反向代理配置
# 生成时间: ${new Date().toISOString()}

server {
    listen 80;
    server_name ${vals['np-domain']};

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    ${gzip}

    # 主代理
    location / {
        proxy_pass http://127.0.0.1:${vals['np-port']};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout ${vals['np-timeout']}s;
        proxy_send_timeout ${vals['np-timeout']}s;
        proxy_read_timeout ${vals['np-timeout']}s;
    }
${ws}${cache}
}`;
        }
      },

      static: {
        name: '静态文件服务',
        fields: [
          { id: 'st-domain', label: '域名', default: 'example.com' },
          { id: 'st-root', label: '网站根目录', default: '/var/www/html' },
          { id: 'st-index', label: '默认首页', default: 'index.html' },
          { id: 'st-gzip', label: '启用 Gzip', type: 'checkbox', default: true },
          { id: 'st-cors', label: '启用 CORS', type: 'checkbox', default: false },
        ],
        generate: (vals) => {
          let cors = '';
          if (vals['st-cors']) {
            cors = `
    # CORS 跨域
    add_header Access-Control-Allow-Origin * always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;`;
          }
          return `# Nginx 静态文件服务配置

server {
    listen 80;
    server_name ${vals['st-domain']};
    root ${vals['st-root']};
    index ${vals['st-index']};
${cors}
    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
${vals['st-gzip'] ? `
    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml image/svg+xml;
` : ''}
    # 静态资源缓存
    location ~* \.(jpg|jpeg|png|gif|ico|svg|webp)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.(css|js|woff|woff2|ttf|eot)$ {
        expires 7d;
        add_header Cache-Control "public";
        access_log off;
    }

    # SPA 路由支持（如果需要，取消注释）
    # location / {
    #     try_files $uri $uri/ /index.html;
    # }

    location / {
        try_files $uri $uri/ =404;
    }

    # 禁止访问隐藏文件
    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}`;
        }
      },

      ssl: {
        name: 'HTTPS / SSL',
        fields: [
          { id: 'ssl-domain', label: '域名', default: 'example.com' },
          { id: 'ssl-port', label: '后端端口', default: '3000' },
          { id: 'ssl-cert', label: '证书路径', default: '/etc/letsencrypt/live/example.com/fullchain.pem' },
          { id: 'ssl-key', label: '私钥路径', default: '/etc/letsencrypt/live/example.com/privkey.pem' },
          { id: 'ssl-redirect', label: '强制 HTTPS 重定向', type: 'checkbox', default: true },
          { id: 'ssl-hsts', label: '启用 HSTS', type: 'checkbox', default: true },
          { id: 'ssl-stapling', label: '启用 OCSP Stapling', type: 'checkbox', default: true },
        ],
        generate: (vals) => {
          let redirect = '';
          if (vals['ssl-redirect']) {
            redirect = `
# HTTP → HTTPS 重定向
server {
    listen 80;
    server_name ${vals['ssl-domain']};
    return 301 https://$host$request_uri;
}`;
          }
          let hsts = vals['ssl-hsts'] ? '\n    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;' : '';
          let stapling = vals['ssl-stapling'] ? `
    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    resolver 8.8.8.8 1.1.1.1 valid=300s;
    resolver_timeout 5s;` : '';

          return `${redirect}

server {
    listen 443 ssl http2;
    server_name ${vals['ssl-domain']};

    # SSL 证书
    ssl_certificate ${vals['ssl-cert']};
    ssl_certificate_key ${vals['ssl-key']};

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
${hsts}${stapling}

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # 反向代理
    location / {
        proxy_pass http://127.0.0.1:${vals['ssl-port']};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}`;
        }
      },

      loadbalance: {
        name: '负载均衡',
        fields: [
          { id: 'lb-domain', label: '域名', default: 'example.com' },
          { id: 'lb-method', label: '均衡策略', type: 'select', options: [
            { value: 'round-robin', label: '轮询 (默认)' },
            { value: 'weighted', label: '加权轮询' },
            { value: 'ip-hash', label: 'IP Hash' },
            { value: 'least-conn', label: '最少连接' },
          ], default: 'round-robin' },
          { id: 'lb-servers', label: '后端服务器 (每行一个 IP:端口)', type: 'textarea',
            default: '127.0.0.1:3001\n127.0.0.1:3002\n127.0.0.1:3003' },
          { id: 'lb-fail-timeout', label: '故障超时(s)', default: '10' },
          { id: 'lb-fallback', label: '备用服务器端口', default: '3000' },
        ],
        generate: (vals) => {
          const servers = vals['lb-servers'].split('\n').filter(l => l.trim());
          let method = '';
          let balance = '';
          switch (vals['lb-method']) {
            case 'weighted':
              balance = servers.map((s, i) => `    server ${s.trim()} weight=${servers.length - i};`).join('\n');
              break;
            case 'ip-hash':
              balance = servers.map(s => `    server ${s.trim()};`).join('\n');
              method = '\n    ip_hash;';
              break;
            case 'least-conn':
              balance = servers.map(s => `    server ${s.trim()};`).join('\n');
              method = '\n    least_conn;';
              break;
            default:
              balance = servers.map(s => `    server ${s.trim()};`).join('\n');
          }

          return `# Nginx 负载均衡配置
# 策略: ${vals['lb-method']}

upstream backend {
${method}
${balance}

    # 健康检查
    keepalive 32;
}

# 备用服务器（全部后端故障时使用）
upstream backend_fallback {
    server 127.0.0.1:${vals['lb-fallback']};
}

server {
    listen 80;
    server_name ${vals['lb-domain']};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 健康检查失败时切换到备用
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_timeout ${vals['lb-fail-timeout']}s;
        proxy_connect_timeout ${vals['lb-fail-timeout']}s;

        # WebSocket
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 后端全部故障时的备用响应
    error_page 502 503 504 = @fallback;
    location @fallback {
        proxy_pass http://backend_fallback;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}`;
        }
      },
    },

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('nginx-panel', {
          title: 'Nginx 配置生成器',
          icon: 'server',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    renderPanel(container) {
      const tabsHtml = Object.entries(this.templates).map(([key, t], i) =>
        `<button class="ng-tab ${i === 0 ? 'active' : ''}" data-tpl="${key}">${t.name}</button>`
      ).join('');

      container.innerHTML = `
        <div class="plugin-nginx">
          <div class="ng-tabs">${tabsHtml}</div>
          <div class="ng-body">
            <div class="ng-fields" id="ng-fields"></div>
            <button class="ng-gen" id="ng-gen">⚡ 生成配置</button>
            <div class="ng-output-wrap">
              <div class="ng-output-header">
                <span>📄 生成的配置</span>
                <button class="ng-copy" id="ng-copy">📋 复制</button>
              </div>
              <pre class="ng-output" id="ng-output"></pre>
            </div>
          </div>
          <style>
            .plugin-nginx { padding: 16px; }
            .ng-tabs { display: flex; gap: 4px; margin-bottom: 14px; flex-wrap: wrap; }
            .ng-tab {
              padding: 6px 14px; background: #1a1d23; border: 1px solid #3a3f47;
              color: #888; border-radius: 6px; cursor: pointer; font-size: 0.9em;
            }
            .ng-tab.active { background: #4a9eff22; color: #4a9eff; border-color: #4a9eff; }
            .ng-fields { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
            .ng-field { display: flex; align-items: center; gap: 10px; }
            .ng-field label { min-width: 120px; color: #aaa; font-size: 0.85em; }
            .ng-field input[type="text"], .ng-field select {
              flex: 1; padding: 6px 10px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 4px; color: #e0e0e0; font-size: 0.85em;
            }
            .ng-field input[type="checkbox"] { accent-color: #4a9eff; }
            .ng-field textarea {
              flex: 1; min-height: 60px; padding: 6px 10px; background: #1a1d23;
              border: 1px solid #3a3f47; border-radius: 4px; color: #e0e0e0;
              font-family: monospace; font-size: 0.85em; resize: vertical;
            }
            .ng-gen {
              padding: 8px 20px; background: #4a9eff; color: #fff; border: none;
              border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600;
              margin-bottom: 14px;
            }
            .ng-gen:hover { background: #3a8eef; }
            .ng-output-wrap { border: 1px solid #3a3f47; border-radius: 8px; overflow: hidden; }
            .ng-output-header {
              display: flex; justify-content: space-between; align-items: center;
              padding: 8px 12px; background: #2a2e35; color: #888; font-size: 0.85em;
            }
            .ng-copy { padding: 2px 8px; background: #3a3f47; border: none; color: #aaa; border-radius: 3px; cursor: pointer; font-size: 0.85em; }
            .ng-copy:hover { background: #4a9eff33; color: #4a9eff; }
            .ng-output {
              margin: 0; padding: 14px; background: #1a1d23; color: #c8ccd0;
              font-family: 'Cascadia Code', monospace; font-size: 0.8em;
              white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto;
              line-height: 1.5;
            }
          </style>
        </div>
      `;

      // Tab 切换
      container.querySelectorAll('.ng-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.ng-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderFields(tab.dataset.tpl);
        });
      });

      // 生成
      document.getElementById('ng-gen').addEventListener('click', () => this.generate());

      // 复制
      document.getElementById('ng-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('ng-output').textContent);
        const btn = document.getElementById('ng-copy');
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 1500);
      });

      // 默认渲染第一个模板
      this.renderFields(Object.keys(this.templates)[0]);
    },

    renderFields(tplKey) {
      const tpl = this.templates[tplKey];
      const fields = document.getElementById('ng-fields');
      fields.innerHTML = tpl.fields.map(f => {
        if (f.type === 'checkbox') {
          return `<div class="ng-field">
            <label>${f.label}</label>
            <input type="checkbox" id="${f.id}" ${f.default ? 'checked' : ''} />
          </div>`;
        } else if (f.type === 'select') {
          const opts = f.options.map(o => `<option value="${o.value}" ${o.value === f.default ? 'selected' : ''}>${o.label}</option>`).join('');
          return `<div class="ng-field">
            <label>${f.label}</label>
            <select id="${f.id}">${opts}</select>
          </div>`;
        } else if (f.type === 'textarea') {
          return `<div class="ng-field">
            <label>${f.label}</label>
            <textarea id="${f.id}" placeholder="${f.placeholder || ''}">${f.default}</textarea>
          </div>`;
        } else {
          return `<div class="ng-field">
            <label>${f.label}</label>
            <input type="text" id="${f.id}" value="${f.default}" placeholder="${f.placeholder || ''}" />
          </div>`;
        }
      }).join('');
    },

    generate() {
      const activeTab = document.querySelector('.ng-tab.active');
      if (!activeTab) return;
      const tplKey = activeTab.dataset.tpl;
      const tpl = this.templates[tplKey];

      const vals = {};
      tpl.fields.forEach(f => {
        if (f.type === 'checkbox') {
          vals[f.id] = document.getElementById(f.id)?.checked || false;
        } else {
          vals[f.id] = document.getElementById(f.id)?.value || f.default || '';
        }
      });

      const config = tpl.generate(vals);
      document.getElementById('ng-output').textContent = config;
    }
  };

  if (typeof window !== 'undefined') window.NginxTemplate = NginxTemplate;
})();
