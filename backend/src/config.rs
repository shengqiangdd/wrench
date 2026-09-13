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
    /// 两者都没有时为 `None` —— 这就是**首次设置模式**：启动日志里会打印一次性
    /// setup token，网页显示「首次设置」，由使用者自己设口令（PBKDF2 哈希落库）。
    /// 在此之前，所有受保护接口返回 503，绝不放行未认证请求（fail-closed）。
    ///
    /// 注意：**不再自动生成随机口令并落盘**。自动生成会让「网页首次设置」在容器部署里
    /// 永远走不到，使用者只能去 `cat` 容器里的明文口令 —— 那是被刻意改掉的旧体验。
    pub auth_password: Option<String>,
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
        })
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

    // 3. 都没有 → 进入首次设置模式（fail-closed，由使用者自己在网页里设口令）
    eprintln!("🔑 未配置入口口令（{} 不存在）—— 进入首次设置模式。", file_path.display());
    eprintln!("   网页会显示「首次设置」，粘贴启动日志里的一次性 setup token 即可设置口令。");
    eprintln!("   也可以直接设置环境变量 WRENCH_AUTH_PASSWORD 后重启。");
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
