//! Database module placeholder.
//! SmartBox can operate in-memory without a database.
//! When PostgreSQL is available, uncomment sqlx dependency in Cargo.toml
//! and enable the `postgres` feature.

/// Optional database configuration.
pub struct Database {
    url: Option<String>,
}

impl Default for Database {
    fn default() -> Self {
        Self::new()
    }
}

impl Database {
    pub fn new() -> Self {
        let url = std::env::var("DATABASE_URL").ok();
        Self { url }
    }

    /// Check if database is configured.
    pub fn is_configured(&self) -> bool {
        self.url.is_some()
    }

    /// Get the database URL.
    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
    }
}
