//! 出口策略（egress policy）——这台机器被允许主动连到哪里。
//!
//! # 为什么需要它
//!
//! Wrench 的本质是「跑在服务器上的 SSH 客户端」：目标主机与端口来自客户端请求
//! （`api/ssh.rs`、`websocket/terminal.rs`）。只要这个地址能达到公网，任何人都能让
//! **这台服务器**替他去连它连得到的东西——这就是跳板。入口口令只解决「谁能进门」，
//! 解决不了「进门之后能连哪里」这个根本能力，所以可达范围必须由服务端声明。
//!
//! # 两条出口通道，规则不同
//!
//! - **TCP 通道**（SSH / SFTP / 健康探测，长连接、面向被管理主机）：
//!   私网、环回、链路本地、云元数据、保留地址**默认拒绝**；必须在 `WRENCH_EGRESS_ALLOW`
//!   里显式声明才放行（如 `192.168.1.5:22`）。公网目标默认放行（与「直接上网」等价，
//!   不构成跳板）；`WRENCH_EGRESS_STRICT=1` 时公网目标也要求声明。
//! - **HTTP(S) 通道**（插件下载、AI 网关、通知 webhook、市场索引）：
//!   禁止解析到私网/环回/链路本地/元数据地址（SSRF 防护），公网放行；白名单内的
//!   内网地址放行。解析出的 IP 会被**钉住**（防 DNS rebinding），重定向逐跳校验，
//!   响应体限量。
//!
//! 无论白名单怎么写，链路本地（含 `169.254.169.254` 云元数据）、未指定、组播、
//! 广播地址一律拒绝：这些地址没有任何「被管理主机」的正当用途。

use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::{LazyLock, RwLock};
use std::time::Duration;

/// 可达白名单，逗号分隔：`IP[:端口]` 或 `CIDR[:端口]`（只接受 IP/CIDR，不接受域名，
/// 避免解析歧义）。例：`192.168.1.5:22,10.0.0.0/24:22,[fd00::5]:22`
pub const ENV_ALLOW: &str = "WRENCH_EGRESS_ALLOW";
/// 置 `1`/`true` 时公网 TCP 目标也必须在白名单内（更严，适合「只管理固定几台机」的场景）
pub const ENV_STRICT: &str = "WRENCH_EGRESS_STRICT";

/// 重定向最大跳数（逐跳都要过策略）
const MAX_REDIRECTS: usize = 5;
/// 单次校验型抓取的默认体积上限（防公开实例被灌满磁盘）
pub const DEFAULT_MAX_FETCH_BYTES: usize = 4 * 1024 * 1024;
/// 解析结果最多取几个地址（防御性上限）
const MAX_RESOLVED_ADDRS: usize = 16;
/// 上游请求超时
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

/// 出口通道。两条通道的默认放行范围不同，见模块文档。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// SSH / SFTP / 健康探测等长连接
    Tcp,
    /// HTTP(S) 请求
    Http,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Tcp => "tcp",
            Channel::Http => "http",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Channel::Tcp => "SSH/SFTP 连接",
            Channel::Http => "HTTP(S) 请求",
        }
    }
}

/// 地址分类。只有 `Public` 是默认放行的。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddrClass {
    Public,
    /// RFC1918 / ULA / CGNAT / 站点本地
    Private,
    Loopback,
    /// 链路本地（含云元数据段）
    LinkLocal,
    /// `169.254.169.254` 等云元数据服务，单独标出以便给出更明确的提示
    Metadata,
    Unspecified,
    Multicast,
    /// 广播 / TEST-NET / 保留段等
    Reserved,
}

impl AddrClass {
    pub fn is_public(self) -> bool {
        matches!(self, AddrClass::Public)
    }

    /// 白名单也放行不了的地址：写成白名单也没有正当用途，一律拒绝。
    pub fn is_hard_denied(self) -> bool {
        matches!(
            self,
            AddrClass::LinkLocal
                | AddrClass::Metadata
                | AddrClass::Unspecified
                | AddrClass::Multicast
                | AddrClass::Reserved
        )
    }

    fn label(self) -> &'static str {
        match self {
            AddrClass::Public => "公网地址",
            AddrClass::Private => "内网地址",
            AddrClass::Loopback => "环回地址",
            AddrClass::LinkLocal => "链路本地地址",
            AddrClass::Metadata => "云元数据地址",
            AddrClass::Unspecified => "未指定地址",
            AddrClass::Multicast => "组播地址",
            AddrClass::Reserved => "保留地址",
        }
    }
}

