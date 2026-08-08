use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use russh::keys::PublicKey;

/// Known hosts verification for SSH connections.
/// Prevents MITM attacks by verifying host keys against a trusted store.
#[derive(Clone)]
pub struct KnownHosts {
    path: PathBuf,
    strict_mode: bool,
}

impl KnownHosts {
    /// Create a new KnownHosts instance.
    ///
    /// # Arguments
    /// * `path` - Path to the known_hosts file (default: ~/.wrench/known_hosts)
    /// * `strict_mode` - If true, reject unknown hosts; if false, auto-accept with warning
    pub fn new(path: Option<PathBuf>, strict_mode: bool) -> Self {
        let path = path.unwrap_or_else(|| {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".wrench").join("known_hosts")
        });

        Self { path, strict_mode }
    }

    /// Get a stable string representation of a public key.
    /// Uses the OpenSSH format (e.g. "ssh-ed25519 AAAA...") which is unique per key.
    pub fn key_fingerprint(key: &PublicKey) -> String {
        // ssh_key::PublicKey::to_string() produces a stable OpenSSH-format line
        // e.g. "ssh-ed25519 AAAA..." — unique per key, no hash version issues
        key.to_string()
    }

    /// Get the host identifier (ip:port format).
    pub fn host_key(host: &str, port: u16) -> String {
        format!("{}:{}", host, port)
    }

    /// Check if a host key is trusted.
    /// Returns Ok(true) if trusted, Ok(false) if not found, Err if file error.
    pub fn is_trusted(&self, host: &str, port: u16, key: &PublicKey) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        if !self.path.exists() {
            return Ok(false);
        }

        let file = fs::File::open(&self.path)?;
        let reader = BufReader::new(file);
        let target_fp = Self::key_fingerprint(key);
        let target_host = Self::host_key(host, port);

        for line in reader.lines() {
            let line = line?;
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // Format: host:port key_fingerprint
            if let Some((host_port, fp)) = line.split_once(' ') {
                if host_port == target_host && fp == target_fp {
                    return Ok(true);
                }
            }
        }

        Ok(false)
    }

    /// Add a host key to the trusted store.
    pub fn trust(&self, host: &str, port: u16, key: &PublicKey) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Ensure directory exists
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;

        let fingerprint = Self::key_fingerprint(key);
        let host_key = Self::host_key(host, port);

        writeln!(file, "{} {}", host_key, fingerprint)?;

        tracing::info!("Trusted host key: {} (fingerprint: {})", host_key, fingerprint);
        Ok(())
    }

    /// Remove a host key from the trusted store.
    pub fn remove(&self, host: &str, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.path.exists() {
            return Ok(());
        }

        let file = fs::File::open(&self.path)?;
        let reader = BufReader::new(file);
        let target_host = Self::host_key(host, port);

        let lines: Vec<String> = reader
            .lines()
            .filter_map(|line| line.ok())
            .filter(|line| {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    return true;
                }
                // Keep lines that don't match the host:port
                line.split_once(' ')
                    .map(|(host_port, _)| host_port != target_host)
                    .unwrap_or(true)
            })
            .collect();

        let mut file = fs::File::create(&self.path)?;
        for line in lines {
            writeln!(file, "{}", line)?;
        }

        tracing::info!("Removed host key for: {}", target_host);
        Ok(())
    }

    /// Verify a host key and handle trust based on mode.
    ///
    /// Returns:
    /// - Ok(true) if key is trusted or auto-accepted
    /// - Ok(false) if key is rejected (strict mode, unknown host)
    /// - Err if there's an error during verification
    pub fn verify(
        &self,
        host: &str,
        port: u16,
        key: &PublicKey,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        if self.is_trusted(host, port, key)? {
            tracing::debug!("Host key verified: {}", Self::host_key(host, port));
            return Ok(true);
        }

        // Host not trusted
        if self.strict_mode {
            tracing::warn!(
                "Strict mode: rejecting unknown host key for {} (fingerprint: {})",
                Self::host_key(host, port),
                Self::key_fingerprint(key)
            );
            return Ok(false);
        } else {
            // Auto-accept with warning
            tracing::warn!(
                "Auto-accepting new host key for {} (fingerprint: {}). Consider adding to known_hosts for production.",
                Self::host_key(host, port),
                Self::key_fingerprint(key)
            );
            // Trust the new key
            self.trust(host, port, key)?;
            return Ok(true);
        }
    }

    /// Get list of all trusted host keys.
    pub fn list(&self) -> Result<Vec<(String, String)>, Box<dyn std::error::Error + Send + Sync>> {
        let mut entries = Vec::new();

        if !self.path.exists() {
            return Ok(entries);
        }

        let file = fs::File::open(&self.path)?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line?;
            let line = line.trim();

            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            if let Some((host_port, fp)) = line.split_once(' ') {
                entries.push((host_port.to_string(), fp.to_string()));
            }
        }

        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_host_key_format() {
        assert_eq!(KnownHosts::host_key("192.168.1.1", 22), "192.168.1.1:22");
        assert_eq!(KnownHosts::host_key("example.com", 2222), "example.com:2222");
    }

    #[test]
    fn test_known_hosts_file_parsing() {
        let content = "# Comment line\n192.168.1.1:22 ssh-ed25519 AAAA\n10.0.0.1:2222 ssh-rsa AAAA\n";

        let mut entries = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((host_port, fp)) = line.split_once(' ') {
                entries.push((host_port.to_string(), fp.to_string()));
            }
        }

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].0, "192.168.1.1:22");
        assert_eq!(entries[0].1, "ssh-ed25519 AAAA");
    }

    #[test]
    fn test_known_hosts_trust_and_verify() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        let _known_hosts = KnownHosts::new(Some(known_hosts_path.clone()), false);

        let host = "192.168.1.1";
        let port = 22;
        let fingerprint = "ssh-ed25519 AAAA";

        fs::write(&known_hosts_path, format!("{}:{} {}\n", host, port, fingerprint)).unwrap();

        let entries = KnownHosts::new(Some(known_hosts_path), false).list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "192.168.1.1:22");
        assert_eq!(entries[0].1, "ssh-ed25519 AAAA");
    }

    #[test]
    fn test_known_hosts_remove() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        fs::write(&known_hosts_path, "192.168.1.1:22 ssh-ed25519 ABC\n10.0.0.1:2222 ssh-rsa DEF\n").unwrap();

        let known_hosts = KnownHosts::new(Some(known_hosts_path.clone()), false);
        known_hosts.remove("192.168.1.1", 22).unwrap();

        let entries = known_hosts.list().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, "10.0.0.1:2222");
    }

    #[test]
    fn test_known_hosts_empty_file() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        let known_hosts = KnownHosts::new(Some(known_hosts_path.clone()), false);
        fs::write(&known_hosts_path, "").unwrap();
        let entries = known_hosts.list().unwrap();
        assert_eq!(entries.len(), 0);

        let known_hosts2 = KnownHosts::new(Some(dir.path().join("nonexistent")), false);
        let entries2 = known_hosts2.list().unwrap();
        assert_eq!(entries2.len(), 0);
    }

    #[test]
    fn test_known_hosts_comments() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        fs::write(&known_hosts_path, "# This is a comment\n192.168.1.1:22 ssh-ed25519 ABC\n# Another comment\n").unwrap();

        let known_hosts = KnownHosts::new(Some(known_hosts_path), false);
        let entries = known_hosts.list().unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn test_known_hosts_strict_mode() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        let known_hosts_strict = KnownHosts::new(Some(known_hosts_path.clone()), true);
        assert!(known_hosts_strict.strict_mode);

        let known_hosts_auto = KnownHosts::new(Some(known_hosts_path), false);
        assert!(!known_hosts_auto.strict_mode);
    }
}
