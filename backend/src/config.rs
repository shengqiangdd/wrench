use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub frontend_dist: PathBuf,
    pub plugins_dir: PathBuf,
    pub cors_origins: Vec<String>,
    pub openrouter_api_key: Option<String>,
    pub jwt_secret: String,
    pub vault_key: Option<String>,
    pub database_url: Option<String>,
    pub log_level: String,
    /// 登录密码（用于 /api/auth/login 换取会话 JWT）。
    ///
    /// 来源优先级：
    /// 1. 环境变量 `WRENCH_AUTH_PASSWORD`
    /// 2. `WRENCH_AUTH_PASSWORD_FILE` 指向的文件；
    ///    未显式指定时回退到数据库所在目录（容器内为 `/data`）下的 `auth_password`
    ///
    /// 两者都没有时为 `None` —— 此时若门是开的（见 [`AppConfig::require_auth`]），
    /// 所有受保护接口返回 503（fail-closed），日志会告诉部署者该怎么配。
    ///
    /// 注意：**不再自动生成随机口令并落盘**；也**不再有「网页首次设置口令」** ——
    /// 口令是部署侧的事，使用者不该被要求设口令（那是被刻意改掉的旧体验）。
    pub auth_password: Option<String>,
    /// 门是否启用（`WRENCH_REQUIRE_AUTH`，默认 `on`）。
    ///
    /// * `on`（默认）：受保护接口要求会话令牌；未配置口令 → 503（fail-closed）。
    ///   口令只能由**部署侧**提供（`WRENCH_AUTH_PASSWORD` / `WRENCH_AUTH_PASSWORD_FILE`）。
    /// * `off`：**不设门**。零输入直进 —— 任何能访问本地址的人都能使用本实例。
    ///   空间隔离（每个浏览器一个私有空间）与门无关，仍然生效；机器能力仍由
    ///   出口白名单（`WRENCH_EGRESS_ALLOW`）兜住。
    ///
    /// 关闭时启动日志会明确告警，界面顶部也会有一条可关闭的提示条。
    pub require_auth: bool,
    /// 全实例同时保活的 SSH 连接上限（`WRENCH_MAX_SESSIONS`，默认 32；`0` = 不限）。
    ///
    /// 门与出口白名单管的是「谁能连、能连到哪里」，管不住**数量**：每条终端都是一条
    /// 真实的 SSH 连接 + PTY + 上行日志通道。门关着（零输入）时，任何人都能靠不断
    /// 开终端把 fd / 内存 / 带宽吃光 —— 而换一个空间码就能绕开「单空间上限」，
    /// 所以这里必须还有一档**不随身份变化**的全局闸门。
    pub max_sessions: usize,
    /// 单个空间（一个浏览器访客）同时保活的 SSH 连接上限
    /// （`WRENCH_MAX_SESSIONS_PER_SPACE`，默认 8；`0` = 不限）。
    ///
    /// 公平性闸门：防止一个访客把整个实例的连接额度占满，让其他人连不上。
    pub max_sessions_per_space: usize,
    /// 全实例同时打开的 WebSocket 连接上限（`WRENCH_MAX_WS_CONNECTIONS`，默认 128；`0` = 不限）。
    ///
    /// SSH 会话闸门（上面两条）只数**已经建好会话**的连接；而「升级成功但还没开会话」
    /// 的连接同样占着 fd + 任务 + 缓冲区。公网可达的实例上，任何人可以只用握手
    /// （不发 connect 消息）就把这类连接堆起来 —— 没有这层上限时它是唯一没有闸门的
    /// 资源入口。到顶后新升级请求直接 503，让已连上的人保住服务。
    pub max_ws_connections: usize,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let host = std::env::var("BRIDGE_HOST").unwrap_or_else(|_| "0.0.0.0".into());
        let port = std::env::var("BRIDGE_PORT")
            .unwrap_or_else(|_| "3001".into())
            .parse::<u16>()
            .unwrap_or(3001);

        let frontend_dist = std::env::var("FRONTEND_DIST").map(PathBuf::from).unwrap_or_else(|_| {
            let cwd = std::env::current_dir().unwrap_or_default();

            // 1. cwd/frontend/dist — works when backend binary runs from project root
            let primary = cwd.join("frontend").join("dist");
            if primary.exists() {
                return primary;
            }

            // 2. ../frontend/dist — works when binary runs from backend/ subdir
            let sibling = cwd.parent().unwrap_or(&cwd).join("frontend").join("dist");
            if sibling.exists() {
                return sibling;
            }

            // 3. Fallback to primary even if missing (error will surface at runtime)
            primary
        });

        let plugins_dir = std::env::var("PLUGINS_DIR").map(PathBuf::from).unwrap_or_else(|_| {
            let cwd = std::env::current_dir().unwrap_or_default();

            // 1. cwd/plugins — works when binary runs from project root
            let primary = cwd.join("plugins");
            if primary.exists() {
                return primary;
            }

            // 2. ../plugins — works when binary runs from backend/ subdir
            let sibling = cwd.parent().unwrap_or(&cwd).join("plugins");
            if sibling.exists() {
                return sibling;
            }

            // 3. Fallback to primary even if missing (error will surface at runtime)
            primary
        });

        let cors_origins = std::env::var("CORS_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect();

        let openrouter_api_key = std::env::var("OPENROUTER_API_KEY").ok();
        let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
            eprintln!(
                "⚠️  WARNING: JWT_SECRET not set — generating random key. This will invalidate all tokens on restart."
            );
            eprintln!("   Set JWT_SECRET in your environment for persistent authentication.");
            uuid::Uuid::new_v4().to_string()
        });

        let vault_key = std::env::var("VAULT_KEY").ok();

        let database_url = std::env::var("DATABASE_URL").ok().or_else(|| {
            // Default to /data/wrench.db when running in Docker
            let in_container =
                std::path::Path::new("/.dockerenv").exists() || std::env::var("DOCKER_CONTAINER").is_ok();
            if in_container {
                Some("/data/wrench.db".into())
            } else {
                None
            }
        });
        let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".into());
        let auth_password = resolve_auth_password(database_url.as_deref());
        let require_auth = parse_require_auth(std::env::var("WRENCH_REQUIRE_AUTH").ok().as_deref());
        let max_sessions =
            parse_positive_usize(std::env::var("WRENCH_MAX_SESSIONS").ok().as_deref(), DEFAULT_MAX_SESSIONS);
        let max_sessions_per_space = parse_positive_usize(
            std::env::var("WRENCH_MAX_SESSIONS_PER_SPACE").ok().as_deref(),
            DEFAULT_MAX_SESSIONS_PER_SPACE,
        );
        let max_ws_connections = parse_positive_usize(
            std::env::var("WRENCH_MAX_WS_CONNECTIONS").ok().as_deref(),
            DEFAULT_MAX_WS_CONNECTIONS,
        );

        Ok(Self {
            host,
            port,
            frontend_dist,
            plugins_dir,
            cors_origins,
            openrouter_api_key,
            jwt_secret,
            vault_key,
            database_url,
            log_level,
            auth_password,
            require_auth,
            max_sessions,
            max_sessions_per_space,
            max_ws_connections,
        })
    }
}

