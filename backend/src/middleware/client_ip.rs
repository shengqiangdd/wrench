//! 客户端真实 IP 解析（支持反向代理，且默认不信任任何代理头）。
//!
//! # 为什么需要这个模块
//!
//! 公开部署通常在前面挂一层 HTTPS 反向代理（Nginx / Caddy / Traefik / 面板）。
//! 这时 TCP 对端**永远是代理的地址**，如果直接拿 socket 对端 IP 当限流键和
//! 审计 IP，会出现两个真实问题：
//!
//! 1. **限流坍缩**：`/api/auth/login` 的「每 IP 60 秒 8 次」变成全局每秒 8 次——
//!    任何人打满都能把所有人挡在门外，而攻击者自己的尝试也不再有独立配额。
//! 2. **审计失真**：`audit_logs.ip` 全是代理地址，出事后无法判断是谁连了哪台机。
//!
//! # 为什么不无条件信任 `X-Forwarded-For`
//!
//! 这个头**由客户端完全可控**。无条件采信等于发一把「换 IP 绕过限流」的钥匙，
//! 还能往审计日志里灌任意 IP。所以只在两个条件同时成立时才采信代理头：
//!
//! 1. 部署者用 `WRENCH_TRUSTED_PROXIES` **显式声明**了代理网段（未配置 = 完全不信任，
//!    行为与改造前一致）；
//! 2. 本次请求的**直连对端 IP** 落在受信网段内。
//!
//! 取值时从右往左扫描 `X-Forwarded-For`，取第一个**不受信**的地址——那是离本机
//! 最近的一跳真实客户端；右端由我们信任的代理追加，攻击者伪造的左侧条目会被跳过。

use axum::body::Body;
use axum::extract::connect_info::ConnectInfo;
use axum::http::{HeaderMap, Request};
use std::net::{IpAddr, SocketAddr};
use std::sync::LazyLock;

/// 环境变量：受信反向代理的地址/网段（逗号分隔，支持 `IP` 与 `CIDR`）。
pub const TRUSTED_PROXIES_ENV: &str = "WRENCH_TRUSTED_PROXIES";

const XFF: &str = "x-forwarded-for";
const X_REAL_IP: &str = "x-real-ip";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Cidr {
    base: IpAddr,
    prefix: u8,
}

impl Cidr {
    /// 解析 `10.0.0.0/8` / `192.168.2.9` / `::1` / `fd00::/8`。
    fn parse(spec: &str) -> Option<Self> {
        let spec = spec.trim();
        if spec.is_empty() {
            return None;
        }
        let (addr_part, prefix_part) = match spec.split_once('/') {
            Some((a, p)) => (a, Some(p)),
            None => (spec, None),
        };
        let base: IpAddr = addr_part.trim().parse().ok()?;
        let max = if base.is_ipv4() { 32 } else { 128 };
        let prefix = match prefix_part {
            Some(p) => p.trim().parse::<u8>().ok()?,
            None => max,
        };
        if prefix > max {
            return None;
        }
        Some(Self { base, prefix })
    }

    fn contains(&self, ip: IpAddr) -> bool {
        match (self.base, ip) {
            (IpAddr::V4(b), IpAddr::V4(i)) => prefix_match(&b.octets(), &i.octets(), self.prefix),
            (IpAddr::V6(b), IpAddr::V6(i)) => prefix_match(&b.octets(), &i.octets(), self.prefix),
            // IPv4-mapped IPv6 对端（::ffff:192.168.2.9）也要能和 IPv4 网段比对：
            // 双栈监听 + 代理走 IPv4 时，axum 给的就是这种形式。
            (IpAddr::V4(b), IpAddr::V6(i)) => match i.to_ipv4_mapped() {
                Some(m) => prefix_match(&b.octets(), &m.octets(), self.prefix),
                None => false,
            },
            (IpAddr::V6(_), IpAddr::V4(_)) => false,
        }
    }
}

fn prefix_match(a: &[u8], b: &[u8], prefix: u8) -> bool {
    let full = (prefix / 8) as usize;
    let head = full.min(a.len()).min(b.len());
    if a[..head] != b[..head] {
        return false;
    }
    let rem = prefix % 8;
    if rem == 0 {
        return true;
    }
    match (a.get(full), b.get(full)) {
        (Some(x), Some(y)) => {
            let mask = 0xffu8 << (8 - rem);
            (x & mask) == (y & mask)
        }
        _ => false,
    }
}