/// 把 IPv4-mapped IPv6（`::ffff:a.b.c.d`）归一到 IPv4，否则绕过分类检查。
fn normalize(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => ip,
        },
        IpAddr::V4(_) => ip,
    }
}

pub fn classify(ip: IpAddr) -> AddrClass {
    match normalize(ip) {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

fn classify_v4(ip: Ipv4Addr) -> AddrClass {
    if ip.is_loopback() {
        return AddrClass::Loopback;
    }
    if ip.is_unspecified() {
        return AddrClass::Unspecified;
    }
    if ip.is_multicast() {
        return AddrClass::Multicast;
    }
    if ip.is_broadcast() {
        return AddrClass::Reserved;
    }
    let o = ip.octets();
    // 云元数据（AWS/GCP/阿里云等通用地址）单独分类
    if o == [169, 254, 169, 254] {
        return AddrClass::Metadata;
    }
    if o[0] == 169 && o[1] == 254 {
        return AddrClass::LinkLocal;
    }
    if o[0] == 10 || (o[0] == 172 && (16..=31).contains(&o[1])) || (o[0] == 192 && o[1] == 168) {
        return AddrClass::Private;
    }
    if o[0] == 100 && (64..=127).contains(&o[1]) {
        return AddrClass::Private; // CGNAT 100.64.0.0/10
    }
    if o[0] == 192 && o[1] == 0 && o[2] == 0 {
        return AddrClass::Reserved; // 192.0.0.0/24
    }
    if o[0] == 192 && o[1] == 0 && o[2] == 2 {
        return AddrClass::Reserved; // TEST-NET-1
    }
    if o[0] == 198 && (o[1] == 18 || o[1] == 19) {
        return AddrClass::Reserved; // 198.18.0.0/15 基准测试段
    }
    if o[0] == 198 && o[1] == 51 && o[2] == 100 {
        return AddrClass::Reserved; // TEST-NET-2
    }
    if o[0] == 203 && o[1] == 0 && o[2] == 113 {
        return AddrClass::Reserved; // TEST-NET-3
    }
    if o[0] == 192 && o[1] == 88 && o[2] == 99 {
        return AddrClass::Reserved; // 6to4 relay anycast，常见 SSRF 绕过点
    }
    if o[0] >= 240 {
        return AddrClass::Reserved; // 240.0.0.0/4 + 广播
    }
    AddrClass::Public
}

fn classify_v6(ip: Ipv6Addr) -> AddrClass {
    if ip.is_loopback() {
        return AddrClass::Loopback;
    }
    if ip.is_unspecified() {
        return AddrClass::Unspecified;
    }
    if ip.is_multicast() {
        return AddrClass::Multicast;
    }
    let s = ip.segments();
    if s[0] & 0xffc0 == 0xfe80 {
        return AddrClass::LinkLocal; // fe80::/10
    }
    if s[0] & 0xffc0 == 0xfec0 {
        return AddrClass::Private; // fec0::/10 站点本地（已废弃但仍在用）
    }
    if s[0] & 0xfe00 == 0xfc00 {
        return AddrClass::Private; // fc00::/7 ULA
    }
    if s[0] == 0x0064 && s[1] == 0xff9b {
        return AddrClass::Private; // 64:ff9b::/96 NAT64，可映射到私网
    }
    if s[0] == 0x2001 && s[1] == 0x0db8 {
        return AddrClass::Reserved; // 2001:db8::/32 文档段
    }
    AddrClass::Public
}

/// 白名单条目：`IP[:端口]` 或 `CIDR[:端口]`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllowRule {
    ip: IpAddr,
    prefix: u8,
    /// `None` = 任意端口
    port: Option<u16>,
}

impl AllowRule {
    pub fn parse(token: &str) -> Result<Self, String> {
        let token = token.trim();
        if token.is_empty() {
            return Err("空条目".to_string());
        }

        // 端口只接受 `IPv4:22` 或 `[IPv6]:22`（IPv6 裸写带端口有歧义）
        let (addr_part, port) = if let Some(rest) = token.strip_prefix('[') {
            let end = rest.find(']').ok_or_else(|| format!("IPv6 缺少右方括号：{token}"))?;
            let addr = &rest[..end];
            let after = &rest[end + 1..];
            let port = if after.is_empty() {
                None
            } else {
                let p = after
                    .strip_prefix(':')
                    .ok_or_else(|| format!("方括号后只能是 :端口：{token}"))?;
                Some(parse_port(p)?)
            };
            (addr.to_string(), port)
        } else if token.matches(':').count() == 1 {
            let (a, p) = token.split_once(':').expect("split_once");
            if !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) {
                (a.to_string(), Some(parse_port(p)?))
            } else {
                (token.to_string(), None)
            }
        } else {
            (token.to_string(), None)
        };

        let (net, prefix) = match addr_part.split_once('/') {
            Some((a, p)) => {
                let prefix: u8 = p.parse().map_err(|_| format!("前缀长度不是数字：{token}"))?;
                (a.to_string(), Some(prefix))
            }
            None => (addr_part, None),
        };

        let ip: IpAddr = net
            .parse()
            .map_err(|_| format!("{net} 不是 IP/CIDR（白名单只接受 IP 或 CIDR，域名请在连接时用 IP）"))?;
        let max_prefix = if ip.is_ipv4() { 32 } else { 128 };
        let prefix = prefix.unwrap_or(max_prefix);
        if prefix > max_prefix {
            return Err(format!("前缀长度超范围：{token}"));
        }

        Ok(AllowRule { ip: normalize(ip), prefix, port })
    }

    pub fn port(&self) -> Option<u16> {
        self.port
    }

    pub fn matches(&self, ip: IpAddr, port: u16) -> bool {
        if let Some(expect) = self.port
            && expect != port
        {
            return false;
        }
        ip_in_net(normalize(ip), self.ip, self.prefix)
    }

    fn describe(&self) -> String {
        let base = if self.prefix == (if self.ip.is_ipv4() { 32 } else { 128 }) {
            format!("{}", self.ip)
        } else {
            format!("{}/{}", self.ip, self.prefix)
        };
        match self.port {
            Some(p) => format!("{base}:{p}"),
            None => format!("{base}（任意端口）"),
        }
    }
}

