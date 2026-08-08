/**
 * Docker Compose 生成器插件
 * 
 * Web应用栈、监控栈、开发工具栈一键生成
 */
(function() {
  const DockerComposeGen = {
    id: 'docker-compose-gen',
    name: 'Docker Compose 生成器',

    templates: {
      webapp: {
        name: '🌐 Web 应用栈',
        desc: 'Node.js/Python Web + PostgreSQL + Redis + Nginx',
        fields: [
          { id: 'dc-name', label: '项目名称', default: 'myapp' },
          { id: 'dc-web-port', label: 'Web 端口', default: '3000' },
          { id: 'dc-db-name', label: '数据库名', default: 'myapp_db' },
          { id: 'dc-db-user', label: '数据库用户', default: 'appuser' },
          { id: 'dc-db-pass', label: '数据库密码', default: 'changeme123' },
          { id: 'dc-redis-pass', label: 'Redis 密码', default: '' },
          { id: 'dc-volume', label: '数据持久化', type: 'checkbox', default: true },
        ],
        generate: (v) => `version: '3.8'

# 🐳 ${v['dc-name']} - Web 应用栈
# 包含: Web + PostgreSQL + Redis + Nginx

services:
  # 前端/应用服务
  web:
    image: node:20-alpine
    container_name: ${v['dc-name']}-web
    working_dir: /app
    volumes:
      - ./:/app
    ports:
      - "${v['dc-web-port']}:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://${v['dc-db-user']}:${v['dc-db-pass']}@postgres:5432/${v['dc-db-name']}
      - REDIS_URL=redis://${v['dc-redis-pass'] ? v['dc-db-user'] + ':' + v['dc-redis-pass'] + '@' : ''}redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - app-net

  # 数据库
  postgres:
    image: postgres:16-alpine
    container_name: ${v['dc-name']}-postgres
    environment:
      POSTGRES_DB: ${v['dc-db-name']}
      POSTGRES_USER: ${v['dc-db-user']}
      POSTGRES_PASSWORD: ${v['dc-db-pass']}
    ports:
      - "5432:5432"${v['dc-volume'] ? `
    volumes:
      - postgres_data:/var/lib/postgresql/data` : ''}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${v['dc-db-user']} -d ${v['dc-db-name']}"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - app-net

  # 缓存
  redis:
    image: redis:7-alpine
    container_name: ${v['dc-name']}-redis
    command: redis-server ${v['dc-redis-pass'] ? '--requirepass ' + v['dc-redis-pass'] : ''} --appendonly yes
    ports:
      - "6379:6379"${v['dc-volume'] ? `
    volumes:
      - redis_data:/data` : ''}
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    restart: unless-stopped
    networks:
      - app-net

  # 反向代理
  nginx:
    image: nginx:alpine
    container_name: ${v['dc-name']}-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - web
    restart: unless-stopped
    networks:
      - app-net${v['dc-volume'] ? `

volumes:
  postgres_data:
  redis_data:` : ''}

networks:
  app-net:
    driver: bridge`
      },

      monitor: {
        name: '📊 监控栈',
        desc: 'Prometheus + Grafana + AlertManager + Node Exporter',
        fields: [
          { id: 'dc-mon-port', label: 'Grafana 端口', default: '3001' },
          { id: 'dc-prom-port', label: 'Prometheus 端口', default: '9090' },
          { id: 'dc-grafana-pass', label: 'Grafana 管理员密码', default: 'admin123' },
          { id: 'dc-data', label: '数据持久化', type: 'checkbox', default: true },
        ],
        generate: (v) => `version: '3.8'

# 📊 ${new Date().toISOString()} - 监控栈
# Prometheus + Grafana + AlertManager + Node Exporter + cAdvisor

services:
  # 指标采集
  prometheus:
    image: prom/prometheus:latest
    container_name: monitoring-prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro${v['dc-data'] ? `
      - prometheus_data:/prometheus` : ''}
    ports:
      - "${v['dc-prom-port']}:9090"
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.enable-lifecycle'
    networks:
      - monitor-net

  # 可视化
  grafana:
    image: grafana/grafana:latest
    container_name: monitoring-grafana
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: ${v['dc-grafana-pass']}
      GF_INSTALL_PLUGINS: grafana-clock-panel,grafana-piechart-panel
    volumes:${v['dc-data'] ? `
      - grafana_data:/var/lib/grafana` : `
      - grafana_data:/var/lib/grafana`}
      - ./grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
      - ./grafana/datasources:/etc/grafana/provisioning/datasources:ro
    ports:
      - "${v['dc-mon-port']}:3000"
    depends_on:
      - prometheus
    networks:
      - monitor-net

  # 告警
  alertmanager:
    image: prom/alertmanager:latest
    container_name: monitoring-alertmanager
    volumes:
      - ./alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
    ports:
      - "9093:9093"
    networks:
      - monitor-net

  # 系统指标
  node-exporter:
    image: prom/node-exporter:latest
    container_name: monitoring-node-exporter
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--path.rootfs=/rootfs'
    ports:
      - "9100:9100"
    networks:
      - monitor-net

  # 容器指标
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: monitoring-cadvisor
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    ports:
      - "8080:8080"
    networks:
      - monitor-net

volumes:
  prometheus_data:
  grafana_data:

networks:
  monitor-net:
    driver: bridge

# 📝 配置说明
# 1. 创建 prometheus.yml 配置采集目标
# 2. 创建 grafana/dashboards/ 和 grafana/datasources/ 目录
# 3. 创建 alertmanager.yml 配置告警规则
# 4. 访问 Grafana: http://localhost:${v['dc-mon-port']}
# 5. 访问 Prometheus: http://localhost:${v['dc-prom-port']}`
      },

      tools: {
        name: '🛠️ 开发工具栈',
        desc: 'MailHog + MinIO + PostgreSQL + pgAdmin',
        fields: [
          { id: 'dc-tools-pg', label: 'PostgreSQL 端口', default: '5432' },
          { id: 'dc-tools-minio', label: 'MinIO 端口', default: '9000' },
          { id: 'dc-tools-minio-ui', label: 'MinIO Console 端口', default: '9001' },
          { id: 'dc-tools-pgadmin', label: 'pgAdmin 端口', default: '5050' },
          { id: 'dc-tools-mail', label: 'MailHog 端口', default: '8025' },
          { id: 'dc-tools-vol', label: '数据持久化', type: 'checkbox', default: true },
        ],
        generate: (v) => `version: '3.8'

# 🛠️ 开发工具栈
# PostgreSQL + pgAdmin + MinIO (S3) + MailHog + Redis

services:
  # 数据库
  postgres:
    image: postgres:16-alpine
    container_name: devtools-postgres
    environment:
      POSTGRES_DB: devdb
      POSTGRES_USER: devuser
      POSTGRES_PASSWORD: devpass
    ports:
      - "${v['dc-tools-pg']}:5432"${v['dc-tools-vol'] ? `
    volumes:
      - pg_data:/var/lib/postgresql/data` : ''}
    networks:
      - devtools-net

  # 数据库管理
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: devtools-pgadmin
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@admin.com
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "${v['dc-tools-pgadmin']}:80"
    depends_on:
      - postgres
    networks:
      - devtools-net

  # 对象存储 (S3 兼容)
  minio:
    image: minio/minio:latest
    container_name: devtools-minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "${v['dc-tools-minio']}:9000"
      - "${v['dc-tools-minio-ui']}:9001"${v['dc-tools-vol'] ? `
    volumes:
      - minio_data:/data` : ''}
    networks:
      - devtools-net

  # 邮件测试
  mailhog:
    image: mailhog/mailhog:latest
    container_name: devtools-mailhog
    ports:
      - "${v['dc-tools-mail']}:8025"
      - "1025:1025"
    networks:
      - devtools-net

  # 缓存
  redis:
    image: redis:7-alpine
    container_name: devtools-redis
    ports:
      - "6379:6379"
    networks:
      - devtools-net${v['dc-tools-vol'] ? `

volumes:
  pg_data:
  minio_data:` : ''}

networks:
  devtools-net:
    driver: bridge

# 🔧 使用说明
# PostgreSQL:  postgresql://devuser:devpass@localhost:${v['dc-tools-pg']}/devdb
# pgAdmin:     http://localhost:${v['dc-tools-pgadmin']}  (admin@admin.com / admin)
# MinIO:       http://localhost:${v['dc-tools-minio-ui']} (minioadmin / minioadmin)
# MailHog:     http://localhost:${v['dc-tools-mail']}`
      },
    },

    init() {
      if (typeof wrench !== 'undefined' && wrench.panels) {
        wrench.panels.register('docker-panel', {
          title: 'Docker Compose 生成器',
          icon: 'box',
          render: (container) => this.renderPanel(container)
        });
      }
    },

    renderPanel(container) {
      const tabsHtml = Object.entries(this.templates).map(([key, t], i) =>
        `<button class="dc-tab ${i === 0 ? 'active' : ''}" data-tpl="${key}">${t.name}</button>`
      ).join('');

      container.innerHTML = `
        <div class="plugin-docker">
          <div class="dc-tabs">${tabsHtml}</div>
          <div class="dc-desc" id="dc-desc"></div>
          <div class="dc-fields" id="dc-fields"></div>
          <button class="dc-gen" id="dc-gen">🐳 生成 docker-compose.yml</button>
          <div class="dc-output-wrap">
            <div class="dc-output-header">
              <span>📄 docker-compose.yml</span>
              <button class="dc-copy" id="dc-copy">📋 复制</button>
            </div>
            <pre class="dc-output" id="dc-output"></pre>
          </div>
          <style>
            .plugin-docker { padding: 16px; }
            .dc-tabs { display: flex; gap: 4px; margin-bottom: 10px; flex-wrap: wrap; }
            .dc-tab {
              padding: 6px 14px; background: #1a1d23; border: 1px solid #3a3f47;
              color: #888; border-radius: 6px; cursor: pointer; font-size: 0.9em;
            }
            .dc-tab.active { background: #2196f322; color: #2196f3; border-color: #2196f3; }
            .dc-desc { color: #888; font-size: 0.85em; margin-bottom: 12px; }
            .dc-fields { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
            .dc-field { display: flex; align-items: center; gap: 10px; }
            .dc-field label { min-width: 140px; color: #aaa; font-size: 0.85em; }
            .dc-field input[type="text"] {
              flex: 1; padding: 6px 10px; background: #1a1d23; border: 1px solid #3a3f47;
              border-radius: 4px; color: #e0e0e0; font-size: 0.85em;
            }
            .dc-field input[type="checkbox"] { accent-color: #2196f3; }
            .dc-gen {
              padding: 8px 20px; background: #2196f3; color: #fff; border: none;
              border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; margin-bottom: 14px;
            }
            .dc-gen:hover { background: #1e88e5; }
            .dc-output-wrap { border: 1px solid #3a3f47; border-radius: 8px; overflow: hidden; }
            .dc-output-header {
              display: flex; justify-content: space-between; align-items: center;
              padding: 8px 12px; background: #2a2e35; color: #888; font-size: 0.85em;
            }
            .dc-copy { padding: 2px 8px; background: #3a3f47; border: none; color: #aaa; border-radius: 3px; cursor: pointer; }
            .dc-copy:hover { background: #2196f333; color: #2196f3; }
            .dc-output {
              margin: 0; padding: 14px; background: #1a1d23; color: #c8ccd0;
              font-family: 'Cascadia Code', monospace; font-size: 0.8em;
              white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; line-height: 1.5;
            }
          </style>
        </div>
      `;

      container.querySelectorAll('.dc-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          container.querySelectorAll('.dc-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderFields(tab.dataset.tpl);
        });
      });

      document.getElementById('dc-gen').addEventListener('click', () => this.generate());
      document.getElementById('dc-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(document.getElementById('dc-output').textContent);
        const btn = document.getElementById('dc-copy');
        btn.textContent = '✅ 已复制';
        setTimeout(() => btn.textContent = '📋 复制', 1500);
      });

      this.renderFields(Object.keys(this.templates)[0]);
    },

    renderFields(tplKey) {
      const tpl = this.templates[tplKey];
      document.getElementById('dc-desc').textContent = tpl.desc;
      const fields = document.getElementById('dc-fields');
      fields.innerHTML = tpl.fields.map(f => {
        if (f.type === 'checkbox') {
          return `<div class="dc-field"><label>${f.label}</label><input type="checkbox" id="${f.id}" ${f.default ? 'checked' : ''} /></div>`;
        }
        return `<div class="dc-field"><label>${f.label}</label><input type="text" id="${f.id}" value="${f.default}" /></div>`;
      }).join('');
    },

    generate() {
      const activeTab = document.querySelector('.dc-tab.active');
      if (!activeTab) return;
      const tpl = this.templates[activeTab.dataset.tpl];
      const vals = {};
      tpl.fields.forEach(f => {
        if (f.type === 'checkbox') {
          vals[f.id] = document.getElementById(f.id)?.checked || false;
        } else {
          vals[f.id] = document.getElementById(f.id)?.value || f.default || '';
        }
      });
      document.getElementById('dc-output').textContent = tpl.generate(vals);
    }
  };

  if (typeof window !== 'undefined') window.DockerComposeGen = DockerComposeGen;
})();
