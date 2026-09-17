# 🚀 棘轮工具箱 Wrench 部署指南

## 📋 部署方案对比

| 方案 | 复杂度 | 适用场景 |
|------|--------|---------|
| **Docker Compose** | ⭐ 低 | 推荐，一键部署 |
| **手动部署** | ⭐⭐ 中 | 调试或自定义配置 |
| **Nginx + Systemd** | ⭐⭐⭐ 中高 | 生产环境高可用 |

---

## 🐳 方案一：Docker Compose（推荐）

### 快速启动

```bash
# 首次使用请先设置 JWT_SECRET 环境变量
export JWT_SECRET=$(openssl rand -hex 32)

docker compose up -d
# 访问 http://localhost:3001
```

`docker-compose.yml` 已预配置：
- 命名数据卷 `wrench-data` 自动挂载到 `/data`，SQLite 数据库持久化不丢失
- `JWT_SECRET` 从环境变量注入（必填，用于令牌签发和 Vault 加密）
- 健康检查每 30s 探测 `/api/health`

### 数据持久化（SQLite）

Wrench 使用 SQLite 存储审计日志、告警、凭据保险箱、通知渠道和 SSH 连接配置。
使用 `docker-compose.yml` 中的命名数据卷 `wrench-data`，重启或升级容器后数据不丢失。

备份 SQLite 数据库：

```bash
docker run --rm -v wrench_wrench-data:/data -v $(pwd):/backup alpine cp /data/wrench.db /backup/wrench-$(date +%Y%m%d).db
```

手动运行（不依赖 docker-compose）：

```bash
# 创建持久化目录
mkdir -p /data/wrench

# 运行容器并挂载数据卷
docker run -d \
  -p 3001:3001 \
  --name wrench \
  --restart unless-stopped \
  -v /data/wrench:/data \
  -e DATABASE_URL=/data/wrench.db \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  ghcr.io/shengqiangdd/wrench:latest

# 停止后数据保留在 /data/wrench/wrench.db
# 备份: cp /data/wrench/wrench.db backup-$(date +%Y%m%d).db
```

### 构建并运行

```bash
# 仅构建（利用多阶段构建缓存：Cargo 依赖层 + npm 缓存）
export JWT_SECRET=$(openssl rand -hex 32)
docker compose build

# 启动
docker compose up -d

# 查看信号诊断日志
docker logs wrench

# 预期看到：
# [entrypoint] $(date) Starting Wrench backend...
# [entrypoint] $(date) Backend started (PID xxx)
# ... (如果有信号到达会被记录)
```

---

## 🔧 方案二：手动部署

### 1. 构建前端

```bash
cd frontend
npm install
npm run build     # 输出到 frontend/dist/
```

### 2. 构建 Rust 后端（生产模式）

```bash
cd backend
# 首次构建需要安装 Rust 工具链（版本由仓库根 rust-toolchain.toml 指定，当前 1.96.1）
# curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo build --release --locked
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 设置以下变量：
# JWT_SECRET=your-jwt-secret           # 令牌签名密钥（必填，用于认证和 Vault 加密）
# DATABASE_URL=wrench.db             # SQLite 数据库路径
# WRENCH_REQUIRE_AUTH=on              # 门开关：on（默认）= 要口令；off = 访问者零输入直进
# WRENCH_AUTH_PASSWORD=...             # 入口口令（由部署侧提供；门开着却没给 → 受保护接口一律 503）
# BRIDGE_HOST=0.0.0.0                # 监听地址：注意变量名是 BRIDGE_HOST，不是 HOST
# BRIDGE_PORT=3001                   # 监听端口：注意变量名是 BRIDGE_PORT，不是 PORT
```

### 4. 启动后端

```bash
./target/release/wrench-backend
# 后端自动托管 frontend/dist/ 静态文件，监听端口 3001
# SQLite 数据库自动创建，WAL 模式确保并发安全
# 支持 /api/* REST + /ws WebSocket + SPA 静态文件一站式服务
```

### 5. 使用 Systemd 实现进程守护（Linux）

创建 `/etc/systemd/system/wrench.service`：