fn parse_port(s: &str) -> Result<u16, String> {
    let port: u16 = s.parse().map_err(|_| format!("端口不合法：{s}"))?;
    if port == 0 {
        return Err("端口不能为 0".to_string());
    }
    Ok(port)
}

fn ip_in_net(ip: IpAddr, net: IpAddr, prefix: u8) -> bool {
    match (ip, net) {
        (IpAddr::V4(a), IpAddr::V4(b)) => {
            if prefix == 0 {
                return true;
            }
            let mask = u32::MAX << (32 - prefix);
            u32::from(a) & mask == u32::from(b) & mask
        }
        (IpAddr::V6(a), IpAddr::V6(b)) => {
            if prefix == 0 {
                return true;
            }
            let mask = u128::MAX << (128 - prefix);
            u128::from(a) & mask == u128::from(b) & mask
        }
        _ => false,
    }
}

impl fmt::Display for AllowRule {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.describe())
    }
}

/// 拒绝原因
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DenyReason {
    InvalidHost(String),
    DnsFailure(String),
    InvalidUrl(String),
    BadScheme(String),
    /// 地址不在白名单里（内网/环回，或严格模式下的公网）
    NotAllowlisted {
        addr: IpAddr,
        class: AddrClass,
    },
    /// 无论白名单怎么写都拒绝的地址
    BlockedAddress {
        addr: IpAddr,
        class: AddrClass,
    },
    RedirectLimit,
    TooLarge(usize),
    Transport(String),
}

/// 出口被拒。
///
/// 实现 `std::error::Error`，因此可以穿过 `Box<dyn Error>` 回到 API 层做状态码映射。
#[derive(Debug, Clone)]
pub struct EgressDenied {
    pub host: String,
    pub port: u16,
    pub channel: Channel,
    pub reason: DenyReason,
}

impl EgressDenied {
    fn tcp(host: &str, port: u16, channel: Channel, reason: DenyReason) -> Self {
        EgressDenied { host: host.trim().to_string(), port, channel, reason }
    }

    fn url(raw: &str, reason: DenyReason) -> Self {
        EgressDenied { host: raw.trim().to_string(), port: 0, channel: Channel::Http, reason }
    }