/// 受信代理集合。
#[derive(Debug, Default)]
pub struct TrustedProxies {
    nets: Vec<Cidr>,
}

impl TrustedProxies {
    /// 从 `WRENCH_TRUSTED_PROXIES` 解析（未设置 → 空集合 = 不信任任何代理头）。
    pub fn from_env() -> Self {
        match std::env::var(TRUSTED_PROXIES_ENV) {
            Ok(raw) => Self::parse(&raw),
            Err(_) => Self::default(),
        }
    }

    pub fn parse(raw: &str) -> Self {
        let mut nets = Vec::new();
        for part in raw.split(',') {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            match Cidr::parse(part) {
                Some(c) => nets.push(c),
                None => tracing::warn!("[client_ip] {TRUSTED_PROXIES_ENV} 中的条目无法解析，已忽略：{:?}", part),
            }
        }
        Self { nets }
    }

    pub fn is_empty(&self) -> bool {
        self.nets.is_empty()
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        self.nets.iter().any(|n| n.contains(ip))
    }
}

static TRUSTED: LazyLock<TrustedProxies> = LazyLock::new(TrustedProxies::from_env);

/// 启动时打印一行摘要（与 `egress::init_from_env` 一致的可观测性做法）。
pub fn init_from_env() {
    let t = &*TRUSTED;
    if t.is_empty() {
        tracing::info!(
            "[client_ip] {TRUSTED_PROXIES_ENV} 未配置：只信任 TCP 对端 IP，忽略 X-Forwarded-For / X-Real-IP"
        );
    } else {
        tracing::info!(
            "[client_ip] 受信代理 {} 个网段（来自 {TRUSTED_PROXIES_ENV}）：限流与审计将使用代理头里的真实客户端 IP",
            t.nets.len()
        );
    }
}

/// 按显式传入的受信集合解析客户端 IP（便于测试；生产走 [`resolve`]）。
pub fn resolve_with(trusted: &TrustedProxies, peer: Option<IpAddr>, headers: &HeaderMap) -> String {
    let Some(peer) = peer else {
        return "unknown".to_string();
    };
    if !trusted.contains(peer) {
        // 直连对端不受信 → 代理头一概不看（否则任意客户端都能伪造 IP）
        return peer.to_string();
    }
    forwarded_client(trusted, headers).unwrap_or(peer).to_string()
}

/// 解析客户端 IP：对端不在受信代理网段时返回对端 IP。
pub fn resolve(peer: Option<IpAddr>, headers: &HeaderMap) -> String {
    resolve_with(&TRUSTED, peer, headers)
}

/// 从请求里取对端 IP 并解析真实客户端 IP。
pub fn of_request(req: &Request<Body>) -> String {
    resolve(peer_ip(req), req.headers())
}

/// 请求的 TCP 对端 IP（无连接信息时 None，例如进程内构造的请求）。
pub fn peer_ip(req: &Request<Body>) -> Option<IpAddr> {
    req.extensions().get::<ConnectInfo<SocketAddr>>().map(|ci| ci.0.ip())
}