```ini
[Unit]
Description=Wrench Web IDE (Rust backend)
After=network.target

[Service]
Type=simple
User=wrench
WorkingDirectory=/opt/wrench
ExecStart=/opt/wrench/wrench
Restart=always
RestartSec=10
Environment=JWT_SECRET=your-secret-key
Environment=DATABASE_URL=/opt/wrench/data/wrench.db
Environment=WRENCH_AUTH_PASSWORD=change-me
Environment=BRIDGE_HOST=0.0.0.0
Environment=BRIDGE_PORT=3001
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable wrench
sudo systemctl start wrench
sudo systemctl status wrench
```

---

## 🌐 方案三：Nginx 反向代理

```nginx
server {
    listen 80;
    server_name wrench.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wrench.example.com;

    ssl_certificate     /etc/letsencrypt/live/wrench.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wrench.example.com/privkey.pem;

    # 静态资源缓存
    location /assets/ {
        proxy_pass http://127.0.0.1:3001;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket 连接
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 前端页面
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_PORT` | `3001` | 后端监听端口（注意：不是 `PORT`） |
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址（注意：不是 `HOST`） |
| `DATABASE_URL` | `无` (Docker 内默认 `/data/wrench.db`) | SQLite 数据库路径 |
| `JWT_SECRET` | 自动生成 | 用于令牌签发和 Vault 加密密钥派生 |
| `WRENCH_REQUIRE_AUTH` | `on` | 门开关。`off` = **不设门**：访问者零输入直进（没有登录界面，也不要求任何口令）；此时空间隔离照旧（每个浏览器一个私有空间），机器能力请靠 `WRENCH_EGRESS_ALLOW` 收敛。拼错的值一律按 `on` 处理 |
| `WRENCH_AUTH_PASSWORD` | 无 | **入口口令，由部署侧提供**（没有「网页首次设置」这条路）。设置后以 PBKDF2 哈希落库（明文不写文件），改它会让所有旧令牌立即失效。门开着却没给口令 → 受保护接口一律 503（fail-closed） |
| `WRENCH_AUTH_PASSWORD_FILE` | 无 | 从文件读取登录口令（优先级低于环境变量）。不设置时回退到数据库同目录的 `auth_password` —— 只读，不会自动创建 |
| `WRENCH_EGRESS_ALLOW` | 空 | **这台机器允许主动连到哪里**（逗号分隔的 `IP[:端口]` / `CIDR[:端口]`，只接受 IP/CIDR）。留空 = 内网/环回/链路本地/云元数据/保留地址一律拒绝。例：`192.168.1.5:22,192.168.1.6:22`。**条目越窄越安全**：每个条目都是「任何人打开网页后可以用来发起连接的目标」，不要整段放开内网 |
| `WRENCH_EGRESS_STRICT` | `0` | 置 `1` 时公网 TCP 目标也必须在 `WRENCH_EGRESS_ALLOW` 里（只管理固定几台主机时更严） |
| `WRENCH_TRUSTED_PROXIES` | 空 | **反向代理地址/网段**（逗号分隔的 IP/CIDR）。留空 = 完全不信任 `X-Forwarded-For`/`X-Real-IP`。挂了 HTTPS 反代却不设置，会让登录限流退化成全局共享配额、审计日志只记代理 IP |
| `WRENCH_CSP` | `plugins` | `strict` 去掉 CSP 里的 `'unsafe-eval'`（不使用插件时更严）；`off` 关闭 CSP（不建议） |
| `WRENCH_HSTS` | 开启 | `off` 时不主动下发 HSTS（外层代理已下发时用）；仅在请求确为 HTTPS 时生效 |
| `VAULT_KEY` | `无` (从 JWT_SECRET 派生) | Secret Vault AES-256-GCM 加密密钥，建议显式设置 |
| `LOG_LEVEL` | `info` | 日志级别 (trace/debug/info/warn/error) |
| `FRONTEND_DIST` | `./frontend/dist` | 前端静态文件目录路径 |
| `OPENROUTER_API_KEY` | 无 | AI 功能 API Key |
| `ssh_test_host` | 无 | SSH 快速连接测试主机（开发用） |
| `ssh_test_user` | 无 | SSH 快速连接测试用户（开发用） |
| `ssh_test_password` | 无 | SSH 快速连接测试主机密码（开发用）。**默认不回显给浏览器**：`/api/ssh/test-config` 只回 `hasPassword`，因为任何能打开网页的人都读得到它 —— 那会把「进门口令」升级成「进服务器的口令」。确实需要预填时显式打开 `WRENCH_EXPOSE_SSH_TEST_PASSWORD=1` |
| `WRENCH_EXPOSE_SSH_TEST_PASSWORD` | `0` | 置 `1` 时 `/api/ssh/test-config` 才把 `ssh_test_password` 回显给浏览器。仅限本机开发 |
| `GITHUB_TOKEN` | 无 | GitHub API Token（插件市场功能） |
| `RUST_LOG` | `info` | Rust 日志级别 |