    /// 给用户看的建议（管理员改哪个变量能放开）
    fn hint(&self) -> String {
        let sample = match &self.reason {
            DenyReason::NotAllowlisted { addr, .. } => format!("{addr}:{}", self.port.max(22)),
            _ => "192.168.1.5:22".to_string(),
        };
        format!("如需连接，请由实例管理员把目标加入 {ENV_ALLOW}（例如 {sample}）；白名单只接受 IP 或 CIDR。")
    }
}

impl fmt::Display for EgressDenied {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let head = format!("出口策略拒绝了{}", self.channel.label());
        match &self.reason {
            DenyReason::InvalidHost(h) => write!(f, "{head}：主机名不合法（{h}）"),
            DenyReason::DnsFailure(e) => {
                write!(f, "{head}：域名解析失败（{}——{e}）", self.host)
            }
            DenyReason::InvalidUrl(e) => write!(f, "{head}：URL 不合法（{e}）"),
            DenyReason::BadScheme(s) => {
                write!(f, "{head}：只允许 http/https，收到 {s}")
            }
            DenyReason::NotAllowlisted { addr, class } => write!(
                f,
                "{head} {}:{}：{}（{}）不在实例的可达白名单中。{}",
                self.host,
                self.port,
                addr,
                class.label(),
                self.hint()
            ),
            DenyReason::BlockedAddress { addr, class } => write!(
                f,
                "{head} {}:{}：{}（{}）一律拒绝，不受白名单影响。",
                self.host,
                self.port,
                addr,
                class.label()
            ),
            DenyReason::RedirectLimit => {
                write!(f, "{head}：重定向超过 {MAX_REDIRECTS} 跳，已中止")
            }
            DenyReason::TooLarge(n) => write!(f, "{head}：响应体超过上限（{n} 字节），已中止"),
            DenyReason::Transport(e) => write!(f, "{head}：上游请求失败（{e}）"),
        }
    }
}

impl std::error::Error for EgressDenied {}

/// 出口策略：白名单 + 严格模式
#[derive(Debug, Clone, Default)]
pub struct EgressPolicy {
    rules: Vec<AllowRule>,
    strict: bool,
}

impl EgressPolicy {
    pub fn new(rules: Vec<AllowRule>, strict: bool) -> Self {
        EgressPolicy { rules, strict }
    }

    /// 解析 `WRENCH_EGRESS_ALLOW` 内容；空白名单 = 内网/环回目标全部拒绝。
    pub fn parse(spec: &str, strict: bool) -> Result<Self, String> {
        let mut rules = Vec::new();
        for token in spec.split(',') {
            let token = token.trim();
            if token.is_empty() {
                continue;
            }
            rules.push(AllowRule::parse(token)?);
        }
        Ok(EgressPolicy { rules, strict })
    }

