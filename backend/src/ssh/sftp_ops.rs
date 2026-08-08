use std::sync::Arc;

use crate::ssh::pool::SshSession;

/// Disk usage information for a directory.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiskUsage {
    pub path: String,
    pub total_size: i64,
    pub file_count: i64,
    pub dir_count: i64,
    pub largest_file: Option<String>,
    pub largest_size: i64,
}

/// File hash result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileHash {
    pub path: String,
    pub md5: String,
    pub sha1: String,
    pub sha256: String,
}

/// Batch delete result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BatchDeleteResult {
    pub success: Vec<String>,
    pub failed: Vec<BatchDeleteError>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct BatchDeleteError {
    pub path: String,
    pub error: String,
}

/// Get disk usage for a directory via SSH exec (`du -sb`).
pub async fn disk_usage(session: &Arc<SshSession>, path: &str) -> Result<DiskUsage, String> {
    let cmd = format!(
        "du -sb {} 2>/dev/null | head -1",
        shell_escape(path)
    );
    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("disk_usage failed: {}", e))?;
    if result.exit_code != 0 {
        return Err(format!("du failed (exit {}): {}", result.exit_code, result.stderr));
    }
    let line = result.stdout.trim();
    let total_size: i64 = line.split_whitespace().next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    // Count files and dirs
    let count_cmd = format!(
        "find {} -maxdepth 1 2>/dev/null | wc -l",
        shell_escape(path)
    );
    let count_result = crate::ssh::executor::execute_command(session, &count_cmd).await
        .map_err(|e| format!("count failed: {}", e))?;
    let total_entries: i64 = count_result.stdout.trim().parse().unwrap_or(0);
    let dir_count_cmd = format!(
        "find {} -maxdepth 1 -type d 2>/dev/null | wc -l",
        shell_escape(path)
    );
    let dir_result = crate::ssh::executor::execute_command(session, &dir_count_cmd).await
        .map_err(|e| format!("dir count failed: {}", e))?;
    let dir_count: i64 = dir_result.stdout.trim().parse().unwrap_or(0);
    let file_count = total_entries - dir_count;

    // Find largest file
    let largest_cmd = format!(
        "find {} -maxdepth 1 -type f -printf '%s %p\\n' 2>/dev/null | sort -rn | head -1",
        shell_escape(path)
    );
    let largest_result = crate::ssh::executor::execute_command(session, &largest_cmd).await
        .map_err(|e| format!("largest failed: {}", e))?;
    let (largest_file, largest_size) = if let Some(line) = largest_result.stdout.trim().lines().next() {
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() == 2 {
            (Some(parts[1].to_string()), parts[0].parse().unwrap_or(0))
        } else {
            (None, 0)
        }
    } else {
        (None, 0)
    };

    Ok(DiskUsage {
        path: path.to_string(),
        total_size,
        file_count,
        dir_count,
        largest_file,
        largest_size,
    })
}

/// Get file hashes (md5, sha1, sha256) via SSH exec.
pub async fn file_hash(session: &Arc<SshSession>, path: &str) -> Result<FileHash, String> {
    let cmd = format!(
        "md5sum {p} 2>/dev/null | awk '{{print $1}}' && sha1sum {p} 2>/dev/null | awk '{{print $1}}' && sha256sum {p} 2>/dev/null | awk '{{print $1}}'",
        p = shell_escape(path),
    );
    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("file_hash failed: {}", e))?;
    if result.exit_code != 0 {
        return Err(format!("hash failed (exit {}): {}", result.exit_code, result.stderr));
    }
    let lines: Vec<&str> = result.stdout.trim().lines().collect();
    Ok(FileHash {
        path: path.to_string(),
        md5: lines.get(0).unwrap_or(&"").to_string(),
        sha1: lines.get(1).unwrap_or(&"").to_string(),
        sha256: lines.get(2).unwrap_or(&"").to_string(),
    })
}

/// Batch delete multiple files/directories.
pub async fn batch_delete(
    session: &Arc<SshSession>,
    paths: &[String],
    sudo_password: Option<&str>,
) -> BatchDeleteResult {
    let mut success = Vec::new();
    let mut failed = Vec::new();

    // Build a single shell command for efficiency
    let rm_cmds: Vec<String> = paths.iter().map(|p| {
        let flag = "-rf"; // recursive delete
        format!("rm {} {} 2>&1", flag, shell_escape(p))
    }).collect();

    if sudo_password.is_some() {
        // Use sudo for batch delete
        let sudo_pwd = sudo_password.unwrap();
        let cmd = format!(
            "echo {} | sudo -S sh -c '{}' 2>&1",
            shell_escape(sudo_pwd),
            rm_cmds.join("; ")
        );
        let result = crate::ssh::executor::execute_command(session, &cmd).await;
        match result {
            Ok(r) => {
                if r.exit_code == 0 {
                    success = paths.to_vec();
                } else {
                    // Partial failure - mark all as failed
                    for p in paths {
                        failed.push(BatchDeleteError {
                            path: p.clone(),
                            error: r.stderr.trim().to_string(),
                        });
                    }
                }
            }
            Err(e) => {
                for p in paths {
                    failed.push(BatchDeleteError {
                        path: p.clone(),
                        error: e.clone(),
                    });
                }
            }
        }
    } else {
        // No sudo - delete one by one
        for p in paths {
            let cmd = format!("rm -rf {} 2>&1", shell_escape(p));
            match crate::ssh::executor::execute_command(session, &cmd).await {
                Ok(r) if r.exit_code == 0 => success.push(p.clone()),
                Ok(r) => failed.push(BatchDeleteError {
                    path: p.clone(),
                    error: r.stderr.trim().to_string(),
                }),
                Err(e) => failed.push(BatchDeleteError {
                    path: p.clone(),
                    error: e.clone(),
                }),
            }
        }
    }

    BatchDeleteResult { success, failed }
}

/// Move (rename) multiple files to a target directory.
pub async fn batch_move(
    session: &Arc<SshSession>,
    paths: &[String],
    target_dir: &str,
    sudo_password: Option<&str>,
) -> BatchDeleteResult {
    let mut success = Vec::new();
    let mut failed = Vec::new();

    for p in paths {
        let filename = p.rsplit('/').next().unwrap_or(p);
        let dest = format!("{}/{}", target_dir.trim_end_matches('/'), filename);

        let cmd = if let Some(pwd) = sudo_password {
            format!(
                "echo {} | sudo -S mv {} {} 2>&1",
                shell_escape(pwd),
                shell_escape(p),
                shell_escape(&dest),
            )
        } else {
            format!("mv {} {} 2>&1", shell_escape(p), shell_escape(&dest))
        };

        match crate::ssh::executor::execute_command(session, &cmd).await {
            Ok(r) if r.exit_code == 0 => success.push(p.clone()),
            Ok(r) => failed.push(BatchDeleteError {
                path: p.clone(),
                error: r.stderr.trim().to_string(),
            }),
            Err(e) => failed.push(BatchDeleteError {
                path: p.clone(),
                error: e.clone(),
            }),
        }
    }

    BatchDeleteResult { success, failed }
}

/// Escape a path for safe use in shell commands.
fn shell_escape(path: &str) -> String {
    let escaped = path.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_escape() {
        assert_eq!(shell_escape("/tmp/test"), "'/tmp/test'");
        assert_eq!(shell_escape("/tmp/test file"), "'/tmp/test file'");
        assert_eq!(shell_escape("/tmp/test'file"), "'/tmp/test'\\''file'");
    }
}