> **入口口令由部署侧决定，访问者永远不用设口令。** 两种姿势：
>
> ```bash
> # ① 要口令门：在这里给出口令（推荐 openssl rand -base64 32）
> WRENCH_AUTH_PASSWORD='...'
> # ② 不要口令门：零输入直进
> WRENCH_REQUIRE_AUTH=off
> ```
>
> 门开着却没给口令 → 网页显示「等待部署侧配置」，所有受保护接口 503（fail-closed）。
> 之所以不再有「网页首次设置」，是因为它要求访问者先去容器日志里翻一次性令牌 ——
> 那正是「不人性化」的来源。

---

## 🚪 出口策略：这台机器允许主动连到哪里

Wrench 是「跑在服务器上的 SSH 客户端」——目标主机与端口来自浏览器请求。所以只要实例能被
公网访问，任何打开网页的人都能让**这台服务器**替他去连它连得到的东西（内网其他机器、
容器网络里的服务、云元数据 `169.254.169.254`）。入口口令只决定「谁能进门」，不决定
「进门后能连哪里」，因此可达范围由服务端声明：

```yaml
# docker-compose.yml
environment:
  # 只列真正需要管理的主机；留空 = 内网/环回/链路本地/云元数据地址一律拒绝
  WRENCH_EGRESS_ALLOW: "192.168.1.5:22,192.168.1.6:22"
  # WRENCH_EGRESS_STRICT: "1"   # 连公网目标也要求写进白名单
```

规则速览：

| 目标 | SSH/SFTP（TCP 通道） | HTTP(S) 通道（插件下载、AI `base_url`、webhook） |
|------|----------------------|--------------------------------------------------|
| 内网/环回（RFC1918、ULA、CGNAT） | 必须写进 `WRENCH_EGRESS_ALLOW` | 必须写进 `WRENCH_EGRESS_ALLOW` |
| 公网地址 | 默认放行（`WRENCH_EGRESS_STRICT=1` 时也需声明） | 默认放行 |
| 链路本地 / 云元数据 / 未指定 / 组播 / 广播 / 保留段 | 一律拒绝，写白名单也没用 | 一律拒绝，写白名单也没用 |

- **条目越窄越安全。** 每个白名单条目都等价于「任何人打开这个网页后可以用来发起连接的目标」。
  如果你希望实例公网可达又不加口令，白名单就是唯一的结构性边界：写 `192.168.1.0/24:22`
  意味着陌生人可以拿你的机器去撞整个网段（虽然仍要过目标主机自己的认证），写
  `192.168.1.5:22` 就只放行那一台。
- **启动即确认**：容器日志里会打一行摘要，先看这个再放流量。

  ```bash
  docker logs wrench 2>&1 | grep 出口策略
  # 出口策略：WRENCH_EGRESS_ALLOW=[192.168.1.5:22]，公网 TCP 目标默认放行；HTTP(S) 出口一律禁止私网/环回/链路本地/元数据地址
  ```

- 白名单写错（例如写了域名）不会「配错就全放开」：解析失败按空白名单处理（内网全拒）
  并在日志打 error。