    /// 从环境变量读取。解析失败时**失败关闭**（空白名单）而不是放行。
    pub fn from_env() -> Self {
        let strict = std::env::var(ENV_STRICT)
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false);
        match std::env::var(ENV_ALLOW) {
            Ok(spec) => match Self::parse(&spec, strict) {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!(
                        target: "wrench_backend",
                        "{ENV_ALLOW} 解析失败（{e}），按空白名单处理：内网/环回目标全部拒绝"
                    );
                    EgressPolicy { rules: Vec::new(), strict }
                }
            },
            Err(_) => EgressPolicy { rules: Vec::new(), strict },
        }
    }

    pub fn strict(&self) -> bool {
        self.strict
    }

    pub fn rules(&self) -> &[AllowRule] {
        &self.rules
    }

    pub fn is_allowlisted(&self, ip: IpAddr, port: u16) -> bool {
        self.rules.iter().any(|r| r.matches(ip, port))
    }

    /// 启动/排障用的一行摘要
    pub fn summary(&self) -> String {
        let allow = if self.rules.is_empty() {
            "（空：内网/环回目标全部拒绝）".to_string()
        } else {
            self.rules.iter().map(|r| r.describe()).collect::<Vec<_>>().join(", ")
        };
        format!(
            "出口策略：{ENV_ALLOW}=[{allow}]，{}；HTTP(S) 出口一律禁止私网/环回/链路本地/元数据地址",
            if self.strict {
                "严格模式：公网 TCP 目标也需声明"
            } else {
                "公网 TCP 目标默认放行"
            }
        )
    }

    /// 单个地址 + 端口的判定（不含 DNS）
    fn check(&self, ip: IpAddr, port: u16, channel: Channel) -> Result<(), EgressDenied> {
        let class = classify(ip);
        if class.is_hard_denied() {
            return Err(EgressDenied::tcp(
                &ip.to_string(),
                port,
                channel,
                DenyReason::BlockedAddress { addr: ip, class },
            ));
        }
        if self.is_allowlisted(ip, port) {
            return Ok(());
        }
        let public_ok = class.is_public() && !(self.strict && channel == Channel::Tcp);
        if public_ok {
            return Ok(());
        }
        Err(EgressDenied::tcp(
            &ip.to_string(),
            port,
            channel,
            DenyReason::NotAllowlisted { addr: ip, class },
        ))
    }

    /// 解析主机名并逐个校验，返回**可以连**的地址列表。
    ///
    /// 只要有任一地址通过校验就返回（只连这些地址），全被拒时返回最后一次拒绝原因。
    pub async fn resolve_target(&self, host: &str, port: u16, channel: Channel) -> Result<Vec<IpAddr>, EgressDenied> {
        let host = host.trim().to_string();
        if host.is_empty() {
            return Err(EgressDenied::tcp(
                &host,
                port,
                channel,
                DenyReason::InvalidHost("空的 host".into()),
            ));
        }
        if host.contains('/') || host.contains(' ') {
            return Err(EgressDenied::tcp(
                &host,
                port,
                channel,
                DenyReason::InvalidHost("host 只能是主机名或 IP，不能是 URL".into()),
            ));
        }

        let raw: Vec<IpAddr> = if let Ok(ip) = host.parse::<IpAddr>() {
            vec![ip]
        } else {
            let looked = tokio::net::lookup_host((host.as_str(), port))
                .await
                .map_err(|e| EgressDenied::tcp(&host, port, channel, DenyReason::DnsFailure(e.to_string())))?;
            looked.map(|sa| sa.ip()).collect()
        };

        let mut unique: Vec<IpAddr> = Vec::new();
        for ip in raw {
            if !unique.contains(&ip) {
                unique.push(ip);
            }
            if unique.len() >= MAX_RESOLVED_ADDRS {
                break;
            }
        }
        if unique.is_empty() {
            return Err(EgressDenied::tcp(
                &host,
                port,
                channel,
                DenyReason::DnsFailure("解析结果为空".into()),
            ));
        }

        let total = unique.len();
        let mut allowed = Vec::new();
        let mut last_deny = None;
        for ip in unique {
            match self.check(ip, port, channel) {
                Ok(()) => allowed.push(ip),
                Err(d) => last_deny = Some(d),
            }
        }
        if allowed.is_empty() {
            return Err(last_deny.expect("至少有一个地址被判过"));
        }
        if allowed.len() < total {
            tracing::warn!(
                target: "wrench_backend",
                "出口策略：{}:{} 解析出 {} 个地址，其中 {} 个被拒绝，只连允许的那些",
                host, port, total, total - allowed.len()
            );
        }
        Ok(allowed)
    }

    /// 校验一个将要被服务端抓取的 URL，返回钉住 IP 后的目标。
    pub async fn authorize_url(&self, raw: &str) -> Result<AuthorizedUrl, EgressDenied> {
        let raw = raw.trim();
        let url =
            reqwest::Url::parse(raw).map_err(|e| EgressDenied::url(raw, DenyReason::InvalidUrl(e.to_string())))?;
        match url.scheme() {
            "http" | "https" => {}
            other => {
                return Err(EgressDenied::url(raw, DenyReason::BadScheme(other.to_string())));
            }
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(EgressDenied::url(raw, DenyReason::InvalidUrl("URL 不允许内嵌凭据".into())));
        }
        let host = url
            .host_str()
            .ok_or_else(|| EgressDenied::url(raw, DenyReason::InvalidUrl("缺少 host".into())))?
            .to_string();
        let port = url
            .port_or_known_default()
            .ok_or_else(|| EgressDenied::url(raw, DenyReason::InvalidUrl("未知端口".into())))?;

        let ips = self.resolve_target(&host, port, Channel::Http).await?;
        let addrs: Vec<SocketAddr> = ips.into_iter().map(|ip| SocketAddr::new(ip, port)).collect();
        Ok(AuthorizedUrl { url, addrs })
    }

    /// 校验型 GET：逐跳校验重定向，响应体限量。
    pub async fn fetch_text(&self, raw: &str, max_bytes: usize) -> Result<FetchedText, EgressDenied> {
        let mut current = raw.trim().to_string();
        for _ in 0..=MAX_REDIRECTS {
            let authorized = self.authorize_url(&current).await?;
            let client = authorized
                .client()
                .map_err(|e| EgressDenied::url(&current, DenyReason::Transport(e.to_string())))?;
            let mut resp = client
                .get(authorized.url.clone())
                .send()
                .await
                .map_err(|e| EgressDenied::url(&current, DenyReason::Transport(e.to_string())))?;
            let status = resp.status();

            if status.is_redirection() {
                let location = resp
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| EgressDenied::url(&current, DenyReason::Transport("重定向缺少 Location".into())))?;
                current = authorized
                    .url
                    .join(location)
                    .map_err(|e| EgressDenied::url(&current, DenyReason::InvalidUrl(e.to_string())))?
                    .to_string();
                continue;
            }
            if !status.is_success() {
                return Err(EgressDenied::url(
                    &current,
                    DenyReason::Transport(format!("上游返回 HTTP {status}")),
                ));
            }
            if let Some(len) = resp.content_length()
                && len > max_bytes as u64
            {
                return Err(EgressDenied::url(&current, DenyReason::TooLarge(max_bytes)));
            }
            let mut buf: Vec<u8> = Vec::new();
            while let Some(chunk) = resp
                .chunk()
                .await
                .map_err(|e| EgressDenied::url(&current, DenyReason::Transport(e.to_string())))?
            {
                if buf.len() + chunk.len() > max_bytes {
                    return Err(EgressDenied::url(&current, DenyReason::TooLarge(max_bytes)));
                }
                buf.extend_from_slice(&chunk);
            }
            let body = String::from_utf8(buf)
                .map_err(|e| EgressDenied::url(&current, DenyReason::Transport(format!("响应不是 UTF-8 文本：{e}"))))?;
            return Ok(FetchedText { final_url: authorized.url.to_string(), body });
        }
        Err(EgressDenied::url(raw, DenyReason::RedirectLimit))
    }
}

