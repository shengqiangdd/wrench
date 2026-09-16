//! 安全响应头（公开部署的纵深防御）。
//!
//! 这些头不改变任何业务行为，但能在「已经出问题」时显著降低损失：
//!
//! - `Content-Security-Policy`：本应用把 markdown、SSH 输出、日志、AI 回复都渲染进页面。
//!   只要其中任何一条路径漏掉转义（历史上有过 `javascript:` 链接这类洞），注入的
//!   `<script>` 就会被执行——而本应用的会话令牌存在 localStorage、SSH 凭据经页面转发，
//!   XSS 的后果是「直接接管」而不是「弹个框」。禁用内联脚本是这里最值钱的一条。
//! - `X-Frame-Options` / `frame-ancestors`：防止被第三方页面 iframe 套住点（clickjacking）
//!   ——对「一个按钮就把 SSH 命令发出去」的终端界面尤其重要。
//! - `nosniff`：阻止把上传/下载的文本当脚本或 HTML 解释。
//! - `Referrer-Policy`：避免主机名、路径（可能含项目/主机信息）随外链泄露。
//! - `Strict-Transport-Security`：只在**确认本次请求是 HTTPS** 时下发，否则纯 HTTP
//!   部署会被浏览器记住「必须 HTTPS」而直接打不开。
//!
//! # 两处必须保留的放宽（都有明确原因）
//!
//! - `style-src 'unsafe-inline'`：xterm.js 运行时注入 `<style>`，React 也用 style 属性。
//! - `script-src 'unsafe-eval'`：插件运行时用 `new Function` 执行插件代码
//!   （`frontend/src/components/PluginSandbox.tsx`）。插件本来就以页面同源权限运行，
//!   所以这条并不额外扩大既有暴露面；不用插件的部署可以 `WRENCH_CSP=strict` 去掉它。
//! - `index.html` 里的内联脚本已挪到 `public/refresh-shim.js`（外部文件），
//!   因此 `script-src` 里**没有** `'unsafe-inline'`。

use axum::body::Body;
use axum::http::{HeaderValue, Request, header};
use axum::middleware::Next;
use axum::response::Response;
use std::sync::LazyLock;

/// 环境变量：`off` 关闭 CSP；`strict` 去掉 `'unsafe-eval'`（不使用插件时更严）。
pub const CSP_ENV: &str = "WRENCH_CSP";
/// 环境变量：`off` 关闭 HSTS 下发。
pub const HSTS_ENV: &str = "WRENCH_HSTS";
/// HSTS 有效期（180 天）。刻意不加 `includeSubDomains`：本应用常挂在与其它服务
/// 共用的域名下，替整个域做决定不是这个应用该有的权力。
const HSTS_MAX_AGE: u64 = 15_552_000;

const XFF_PROTO: &str = "x-forwarded-proto";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CspMode {
    /// 默认：允许插件所需的 `'unsafe-eval'`
    Plugins,
    /// 不允许 `'unsafe-eval'`（插件会失效，其它功能不受影响）
    Strict,
    Off,
}

impl CspMode {
    fn from_env_value(raw: Option<&str>) -> Self {
        match raw.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("off") | Some("0") | Some("false") => CspMode::Off,
            Some("strict") => CspMode::Strict,
            _ => CspMode::Plugins,
        }
    }

    fn from_env() -> Self {
        Self::from_env_value(std::env::var(CSP_ENV).ok().as_deref())
    }

    fn policy(self) -> Option<String> {
        let eval = match self {
            CspMode::Plugins => " 'unsafe-eval'",
            CspMode::Strict => "",
            CspMode::Off => return None,
        };
        Some(format!(
            "default-src 'self'; \
             script-src 'self'{eval}; \
             style-src 'self' 'unsafe-inline'; \
             img-src 'self' data: blob:; \
             font-src 'self' data:; \
             connect-src 'self' ws: wss:; \
             frame-src 'self' blob:; \
             worker-src 'self' blob:; \
             object-src 'none'; \
             base-uri 'self'; \
             form-action 'self'; \
             frame-ancestors 'none'"
        ))
    }
}

static CSP: LazyLock<Option<String>> = LazyLock::new(|| CspMode::from_env().policy());

fn hsts_enabled() -> bool {
    !matches!(
        std::env::var(HSTS_ENV)
            .ok()
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref(),
        Some("off") | Some("0") | Some("false")
    )
}

/// 启动时打印一行摘要（部署者能从日志确认防护是否生效）。
pub fn init_from_env() {
    match &*CSP {
        Some(policy) => tracing::info!("[security_headers] CSP 已启用：{policy}"),
        None => tracing::warn!("[{CSP_ENV}=off] CSP 已关闭（不建议在公开实例上这么做）"),
    }
}

