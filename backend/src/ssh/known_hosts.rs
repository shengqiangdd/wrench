use russh::keys::PublicKey;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// 临时文件名序号：保证同一进程内并发覆写时临时文件不互相覆盖。
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

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
    pub fn is_trusted(
        &self,
        host: &str,
        port: u16,
        key: &PublicKey,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
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
            if let Some((host_port, fp)) = line.split_once(' ')
                && host_port == target_host
                && fp == target_fp
            {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Add a host key to the trusted store.
    pub fn trust(
        &self,
        host: &str,
        port: u16,
        key: &PublicKey,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Ensure directory exists
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file = fs::OpenOptions::new().create(true).append(true).open(&self.path)?;

        let fingerprint = Self::key_fingerprint(key);
        let host_key = Self::host_key(host, port);

        writeln!(file, "{} {}", host_key, fingerprint)?;

        tracing::info!("Trusted host key: {} (fingerprint: {})", host_key, fingerprint);
        Ok(())
    }

    /// 原子覆写整个 known_hosts 文件。
    ///
    /// 先写同目录下的临时文件并 `fsync`，再 `rename` 覆盖目标：
    /// - 同一文件系统内 rename 是原子的，读者要么看到旧内容要么看到新内容；
    /// - 旧的 `File::create(&self.path)` 会先截断原文件，若写入中途失败（磁盘满、
    ///   进程被杀），known_hosts 就被截断/清空，主机密钥校验随之失守；
    /// - 覆写沿用原文件权限（known_hosts 通常为 0600，不能被进程 umask 放宽）。
    fn rewrite(&self, lines: &[&str]) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let parent = self.path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)?;

        let existing_perms = fs::metadata(&self.path).ok().map(|m| m.permissions());

        // 临时文件放在目标同目录：跨文件系统 rename 会失败（EXDEV）
        let stem = self.path.file_name().and_then(|n| n.to_str()).unwrap_or("known_hosts");
        let tmp = parent.join(format!(
            ".{}.{}.{}.tmp",
            stem,
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));

        let write_result = (|| -> std::io::Result<()> {
            let mut file = fs::File::create(&tmp)?;
            for line in lines {
                writeln!(file, "{}", line)?;
            }
            file.sync_all()?;
            Ok(())
        })();

        if let Err(err) = write_result {
            let _ = fs::remove_file(&tmp);
            return Err(err.into());
        }

        if let Some(perms) = existing_perms
            && let Err(err) = fs::set_permissions(&tmp, perms)
        {
            // 权限设置失败不阻断替换，但必须可观测
            tracing::warn!("Failed to preserve permissions on {}: {}", tmp.display(), err);
        }

        if let Err(err) = fs::rename(&tmp, &self.path) {
            let _ = fs::remove_file(&tmp);
            return Err(err.into());
        }

        Ok(())
    }

    /// Remove a host key from the trusted store.
    pub fn remove(&self, host: &str, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.path.exists() {
            return Ok(());
        }

        // 一次性读入：known_hosts 很小，且这样能避免 `lines().filter_map(Result::ok)`
        // 在持续读错误时永不结束（clippy::lines_filter_map_ok）。读失败即报错返回，
        // 不会在下面的覆写里悄悄截断文件。
        let content = fs::read_to_string(&self.path)?;
        let target_host = Self::host_key(host, port);

        let lines: Vec<&str> = content
            .lines()
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

        self.rewrite(&lines)?;

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
            Ok(false)
        } else {
            // Auto-accept with warning
            tracing::warn!(
                "Auto-accepting new host key for {} (fingerprint: {}). Consider adding to known_hosts for production.",
                Self::host_key(host, port),
                Self::key_fingerprint(key)
            );
            // Trust the new key
            self.trust(host, port, key)?;
            Ok(true)
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
    fn test_known_hosts_remove_missing_file_is_noop() {
        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");

        let known_hosts = KnownHosts::new(Some(known_hosts_path.clone()), false);
        known_hosts.remove("192.168.1.1", 22).unwrap();
        assert!(!known_hosts_path.exists(), "文件不存在时 remove 不应创建文件");
    }

    #[cfg(unix)]
    #[test]
    fn test_known_hosts_rewrite_preserves_permissions_and_leaves_no_temp_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir().unwrap();
        let known_hosts_path = dir.path().join("known_hosts");
        fs::write(&known_hosts_path, "192.168.1.1:22 ssh-ed25519 ABC\n10.0.0.1:2222 ssh-rsa DEF\n").unwrap();
        fs::set_permissions(&known_hosts_path, fs::Permissions::from_mode(0o600)).unwrap();

        let known_hosts = KnownHosts::new(Some(known_hosts_path.clone()), false);
        known_hosts.remove("192.168.1.1", 22).unwrap();

        let mode = fs::metadata(&known_hosts_path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "原子覆写必须保留原文件权限");

        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["known_hosts".to_string()], "覆写后不应残留临时文件");
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

        fs::write(
            &known_hosts_path,
            "# This is a comment\n192.168.1.1:22 ssh-ed25519 ABC\n# Another comment\n",
        )
        .unwrap();

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