/// 校验通过的 URL：`url` 保留原主机名（Host/SNI 正确），`addrs` 是钉住的 IP。
#[derive(Debug, Clone)]
pub struct AuthorizedUrl {
    pub url: reqwest::Url,
    pub addrs: Vec<SocketAddr>,
}

impl AuthorizedUrl {
    pub fn host(&self) -> String {
        self.url.host_str().unwrap_or_default().to_string()
    }

    pub fn addrs(&self) -> &[SocketAddr] {
        &self.addrs
    }

    /// 构造一个「只连钉住 IP、不自动跟随重定向、有超时」的客户端。
    pub fn client(&self) -> reqwest::Result<reqwest::Client> {
        self.builder().build()
    }

    /// 同上，但允许调用方追加自己的配置（例如 json body）。
    pub fn builder(&self) -> reqwest::ClientBuilder {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(HTTP_TIMEOUT)
            .resolve_to_addrs(&self.host(), &self.addrs)
    }
}

/// 抓取结果
#[derive(Debug, Clone)]
pub struct FetchedText {
    pub final_url: String,
    pub body: String,
}

// ─────────────────────────── 全局策略 ───────────────────────────

static POLICY: LazyLock<RwLock<EgressPolicy>> = LazyLock::new(|| RwLock::new(EgressPolicy::from_env()));