/// 请求是否经由 HTTPS（由反向代理用 `X-Forwarded-Proto` 告知）。
///
/// 只在决定「要不要下发 HSTS / `Secure` cookie」这类**加法**时使用：
/// 伪造这个头最多让浏览器多收到一条 HSTS，不会让攻击者获得任何权限。
fn is_https(headers: &axum::http::HeaderMap) -> bool {
    headers
        .get(XFF_PROTO)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(',').next().unwrap_or("").trim().eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

fn insert(res: &mut Response, name: header::HeaderName, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        res.headers_mut().insert(name, v);
    }
}

/// 给所有响应（含 404 / 静态资源 / SSE）盖上安全头。
pub async fn security_headers_middleware(req: Request<Body>, next: Next) -> Response {
    let https = is_https(req.headers());
    let mut res = next.run(req).await;

    insert(&mut res, header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    insert(&mut res, header::X_FRAME_OPTIONS, "DENY");
    insert(&mut res, header::REFERRER_POLICY, "no-referrer");
    insert(
        &mut res,
        header::HeaderName::from_static("permissions-policy"),
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    );
    insert(
        &mut res,
        header::HeaderName::from_static("cross-origin-opener-policy"),
        "same-origin",
    );
    insert(
        &mut res,
        header::HeaderName::from_static("x-permitted-cross-domain-policies"),
        "none",
    );

    if let Some(policy) = CSP.as_deref() {
        insert(&mut res, header::HeaderName::from_static("content-security-policy"), policy);
    }

    if https && hsts_enabled() {
        insert(
            &mut res,
            header::HeaderName::from_static("strict-transport-security"),
            &format!("max-age={HSTS_MAX_AGE}"),
        );
    }

    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::routing::get;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route("/ok", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(security_headers_middleware))
    }

    async fn call(headers: &[(&str, &str)]) -> axum::http::Response<Body> {
        let mut req = Request::builder().uri("/ok");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        app().oneshot(req.body(Body::empty()).unwrap()).await.unwrap()
    }

    #[tokio::test]
    async fn sets_baseline_headers() {
        let res = call(&[]).await;
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(res.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(res.headers()[header::X_FRAME_OPTIONS], "DENY");
        assert_eq!(res.headers()[header::REFERRER_POLICY], "no-referrer");
        assert!(res.headers().contains_key("permissions-policy"));
        assert!(res.headers().contains_key("cross-origin-opener-policy"));
    }

    /// HSTS 只在 HTTPS（代理声明 https）时下发：纯 HTTP 部署下发会让浏览器
    /// 记住「必须 HTTPS」而直接打不开页面。
    #[tokio::test]
    async fn hsts_only_over_https() {
        let plain = call(&[]).await;
        assert!(!plain.headers().contains_key("strict-transport-security"));

        let tls = call(&[("x-forwarded-proto", "https")]).await;
        assert_eq!(tls.headers()["strict-transport-security"], format!("max-age={HSTS_MAX_AGE}"));

        // 代理链上首个值决定协议
        let tls_chain = call(&[("x-forwarded-proto", "https, http")]).await;
        assert!(tls_chain.headers().contains_key("strict-transport-security"));
    }

    #[test]
    fn csp_mode_parsing() {
        assert_eq!(CspMode::from_env_value(None), CspMode::Plugins);
        assert_eq!(CspMode::from_env_value(Some("")), CspMode::Plugins);
        assert_eq!(CspMode::from_env_value(Some("STRICT")), CspMode::Strict);
        assert_eq!(CspMode::from_env_value(Some("off")), CspMode::Off);
        assert_eq!(CspMode::from_env_value(Some("0")), CspMode::Off);
        assert_eq!(CspMode::from_env_value(Some("false")), CspMode::Off);
    }

    /// 默认策略允许插件所需的 eval，但**不**允许内联脚本——后者才是 XSS 的主入口。
    #[test]
    fn csp_default_policy_shape() {
        let policy = CspMode::Plugins.policy().expect("plugins 模式应有 CSP");
        assert!(policy.contains("script-src 'self' 'unsafe-eval'"));
        assert!(!policy.contains("script-src 'self' 'unsafe-inline'"));
        assert!(policy.contains("object-src 'none'"));
        assert!(policy.contains("frame-ancestors 'none'"));
        assert!(policy.contains("base-uri 'self'"));
        // 允许 xterm / React 注入样式
        assert!(policy.contains("style-src 'self' 'unsafe-inline'"));
        // 连到同源 API 与 WS（ws: 在 CSP 里不与 'self' 自动等价）
        assert!(policy.contains("connect-src 'self' ws: wss:"));
    }

    #[test]
    fn csp_strict_drops_eval_and_off_returns_none() {
        let strict = CspMode::Strict.policy().unwrap();
        assert!(strict.contains("script-src 'self';"));
        assert!(!strict.contains("unsafe-eval"));
        assert!(CspMode::Off.policy().is_none());
    }

    #[tokio::test]
    async fn csp_header_present_on_response() {
        let res = call(&[]).await;
        let csp = res.headers()["content-security-policy"].to_str().unwrap().to_string();
        assert!(csp.contains("default-src 'self'"));
    }
}