fn forwarded_client(trusted: &TrustedProxies, headers: &HeaderMap) -> Option<IpAddr> {
    if let Some(raw) = header_str(headers, XFF) {
        let chain: Vec<IpAddr> = raw
            .split(',')
            .filter_map(|s| s.trim().trim_matches('"').parse::<IpAddr>().ok())
            .collect();
        if !chain.is_empty() {
            // 右端是本机信任的代理追加的，左端可能是攻击者伪造的 → 从右往左找第一个不受信地址
            if let Some(ip) = chain.iter().rev().find(|ip| !trusted.contains(**ip)) {
                return Some(*ip);
            }
            // 整条链都在受信网段内：退回最左（最初的声称），至少比代理自身地址更有信息量
            return chain.first().copied();
        }
    }
    header_str(headers, X_REAL_IP).and_then(|v| v.trim().trim_matches('"').parse::<IpAddr>().ok())
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn cidr_parsing() {
        let c = Cidr::parse("192.168.2.0/24").unwrap();
        assert!(c.contains(ip("192.168.2.9")));
        assert!(c.contains(ip("192.168.2.0")));
        assert!(c.contains(ip("192.168.2.255")));
        assert!(!c.contains(ip("192.168.3.1")));

        // 裸 IP = /32
        let single = Cidr::parse("10.1.2.3").unwrap();
        assert!(single.contains(ip("10.1.2.3")));
        assert!(!single.contains(ip("10.1.2.4")));

        // 非 8 对齐的前缀
        let odd = Cidr::parse("10.0.0.0/12").unwrap();
        assert!(odd.contains(ip("10.15.255.254")));
        assert!(!odd.contains(ip("10.16.0.1")));

        assert!(Cidr::parse("192.168.0.0/33").is_none());
        assert!(Cidr::parse("not-an-ip").is_none());

        // IPv6
        let v6 = Cidr::parse("fd00::/8").unwrap();
        assert!(v6.contains(ip("fd00::1")));
        assert!(!v6.contains(ip("fe80::1")));
    }

    #[test]
    fn ipv4_mapped_peer_matches_ipv4_cidr() {
        let c = Cidr::parse("192.168.2.0/24").unwrap();
        assert!(c.contains(ip("::ffff:192.168.2.9")));
        assert!(!c.contains(ip("::ffff:192.168.3.9")));
    }

    /// 未配置受信代理时，伪造的 XFF 必须被忽略（否则限流可被绕过）。
    #[test]
    fn untrusted_peer_ignores_forwarded_headers() {
        let trusted = TrustedProxies::default();
        let h = headers(&[("x-forwarded-for", "1.2.3.4"), ("x-real-ip", "5.6.7.8")]);
        assert_eq!(resolve_with(&trusted, Some(ip("203.0.113.7")), &h), "203.0.113.7");
    }

    /// 直连对端在受信网段内 → 使用 XFF 里最靠近本机的不受信地址。
    #[test]
    fn trusted_peer_uses_rightmost_untrusted_hop() {
        let trusted = TrustedProxies::parse("10.0.0.0/8");
        let h = headers(&[("x-forwarded-for", "9.9.9.9, 203.0.113.5, 10.0.0.3")]);
        assert_eq!(resolve_with(&trusted, Some(ip("10.0.0.9")), &h), "203.0.113.5");
    }

    /// 攻击者伪造左侧条目时，仍取右端真实客户端（伪造值不会被采信）。
    #[test]
    fn spoofed_leftmost_entry_is_skipped() {
        let trusted = TrustedProxies::parse("10.0.0.0/8");
        let h = headers(&[("x-forwarded-for", "1.1.1.1, 203.0.113.5, 10.0.0.3")]);
        assert_eq!(resolve_with(&trusted, Some(ip("10.0.0.9")), &h), "203.0.113.5");
    }

    /// 整条链都在受信网段内 → 退回最左条目，而不是代理自身地址。
    #[test]
    fn all_hops_trusted_falls_back_to_leftmost() {
        let trusted = TrustedProxies::parse("10.0.0.0/8");
        let h = headers(&[("x-forwarded-for", "10.0.0.1, 10.0.0.2")]);
        assert_eq!(resolve_with(&trusted, Some(ip("10.0.0.9")), &h), "10.0.0.1");
    }

    /// 受信代理但没有任何代理头（或头是垃圾）→ 退回对端 IP。
    #[test]
    fn trusted_peer_without_usable_header_falls_back_to_peer() {
        let trusted = TrustedProxies::parse("10.0.0.0/8");
        assert_eq!(resolve_with(&trusted, Some(ip("10.0.0.9")), &HeaderMap::new()), "10.0.0.9");

        let junk = headers(&[("x-forwarded-for", "unknown, ,")]);
        assert_eq!(resolve_with(&trusted, Some(ip("10.0.0.9")), &junk), "10.0.0.9");
    }

    /// 没有 XFF 时用 X-Real-IP（同样只在对端受信时才看）。
    #[test]
    fn x_real_ip_used_when_xff_absent() {
        let trusted = TrustedProxies::parse("192.168.2.0/24");
        let h = headers(&[("x-real-ip", "198.51.100.4")]);
        assert_eq!(resolve_with(&trusted, Some(ip("192.168.2.9")), &h), "198.51.100.4");
    }

    #[test]
    fn missing_peer_is_unknown() {
        assert_eq!(resolve_with(&TrustedProxies::default(), None, &HeaderMap::new()), "unknown");
    }

    #[test]
    fn parse_skips_bad_entries_but_keeps_good_ones() {
        let t = TrustedProxies::parse(" 10.0.0.0/8 , ,garbage, 192.168.2.9 ");
        assert!(t.contains(ip("10.1.1.1")));
        assert!(t.contains(ip("192.168.2.9")));
        assert!(!t.contains(ip("192.168.2.10")));
    }
}