/// 当前生效的出口策略（克隆，规则数量很少）
pub fn policy() -> EgressPolicy {
    match POLICY.read() {
        Ok(g) => g.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

/// 替换当前策略（启动时按环境变量初始化；测试用例注入用）
pub fn install(p: EgressPolicy) {
    match POLICY.write() {
        Ok(mut g) => *g = p,
        Err(poisoned) => *poisoned.into_inner() = p,
    }
}

/// 启动时调用：读环境变量、打摘要日志
pub fn init_from_env() {
    let p = EgressPolicy::from_env();
    tracing::info!(target: "wrench_backend", "{}", p.summary());
    install(p);
}

/// 便捷入口：TCP 通道（SSH/SFTP/探测）
pub async fn authorize_tcp(host: &str, port: u16) -> Result<Vec<IpAddr>, EgressDenied> {
    policy().resolve_target(host, port, Channel::Tcp).await
}

/// 便捷入口：HTTP 通道
pub async fn authorize_url(raw: &str) -> Result<AuthorizedUrl, EgressDenied> {
    policy().authorize_url(raw).await
}

/// 便捷入口：校验型 GET
pub async fn fetch_text(raw: &str, max_bytes: usize) -> Result<FetchedText, EgressDenied> {
    policy().fetch_text(raw, max_bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy_with(spec: &str, strict: bool) -> EgressPolicy {
        EgressPolicy::parse(spec, strict).expect("parse")
    }

    #[test]
    fn rule_parse_ipv4_cidr_port() {
        let r = AllowRule::parse("192.168.1.0/24:22").unwrap();
        assert!(r.matches("192.168.1.9".parse().unwrap(), 22));
        assert!(!r.matches("192.168.1.9".parse().unwrap(), 2222));
        assert!(!r.matches("192.168.9.9".parse().unwrap(), 22));
    }

    #[test]
    fn rule_parse_single_ip_any_port() {
        let r = AllowRule::parse("10.0.0.5").unwrap();
        assert!(r.matches("10.0.0.5".parse().unwrap(), 1));
        assert!(r.matches("10.0.0.5".parse().unwrap(), 65535));
        assert!(!r.matches("10.0.0.6".parse().unwrap(), 22));
    }

    #[test]
    fn rule_parse_ipv6_bracket_port_and_ula() {
        let r = AllowRule::parse("[fd00::5]:22").unwrap();
        assert!(r.matches("fd00::5".parse().unwrap(), 22));
        assert!(!r.matches("fd00::5".parse().unwrap(), 23));
        let cidr = AllowRule::parse("fd00::/8").unwrap();
        assert!(cidr.matches("fd00::1".parse().unwrap(), 22));
        assert!(!cidr.matches("fe80::1".parse().unwrap(), 22));
    }

    #[test]
    fn rule_parse_rejects_garbage() {
        assert!(AllowRule::parse("").is_err());
        assert!(AllowRule::parse("example.com").is_err(), "白名单不接受域名");
        assert!(AllowRule::parse("192.168.1.0/33").is_err());
        assert!(AllowRule::parse("10.0.0.1:0").is_err());
        assert!(AllowRule::parse("10.0.0.1:70000").is_err());
    }

    #[test]
    fn classify_covers_dangerous_ranges() {
        assert_eq!(classify("127.0.0.1".parse().unwrap()), AddrClass::Loopback);
        assert_eq!(classify("127.1.2.3".parse().unwrap()), AddrClass::Loopback);
        assert_eq!(classify("169.254.169.254".parse().unwrap()), AddrClass::Metadata);
        assert_eq!(classify("169.254.1.1".parse().unwrap()), AddrClass::LinkLocal);
        assert_eq!(classify("10.1.2.3".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("172.20.0.1".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("192.168.1.9".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("100.64.0.1".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("192.0.0.1".parse().unwrap()), AddrClass::Reserved);
        assert_eq!(classify("0.0.0.0".parse().unwrap()), AddrClass::Unspecified);
        assert_eq!(classify("224.0.0.1".parse().unwrap()), AddrClass::Multicast);
        assert_eq!(classify("8.8.8.8".parse().unwrap()), AddrClass::Public);
        assert_eq!(classify("::1".parse().unwrap()), AddrClass::Loopback);
        assert_eq!(classify("fd00::1".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("fe80::1".parse().unwrap()), AddrClass::LinkLocal);
        assert_eq!(classify("2606:4700::1111".parse().unwrap()), AddrClass::Public);
    }

    #[test]
    fn ipv4_mapped_v6_is_normalized() {
        // ::ffff:192.168.1.9 不能被当成公网
        assert_eq!(classify("::ffff:192.168.1.9".parse().unwrap()), AddrClass::Private);
        assert_eq!(classify("::ffff:127.0.0.1".parse().unwrap()), AddrClass::Loopback);
    }

    #[test]
    fn private_target_denied_by_default() {
        let p = EgressPolicy::default();
        assert!(p.check("192.168.1.9".parse().unwrap(), 22, Channel::Tcp).is_err());
    }

    #[test]
    fn allowlisted_private_target_allowed_on_declared_port() {
        let p = policy_with("192.168.1.0/24:22", false);
        assert!(p.check("192.168.1.9".parse().unwrap(), 22, Channel::Tcp).is_ok());
        assert!(p.check("192.168.1.9".parse().unwrap(), 8080, Channel::Tcp).is_err());
        assert!(p.check("192.168.9.9".parse().unwrap(), 22, Channel::Tcp).is_err());
    }

    #[test]
    fn public_target_allowed_unless_strict() {
        let lenient = EgressPolicy::default();
        assert!(lenient.check("8.8.8.8".parse().unwrap(), 22, Channel::Tcp).is_ok());

        let strict = policy_with("8.8.8.8:22", true);
        assert!(strict.check("8.8.8.8".parse().unwrap(), 22, Channel::Tcp).is_ok());
        assert!(strict.check("1.1.1.1".parse().unwrap(), 22, Channel::Tcp).is_err());
    }

    #[test]
    fn hard_denied_even_when_allowlisted() {
        let p = policy_with("169.254.0.0/16,0.0.0.0/8,224.0.0.0/4", false);
        assert!(p.check("169.254.169.254".parse().unwrap(), 22, Channel::Tcp).is_err());
        assert!(p.check("0.0.0.0".parse().unwrap(), 22, Channel::Tcp).is_err());
        assert!(p.check("224.0.0.1".parse().unwrap(), 22, Channel::Tcp).is_err());
    }

    #[test]
    fn http_channel_allows_public_and_blocks_private() {
        let p = policy_with("192.168.1.0/24:80", false);
        assert!(p.check("93.184.216.34".parse().unwrap(), 443, Channel::Http).is_ok());
        assert!(p.check("192.168.1.5".parse().unwrap(), 80, Channel::Http).is_ok());
        assert!(p.check("192.168.1.5".parse().unwrap(), 8080, Channel::Http).is_err());
        assert!(p.check("127.0.0.1".parse().unwrap(), 80, Channel::Http).is_err());
    }

    #[tokio::test]
    async fn resolve_target_rejects_host_with_url_syntax() {
        let p = EgressPolicy::default();
        let err = p
            .resolve_target("http://127.0.0.1:8080/x", 80, Channel::Tcp)
            .await
            .unwrap_err();
        assert_eq!(err.channel, Channel::Tcp);
        assert!(matches!(err.reason, DenyReason::InvalidHost(_)));
    }

    #[tokio::test]
    async fn resolve_target_ip_literal_uses_allowlist() {
        let p = policy_with("10.0.0.5:22", false);
        let ok = p.resolve_target("10.0.0.5", 22, Channel::Tcp).await.unwrap();
        assert_eq!(ok, vec!["10.0.0.5".parse::<IpAddr>().unwrap()]);
        assert!(p.resolve_target("10.0.0.6", 22, Channel::Tcp).await.is_err());
    }

    #[tokio::test]
    async fn authorize_url_blocks_metadata_and_bad_scheme() {
        let p = EgressPolicy::default();
        let e = p
            .authorize_url("http://169.254.169.254/latest/meta-data/")
            .await
            .unwrap_err();
        assert!(
            format!("{:?}", e.reason).contains("Metadata") || e.to_string().contains("元数据"),
            "{e}"
        );
        let e = p.authorize_url("file:///etc/passwd").await.unwrap_err();
        assert!(matches!(e.reason, DenyReason::BadScheme(_)), "{e}");
        let e = p.authorize_url("http://user:pw@127.0.0.1/").await.unwrap_err();
        assert!(matches!(e.reason, DenyReason::InvalidUrl(_)), "{e}");
    }

    #[test]
    fn deny_message_tells_admin_what_to_set() {
        let p = EgressPolicy::default();
        let err = p.check("192.168.1.9".parse().unwrap(), 22, Channel::Tcp).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains(ENV_ALLOW), "{msg}");
        assert!(msg.contains("192.168.1.9:22"), "{msg}");
    }

    #[test]
    fn summary_is_readable() {
        let empty = EgressPolicy::default();
        assert!(empty.summary().contains("空"));
        let p = policy_with("192.168.1.0/24:22", false);
        assert!(p.summary().contains("192.168.1.0/24:22"));
    }
}