- 被拒绝的连接会返回可读原因，例如
  「出口策略拒绝了SSH/SFTP 连接 192.168.1.9:22：192.168.1.9（内网地址）不在实例的可达白名单中。
  如需连接，请由实例管理员把目标加入 WRENCH_EGRESS_ALLOW（例如 192.168.1.9:22）」，
  并写入审计日志（动作 `ssh_egress_denied`）。

### 可选第二层：网络层再收一道（需要 root）

应用层策略是主防线；若还想让「绕过应用也不可能进内网」，可在宿主机用 `DOCKER-USER` 链
限制容器出站（保留公网出站，否则 AI 网关、通知 webhook 会一起失效）：

```bash
# 容器所在网段（默认 bridge）
SUBNET=$(docker network inspect bridge --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' | head -1)

iptables -I DOCKER-USER -s "$SUBNET" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -I DOCKER-USER -s "$SUBNET" -d 192.168.1.5 -p tcp --dport 22 -j RETURN   # 白名单主机
iptables -I DOCKER-USER -s "$SUBNET" -d 192.168.0.0/16 -j DROP                    # 其余内网
iptables -I DOCKER-USER -s "$SUBNET" -d 10.0.0.0/8 -j DROP
iptables -I DOCKER-USER -s "$SUBNET" -d 172.16.0.0/12 -j DROP
```

> 这些规则重启后不保留，需要 `netfilter-persistent`（Debian/Ubuntu）或
> `iptables-services`（RHEL 系）持久化；改完先确认容器仍能访问所需目标。

---

## 🔒 反向代理与安全响应头

### 挂了代理就必须告诉后端「谁才是客户端」

生产环境通常在前面放 Nginx / Caddy / 面板做 HTTPS，此时 TCP 对端**永远是代理的地址**。
不配置下面这个变量会静默降级成两个真实问题：

- **限流坍缩**：登录接口的「每 IP 60 秒 8 次」变成全局 8 次/分钟——别人打满你就进不来了，
  而攻击者的尝试也不再各占配额。
- **审计失真**：`audit_logs.ip` 全是代理地址，出事之后无法判断是谁连了哪台机器。

```yaml
environment:
  # 你的反向代理所在地址/网段（逗号分隔，支持 IP 或 CIDR）
  WRENCH_TRUSTED_PROXIES: "172.17.0.1,10.0.0.0/8"
```

规则（**默认不信任任何代理头**，这是刻意的）：

| 情况 | 行为 |
|------|------|
| 未设置 `WRENCH_TRUSTED_PROXIES` | 只信 TCP 对端 IP，`X-Forwarded-For` / `X-Real-IP` **一律忽略** |
| 对端不在受信网段内 | 同上（所以别人伪造 `X-Forwarded-For: 1.2.3.4` 无效，绕不过限流） |
| 对端在受信网段内 | 从右往左取 `X-Forwarded-For` 里第一个不受信地址 = 真实客户端 |

启动日志会打印一行确认：

```bash
docker logs wrench 2>&1 | grep client_ip
# [client_ip] 受信代理 1 个网段（来自 WRENCH_TRUSTED_PROXIES）：限流与审计将使用代理头里的真实客户端 IP
```

> 反代要记得传 `X-Forwarded-For`（Nginx 默认 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
> 即可）与 `X-Forwarded-Proto`（HTTPS 识别、`Secure` cookie 与 HSTS 都依赖它）。

### 安全响应头（默认开启）

