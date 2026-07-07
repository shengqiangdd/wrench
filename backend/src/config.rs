use std::path::PathBuf;

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
            cwd.join("frontend").join("dist")
        });

        let plugins_dir = std::env::var("PLUGINS_DIR").map(PathBuf::from).unwrap_or_else(|_| {
            let cwd = std::env::current_dir().unwrap_or_default();
            cwd.join("plugins")
        });

        let cors_origins = std::env::var("CORS_ORIGINS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| s.trim().to_string())
            .collect();

        let openrouter_api_key = std::env::var("OPENROUTER_API_KEY").ok();
        let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

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
        })
    }
}