/// 全实例同时保活连接数的默认上限（见 [`AppConfig::max_sessions`]）。
pub const DEFAULT_MAX_SESSIONS: usize = 32;

/// 单空间同时保活连接数的默认上限（见 [`AppConfig::max_sessions_per_space`]）。
pub const DEFAULT_MAX_SESSIONS_PER_SPACE: usize = 8;

/// 全实例同时打开的 WebSocket 连接数默认上限（见 [`AppConfig::max_ws_connections`]）。
///
/// 定在 128 的理由：一个正常访客同时开不了几条 WS（终端 1 条 + 日志/监控各 1 条），
/// 128 足够十几个人同时用；同时它远低于「把 fd / 内存吃光」的量级（每条 WS 连接
/// 约数 KB 缓冲 + 一个任务）。真要给几十人同时用，调大这个值即可。
pub const DEFAULT_MAX_WS_CONNECTIONS: usize = 128;

/// 解析「连接数上限」这类环境变量。
///
/// * 未设置 / 空串 / 非法值 → 默认值（**拼错不等于关掉闸门**，与门开关同一条思路）；
/// * 显式 `0` → 不限（`0` 是合法配置，用于自建的可信环境）。
fn parse_positive_usize(raw: Option<&str>, default: usize) -> usize {
    match raw.map(str::trim) {
        None | Some("") => default,
        Some(v) => v.parse::<usize>().unwrap_or(default),
    }
}

/// 解析门开关，见 [`AppConfig::require_auth`]。
///
/// 只认 `on` / `off`（以及常见同义词）。**无法识别的值按 `on` 处理**：
/// 拼错一个变量名不该让一台公网机器变成人人可用。
fn parse_require_auth(raw: Option<&str>) -> bool {
    match raw.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") => true,
        Some("on") | Some("true") | Some("1") | Some("yes") | Some("enabled") => true,
        Some("off") | Some("false") | Some("0") | Some("no") | Some("disabled") => false,
        Some(other) => {
            eprintln!("⚠️  WRENCH_REQUIRE_AUTH=\"{other}\" 无法识别（可选 on/off），按默认 on 处理。");
            true
        }
    }
}