后端会对**所有**响应下发安全头：`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、
`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`、
`Cross-Origin-Opener-Policy`、`X-Permitted-Cross-Domain-Policies: none`；
只有确认请求是 HTTPS（`X-Forwarded-Proto: https`）时才附加
`Strict-Transport-Security: max-age=15552000`（132 天，刻意不含 `includeSubDomains`）。

CSP 里有两处**必要**的放宽，其余都是最严：

- `style-src 'unsafe-inline'`：xterm.js 运行时注入 `<style>`，React 也用 style 属性。
- `script-src 'unsafe-eval'`：插件运行时用 `new Function` 执行插件代码。插件本来就以页面
  同源权限运行，这条不额外扩大暴露面；**不使用插件的部署**可以关掉它：

  ```yaml
  WRENCH_CSP: "strict"   # 去掉 'unsafe-eval'（插件功能会失效，其它功能不受影响）
  WRENCH_CSP: "off"      # 完全关闭 CSP（不建议）
  WRENCH_HSTS: "off"     # 不下发 HSTS（例如外层代理已经自己下发）
  ```

`script-src` 里**没有** `'unsafe-inline'`：`index.html` 里的开发期热更新 shim 已挪到
`public/refresh-shim.js`（外部文件），所以内联 `<script>` 注入这条路（XSS 最常用的入口）
是真的被堵住的。

---

## 👥 多人共用与私有空间

本实例是「无角色」的多人共用：谁都可以用，**人人平等**，但每个人的数据互相看不见。

| 概念 | 说明 |
|------|------|
| **入口口令** | 只负责挡住公网扫描者，不是权限。网页里可改（设置 → 入口口令） |
| **空间** | 每个浏览器第一次带着有效令牌访问时自动创建，7 张业务表按 `space_id` 隔离 |
| **空间码** | 256 bit 随机值。服务端**只存 SHA-256**，明文只下发一次，由浏览器保存 |

要点：

- **换设备 / 换浏览器**：登录后在「设置 → 我的空间」粘贴空间码即可找回自己的主机与 Vault。
  请把空间码当成密码保存好 —— 连部署者也无法帮你找回（服务端只有哈希）。
- **重新生成空间码**：旧码立即失效，其它设备需要粘贴新码才能进同一空间。
- **升级前的历史数据**：第一次启动时若检测到无归属的历史行，启动日志里会打印**一次性认领码**
  （`[space] 一次性认领码：…`），在网页里粘贴即可把这些数据收归自己名下；认领后码即失效。
- **`DATABASE_URL` 是必需的**：没有可用数据库时空间隔离无法保证，受保护接口一律返回 503
  （失败关闭），不会退化成「所有人共用一个空间」。
- **整库下载已移除**：`/api/system/db-download` 不存在了（多人共用下等于泄露所有人的凭据）。
  需要备份请直接在宿主机上拷 `wrench.db`。

---

## 📈 终端里的进度输出（客户端已默认处理，无需配置）

在手机/窄终端里跑 `docker compose pull`、`docker build` 时，动画进度块会不断重画，
块比可见行数高时**每帧都会往滚动历史里塞重复行**（实测 44 列 × 12 行跑一次 20 服务 pull：
3012 行、其中 2151 行重复）。这是终端语义决定的，客户端已在两处默认处理：

- **终端画布（默认开）**：窄视口下把 PTY 逻辑屏抬到 30 行（列数不动），可见区只是这扇屏上
  的一扇窗（跟随光标、可上下平移），块再高也原地重绘 —— 实测同一场景 0 堆行
  （独立 VT 模拟器复核：44×12 → 推入 scrollback 86 行 / 重复 36 行；44×30 → **0**）。
  右上角「画布」芯片可关掉（回到贴屏 1:1，给 `tmux` / `top` 这类程序用）。
- **注入安静进度变量（跟随画布）**：画布**关掉后**（没有行数兜底）连接时自动下发
  `COMPOSE_PROGRESS=plain`、`BUILDKIT_PROGRESS=plain`、`DOCKER_CLI_HINTS=false`
  （前两个是 docker 官方支持的 progress 开关），把 docker 家族的整块重画切成逐行日志；
  画布开着（默认）则不注入，保留动画进度。
  右上角 `plain` 芯片可随时显式开/关（选择存在浏览器本地，此后不再跟随画布）——
  想要"能滚动回看的逐行日志"就点它。画布长到上限（80 行）而块还在长时，终端会提示一次。
- **提示符守卫**：只有识别到真实 shell 提示符时才注入 —— 全屏 TUI 里、`sudo`/`ssh` 密码提示里
  不会硬注入（否则等于把你的命令敲进密码框）。

需要额外注意的两点：

- **容器内 / 嵌套 shell 不继承**：`docker exec -it xxx bash` 进去以后要自己 `export`，
  或者 `docker exec -e COMPOSE_PROGRESS=plain -it xxx bash`。
- **没有开关的程序**：极少数程序既整块重画又不自我裁剪，用管道让它退化成纯文本即可：

  ```bash
  docker pull nginx:alpine 2>&1 | cat
  ```

这一节纯客户端行为，升级镜像即生效，没有对应的环境变量。

---

## 📊 健康检查

```bash
curl http://localhost:3001/api/health
# 返回: {"status":"ok","uptime":123}
```

## 🛡️ 安全建议

1. **生产环境务必使用反向代理**（Nginx / Caddy），并把代理地址写进 `WRENCH_TRUSTED_PROXIES`
   （否则限流与审计日志会把所有人记成同一个 IP，见上文「反向代理与安全响应头」）
2. **启用 HTTPS**（Let's Encrypt 免费证书）
3. 配置 **IP 白名单**或**基础认证**
4. 定期更新依赖：`npm audit`（前端）、`cargo audit`（后端，需 `cargo install cargo-audit`）。
   已知豁免集中记录在 `backend/.cargo/audit.toml`（当前只有一条：`RUSTSEC-2023-0071`，rsa，上游无补丁）。
   新增豁免请写进该文件并注明理由与复查条件 —— 审计扫出漏洞时应当让 CI 变红，不要用 `continue-on-error` 掩盖。
5. **SSH 私钥优先用 ed25519**：Rust 生态的 `rsa` crate 存在时序侧信道（`RUSTSEC-2023-0071`），
   上游至今没有补丁，而 Wrench 作为 SSH 客户端用私钥认证时正好落在这个风险面上。
   ed25519 是纯签名算法、不受影响；长期或高价值的 RSA 私钥不建议交给 Wrench 使用。
6. **明文凭据不许进仓库**（这条是本项目的真实教训，不是通用建议）。
   本仓库此前把 `deploy*.py` 提交过，里面写着服务器 IP + 用户名 + **明文口令**，而仓库是公开的。
   文件后来删了，但**删除只影响 HEAD、不影响历史** —— `git log -p` 至今仍翻得出来，
   已经 push 出去的东西无法撤回。所以：

   - 门禁：`tools/check-secrets.sh`（与 CI `.github/workflows/ci-secrets.yml` 同一份规则）
     在**提交前**扫暂存区、CI 扫全树、每周扫一次全历史。真跑起来它不单是形式：
     它会命中私钥头、GitHub/AWS/Slack/`sk-` 令牌、`sshpass -p`、以及
     `password = "字面量"` 这类赋值式写法（测试夹具与 `#[cfg(test)]` 块已排除，
     误报可在行内加 `secret-scan:ignore`）。
   - 已经泄露过的具体口令：**轮换它**，这是唯一真正有效的动作；同时把那串写进本机
     `~/.wrench-secret-denylist`（或 `$WRENCH_SECRET_DENYLIST` 指向的文件，一行一个，
     **不进仓库**），防止它被再次提交。
   - 可选（动作大、需确认）：用 `git filter-repo` 重写历史去掉那段 blob，再 force push。
     注意：force push 后旧 commit 仍可能被 GitHub 的缓存/他人的 fork 持有，
     所以**轮换永远是第一步**，重写历史只是补充。
   - 部署口令一律走 `.env` / 环境变量（`.env` 已在 `.gitignore` 里）。
     尤其是 `JWT_SECRET`：它同时是 Vault 的解密密钥来源，丢了它历史密文就解不开，
     但它**绝不**能进仓库或出现在对话/日志里。

7. 使用非 root 用户运行服务
8. **SSH 凭据不进服务端**：服务端只保存连接元数据（`GET`/`DELETE /api/connections`，没有写入端点）。
   若你的库是从早期版本升级上来的，里面可能还躺着明文凭据的历史行（`config` 里带 `password`/
   `private_key`）：接口读取时已强制脱敏，但仍建议清掉，例如
   `curl -H "Authorization: Bearer <token>" -X DELETE https://<你的域名>/api/connections/<id>`。
   备份/迁移 `wrench.db` 前也请确认这些行已清理。
