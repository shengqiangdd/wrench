# Wrench 本机 SSH Agent（预览）

本机 Agent 让 SSH 连接从运行浏览器的电脑发起，供该电脑已经接入的 LAN/VPN 使用。现阶段仅实现 SSH 终端；**本机模式 SFTP 尚未实现**。公网目标和服务端已可达目标继续使用默认的 Wrench 服务端模式，仍受 `WRENCH_EGRESS_ALLOW` 与 `WRENCH_EGRESS_STRICT` 管理。

## 构建和启动

需要仓库固定的 Rust 工具链（见 `rust-toolchain.toml`）。在用户自己的电脑上从源码构建（仓库将 Cargo 输出目录设在根目录的 `target/` 下）：

```sh
cd backend
cargo build --release --bin wrench-agent
../target/release/wrench-agent https://wrench.example.com
```

Windows PowerShell：

```powershell
cd backend
cargo build --release --bin wrench-agent
..\target\release\wrench-agent.exe https://wrench.example.com
```

维护者可在 GitHub Actions 的 **Package Local SSH Agent** 手动运行打包工作流。它会在 Linux、macOS、Windows 原生 runner 上分别运行 Agent 单测并构建 release binary，生成包含二进制、运行说明和 MIT LICENSE 的压缩包及 SHA-256 校验文件，作为 workflow artifact 提供下载；它不会创建 GitHub Release，也不会部署 Agent。artifact 有效期为 30 天。首次发布或升级前应先完成对应平台下载包的安装和启动验证。

参数必须是浏览器地址栏里的**精确网页 origin**（协议、主机和非默认端口），不带路径。Agent 在终端输出随机的 `http://127.0.0.1:<port>` 地址和一次性 pairing token。保持 Agent 前台运行；首次构建、重启 Agent 后需重新配对。不要以 root/管理员身份运行 Agent。

在 Wrench 的「设置 → 本机 SSH Agent」粘贴地址和一次性 token，配对后，在新建/编辑 SSH 连接时选择「本机 Agent」。连接目标必须填写 IPv4/IPv6 字面地址；只接受 RFC1918 私网、IPv6 ULA 或 IPv4 链路本地地址，拒绝域名、公网、loopback、unspecified 和 multicast。Agent 不提供通用 TCP/SOCKS/HTTP 代理。

每次建立 SSH 连接，Agent 终端会显示用户名、IP 和端口并要求输入 `yes`。首次遇到该目标的 SSH host key 时，还要在本机终端检查并确认显示的 SHA256 指纹；Agent 将接受的 host key 保存在 `~/.wrench-agent/known_hosts`（Windows 位于用户 home 下同名目录）。之后 key 变化会拒绝连接。密码和私钥通过浏览器到 loopback WebSocket 发送给 Agent，不发给 Wrench 服务端；私钥在本机解析，目前不支持需要口令解锁的加密私钥。配对令牌只允许使用一次，配对后的 session token 仅保存在当前浏览器标签页的 `sessionStorage`，并绑定当前 Wrench space code；切换空间或轮换空间码后须重启 Agent 并重新配对。

## 手机浏览器

Agent 必须与浏览器运行在同一台设备上。把 Agent 安装在桌面电脑后，手机浏览器不能通过当前实现连接那台电脑的 Agent；Agent 只绑定 loopback，也没有远程中继或通用代理。

- **当前可用的手机方案：Wrench 服务端模式。** 手机网页只负责控制，实际 SSH 连接从 Wrench 服务器发起。只有在服务器有到目标内网的路由，并且管理员的 `WRENCH_EGRESS_ALLOW` / `WRENCH_EGRESS_STRICT` 允许时才可用。该模式会把 SSH 凭据交给 Wrench 服务端，连接来源也是服务端。
- **Android：本机 Termux 路径仍属实验。** 需要在同一台 Android 设备本机运行 Android 可执行的 Agent；当前没有 Android 下载包，也没有完成 Termux 构建、浏览器本地权限及真机 SSH 验证。Linux/macOS/Windows 下载包不能用于 Android。不要据此把 Agent 改成监听 Wi-Fi/LAN 地址。
- **iPhone/iPad：当前没有本机 Agent 支持。** Safari 不能启动这个 Rust 可执行程序；请使用上述服务端模式（服务器必须能到达目标），或在已运行 Agent 的桌面设备上使用桌面浏览器。

Android 上若未来运行了兼容 Agent，浏览器对本机网络访问可能要求用户授权；Chrome 的 Local Network Access 权限从 Chrome 142 开始推出，仍须按实际浏览器版本验证。[Chrome Local Network Access 说明](https://developer.chrome.com/blog/local-network-access)

## 网络和权限边界

- Agent 只绑定 `127.0.0.1` 上的随机端口；不监听 LAN 地址。
- `/pair` 和 WebSocket 都要求浏览器 `Origin` 与启动参数精确相同，并校验 `Host` 为 `127.0.0.1:<当前随机端口>`。配对使用 256-bit 随机一次性 token；WebSocket 首帧必须提供配对后 token。
- SSH host 必须是私网/链路本地 IP 字面地址；没有 DNS 解析、端口转发、通用代理或自动扫描。每次拨号前由 Agent 所在终端审批。
- host key 首次信任由本机终端确认；信任记录留在本机，已登记主机密钥变更时 fail closed。
- 浏览器和操作系统可能对网站访问 loopback/LAN 显示本地网络权限提示；需要允许本站访问本机 Agent。Chrome 142 起 secure context 的本地网络访问会经过用户权限提示；Agent 仅在精确 allowlisted Origin 下回答相应 CORS 私网预检。浏览器的权限、HTTPS 与 WebSocket 混合内容策略可能因浏览器和版本而异。
- Agent 目前只有终端协议，没有本机 SFTP API。切换到本机模式时 SFTP 请求会明确报未实现，不会回退服务器端 SSH。

`WRENCH_REQUIRE_AUTH=off` 的服务端认证语义没有改变；Agent 有单独的一次性配对和每次连接本机审批。服务器出口 profile 仍只表示 Wrench 服务器的源地址/路由，不表示本机 Agent。