/// 维护令牌（可选）：只有持有它的人能调用「全局性」接口
/// （整库下载、插件安装/卸载）。未设置时这些接口一律 404 —— 多人共用下
/// 「人人平等」意味着没有人可以拿到别人的数据，包括整库导出。
///
/// 直接从环境变量读取（部署侧提供，不进仓库、不进日志）。
pub fn maintenance_token() -> Option<String> {
    std::env::var("WRENCH_MAINTENANCE_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// 解析登录密码，见 [`AppConfig::auth_password`]。
///
/// 返回 `None` 表示无法确定密码 —— 调用方必须保持 fail-closed（拒绝所有受保护请求）。
fn resolve_auth_password(database_url: Option<&str>) -> Option<String> {
    // 1. 环境变量（部署推荐方式，不进仓库）
    if let Ok(pw) = std::env::var("WRENCH_AUTH_PASSWORD") {
        let pw = pw.trim().to_string();
        if !pw.is_empty() {
            // 只报「来源」；门是否开着由 app_state 统一宣布（避免出现「已启用」却门开着是关闭的错话）
            eprintln!("🔑 入口口令来源：WRENCH_AUTH_PASSWORD 环境变量（仅在门开着时生效）。");
            return Some(pw);
        }
        eprintln!("⚠️  WRENCH_AUTH_PASSWORD 为空，忽略并继续查找其它来源。");
    }

    // 2. 显式指定的密码文件
    let file_path = std::env::var("WRENCH_AUTH_PASSWORD_FILE")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| default_password_file(database_url));

    if let Some(pw) = read_password_file(&file_path) {
        eprintln!("🔑 入口口令来源：密码文件 {}（仅在门开着时生效）。", file_path.display());
        return Some(pw);
    }

    // 3. 都没有 → 没有口令可用（`require_auth=on` 时受保护接口会 503，fail-closed）
    eprintln!("🔑 未配置入口口令（{} 不存在）。", file_path.display());
    eprintln!("   若需要口令门：设置环境变量 WRENCH_AUTH_PASSWORD（或 WRENCH_AUTH_PASSWORD_FILE）后重启。");
    eprintln!("   若不需要口令门（访客零输入直进）：设置 WRENCH_REQUIRE_AUTH=off。");
    None
}

/// 密码文件默认位置：优先与数据库同目录（容器内 `/data`，是持久卷），
/// 否则退回 `~/.wrench/auth_password`，避免在仓库目录里落盘明文密码。
fn default_password_file(database_url: Option<&str>) -> PathBuf {
    if let Some(db) = database_url
        && let Some(dir) = Path::new(db).parent()
        && !dir.as_os_str().is_empty()
    {
        return dir.join("auth_password");
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    PathBuf::from(home).join(".wrench").join("auth_password")
}

fn read_password_file(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let pw = content.trim().to_string();
    if pw.is_empty() { None } else { Some(pw) }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_MAX_SESSIONS, DEFAULT_MAX_SESSIONS_PER_SPACE, parse_positive_usize, parse_require_auth};

    #[test]
    fn session_caps_default_and_explicit_zero() {
        // 未设置 / 空串 → 默认闸门（不是不限）
        assert_eq!(parse_positive_usize(None, DEFAULT_MAX_SESSIONS), 32);
        assert_eq!(parse_positive_usize(Some(""), DEFAULT_MAX_SESSIONS), 32);
        assert_eq!(parse_positive_usize(Some("   "), DEFAULT_MAX_SESSIONS_PER_SPACE), 8);
        // 显式 0 = 不限（合法配置）
        assert_eq!(parse_positive_usize(Some("0"), DEFAULT_MAX_SESSIONS), 0);
        // 自定义值
        assert_eq!(parse_positive_usize(Some(" 64 "), DEFAULT_MAX_SESSIONS), 64);
        // 非法值回落到默认（防止手滑把闸门关掉）
        assert_eq!(parse_positive_usize(Some("abc"), DEFAULT_MAX_SESSIONS), 32);
        assert_eq!(parse_positive_usize(Some("-1"), DEFAULT_MAX_SESSIONS), 32);
    }

    #[test]
    fn ws_cap_default_and_explicit_zero() {
        use super::DEFAULT_MAX_WS_CONNECTIONS;
        // 未设置 / 空串 → 默认闸门（不是不限）
        assert_eq!(parse_positive_usize(None, DEFAULT_MAX_WS_CONNECTIONS), 128);
        assert_eq!(parse_positive_usize(Some(""), DEFAULT_MAX_WS_CONNECTIONS), 128);
        // 显式 0 = 不限
        assert_eq!(parse_positive_usize(Some("0"), DEFAULT_MAX_WS_CONNECTIONS), 0);
        // 自定义值 / 非法值回落
        assert_eq!(parse_positive_usize(Some("512"), DEFAULT_MAX_WS_CONNECTIONS), 512);
        assert_eq!(parse_positive_usize(Some("abc"), DEFAULT_MAX_WS_CONNECTIONS), 128);
    }

    #[test]
    fn default_is_gate_on() {
        assert!(parse_require_auth(None));
        assert!(parse_require_auth(Some("")));
        assert!(parse_require_auth(Some("on")));
        assert!(parse_require_auth(Some("ON")));
        assert!(parse_require_auth(Some(" true ")));
    }

    #[test]
    fn off_values_disable_the_gate() {
        for raw in ["off", "OFF", "false", "0", "no", "disabled"] {
            assert!(!parse_require_auth(Some(raw)), "{raw} 应关闭门");
        }
    }

    #[test]
    fn unrecognised_value_falls_back_to_gate_on() {
        // 拼错一个变量名不该让一台公网机器变成人人可用
        assert!(parse_require_auth(Some("ture")));
        assert!(parse_require_auth(Some("disable")));
    }
}
