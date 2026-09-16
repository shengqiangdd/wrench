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
        })
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
            eprintln!("🔐 认证已启用：使用 WRENCH_AUTH_PASSWORD 环境变量中的密码。");
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
        eprintln!("🔐 认证已启用：使用密码文件 {}", file_path.display());
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
    use super::parse_require_auth;

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
