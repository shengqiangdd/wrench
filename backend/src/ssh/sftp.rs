use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use russh_sftp::{
    client::SftpSession,
    protocol::{FileAttributes, OpenFlags},
};

use crate::ssh::pool::SshSession;

/// SFTP file entry
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(alias = "is_dir")]
    pub r#type: String,
    /// For symlinks: the resolved target type ("directory" / "file" / "symlink" if broken).
    /// `null` for non-symlinks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_type: Option<String>,
    /// For symlinks: the absolute path the symlink points to.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_target: Option<String>,
    pub size: i64,
    pub permissions: String,
    #[serde(alias = "modified")]
    pub modify_time: i64,
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub group: String,
}

/// Determine file type from SFTP permission bits (POSIX file type mask).
///
/// SFTP returns permissions with the file type encoded in the high bits:
/// - `0o040000` = directory (S_IFDIR)
/// - `0o120000` = symbolic link (S_IFLNK)
/// - `0o100000` = regular file (S_IFREG)
/// - `0o060000` = block device
/// - `0o020000` = character device
/// - `0o010000` = named pipe (FIFO)
/// - `0o140000` = socket
fn file_type_from_permissions(perms: Option<u32>) -> String {
    match perms {
        Some(p) => {
            let ft = p & 0o170000; // S_IFMT mask
            if ft == 0o040000 {
                "directory"
            } else if ft == 0o120000 {
                "symlink"
            } else if ft == 0o060000 {
                "block_device"
            } else if ft == 0o020000 {
                "char_device"
            } else if ft == 0o010000 {
                "fifo"
            } else if ft == 0o140000 {
                "socket"
            } else {
                "file"
            }
        }
        None => "file",
    }
    .to_string()
}

/// Convert a `Metadata` (which is `FileAttributes`) into our `FileEntry`.
fn attrs_to_entry(name: String, parent_path: &str, attrs: &FileAttributes) -> FileEntry {
    let path = if parent_path.ends_with('/') {
        format!("{}{}", parent_path, name)
    } else {
        format!("{}/{}", parent_path, name)
    };

    // Detect file type from POSIX permission bits (handles symlinks, devices, etc.)
    let file_type = file_type_from_permissions(attrs.permissions);
    let size = attrs.size.unwrap_or(0) as i64;

    let perm_str = attrs
        .permissions
        .map(|p| format!("{:o}", p & 0o7777))
        .unwrap_or_else(|| "----".to_string());

    let modify_time = attrs.mtime.unwrap_or(0) as i64;

    FileEntry {
        name,
        path,
        r#type: file_type,
        target_type: None,
        link_target: None,
        size,
        permissions: perm_str,
        modify_time,
        owner: attrs.user.clone().unwrap_or_default(),
        group: attrs.group.clone().unwrap_or_default(),
    }
}

/// Open a cached or new SFTP session for an SSH connection.
async fn open_sftp(session: &Arc<SshSession>) -> Result<Arc<SftpSession>, String> {
    session
        .get_sftp_session()
        .await
        .map_err(|e| format!("Failed to open SFTP session: {}", e))
}

/// List directory contents via SFTP.
///
/// For symlinks, attempts to stat the target to resolve `target_type` and `link_target`,
/// enabling the frontend to follow directory symlinks on double-click.
pub async fn list_directory(session: &Arc<SshSession>, path: &str) -> Result<Vec<FileEntry>, String> {
    let sftp = open_sftp(session).await?;
    let abs_path = sftp
        .canonicalize(path)
        .await
        .map_err(|e| format!("Failed to canonicalize path '{}': {}", path, e))?;

    let dir = sftp
        .read_dir(&abs_path)
        .await
        .map_err(|e| format!("Failed to read directory '{}': {}", abs_path, e))?;

    let mut entries: Vec<FileEntry> = dir
        .map(|entry| {
            let name = entry.file_name();
            let attrs = entry.metadata();
            let mut file_entry = attrs_to_entry(name, &abs_path, &attrs);

            // For symlinks, resolve the target type so the frontend can follow them
            if file_entry.r#type == "symlink" {
                // Try to read the symlink target path from attrs
                // russh-sftp doesn't expose readlink directly, so we try stat on the
                // resolved path (canonicalize follows symlinks).
                let link_path = file_entry.path.clone();
                // We'll populate target_type after the loop using a separate stat call
                file_entry.target_type = Some("unknown".to_string());
                // Store the link path in link_target (will be resolved below)
                file_entry.link_target = Some(link_path);
            }

            file_entry
        })
        .collect();

    // Resolve symlink targets in parallel — each symlink needs up to 2 SSH roundtrips
    // (canonicalize + metadata). Use join_all to overlap them across the network.
    let symlink_indices: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.r#type == "symlink")
        .map(|(i, _)| i)
        .collect();

    if !symlink_indices.is_empty() {
        let symlink_futures: Vec<_> = symlink_indices
            .iter()
            .map(|&idx| {
                let sftp = Arc::clone(&sftp);
                let path = entries[idx].path.clone();
                async move {
                    // First try canonicalize (resolves relative symlinks)
                    match sftp.canonicalize(&path).await {
                        Ok(resolved) => match sftp.metadata(&resolved).await {
                            Ok(meta) => {
                                let resolved_type = file_type_from_permissions(meta.permissions);
                                let size = meta.size.unwrap_or(0) as i64;
                                let perm_str = meta
                                    .permissions
                                    .map(|p| format!("{:o}", p & 0o7777))
                                    .unwrap_or_else(|| "----".to_string());
                                (path, Some(resolved_type), Some(resolved), Some(size), Some(perm_str))
                            }
                            Err(_) => {
                                // canonicalize worked but metadata failed — broken symlink
                                (path, Some("broken".to_string()), Some(resolved), None, None)
                            }
                        },
                        Err(_) => {
                            // canonicalize failed — try metadata on the path directly
                            // (russh-sftp metadata follows symlinks by default)
                            match sftp.metadata(&path).await {
                                Ok(meta) => {
                                    let resolved_type = file_type_from_permissions(meta.permissions);
                                    if resolved_type != "symlink" {
                                        let size = meta.size.unwrap_or(0) as i64;
                                        let perm_str = meta
                                            .permissions
                                            .map(|p| format!("{:o}", p & 0o7777))
                                            .unwrap_or_else(|| "----".to_string());
                                        let p = path.clone();
                                        (path, Some(resolved_type), Some(p), Some(size), Some(perm_str))
                                    } else {
                                        (path, Some("broken".to_string()), None, None, None)
                                    }
                                }
                                Err(_) => (path, None, None, None, None),
                            }
                        }
                    }
                }
            })
            .collect();

        let results = futures_util::future::join_all(symlink_futures).await;

        for (idx, (_path, target_type, link_target, size, perm_str)) in
            symlink_indices.iter().zip(results)
        {
            let entry = &mut entries[*idx];
            if let Some(tt) = target_type {
                entry.target_type = Some(tt);
            }
            if let Some(lt) = link_target {
                entry.link_target = Some(lt);
            }
            if let Some(s) = size {
                entry.size = s;
            }
            if let Some(p) = perm_str {
                entry.permissions = p;
            }
        }
    }

    // Sort: directories first, then symlinks, then other files, then by name
    entries.sort_by(|a, b| {
        let type_order = |t: &str| match t {
            "directory" => 0,
            "symlink" => 1,
            _ => 2,
        };
        let ao = type_order(&a.r#type);
        let bo = type_order(&b.r#type);
        if ao != bo {
            ao.cmp(&bo)
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(entries)
}

/// Download a file via SFTP.
pub async fn download_file(session: &Arc<SshSession>, remote_path: &str) -> Result<Vec<u8>, String> {
    let sftp = open_sftp(session).await?;
    let abs_path = sftp
        .canonicalize(remote_path)
        .await
        .map_err(|e| format!("Failed to canonicalize '{}': {}", remote_path, e))?;

    // 获取文件大小，拒绝超大文件（避免 OOM）
    let metadata = sftp
        .metadata(&abs_path)
        .await
        .map_err(|e| format!("Failed to stat '{}': {}", abs_path, e))?;
    let file_size = metadata.len() as usize;
    const MAX_DOWNLOAD_SIZE: usize = 10 * 1024 * 1024; // 10 MB
    if file_size > MAX_DOWNLOAD_SIZE {
        return Err(format!(
            "File too large ({} MB). Use SSH terminal to edit.",
            file_size / 1024 / 1024
        ));
    }

    let mut file = sftp
        .open(&abs_path)
        .await
        .map_err(|e| format!("Failed to open remote file '{}': {}", abs_path, e))?;

    let mut data = Vec::with_capacity(file_size.min(1024 * 1024));
    file.read_to_end(&mut data)
        .await
        .map_err(|e| format!("Failed to read remote file '{}': {}", abs_path, e))?;

    Ok(data)
}

/// Upload a file via SFTP.
/// Falls back to `sudo tee` via SSH exec if SFTP fails due to permissions.
pub async fn upload_file(
    session: &Arc<SshSession>,
    remote_path: &str,
    data: Vec<u8>,
    sudo_password: Option<&str>,
) -> Result<(), String> {
    // Try SFTP first
    let result = upload_file_sftp(session, remote_path, &data).await;
    match result {
        Ok(()) => return Ok(()),
        Err(e) if is_permission_error(&e) && sudo_password.is_some() => {
            // Fallback to sudo tee
            tracing::info!("SFTP upload failed ({}), trying sudo tee for '{}'", e, remote_path);
        }
        Err(e) if sudo_password.is_some() => {
            // Also try sudo for other errors (e.g., parent dir doesn't exist)
            tracing::info!("SFTP upload failed ({}), trying sudo tee for '{}'", e, remote_path);
        }
        Err(e) => return Err(e),
    }
    sudo_upload(session, remote_path, &data, sudo_password.unwrap()).await
}

/// SFTP upload (no sudo fallback)
async fn upload_file_sftp(session: &Arc<SshSession>, remote_path: &str, data: &[u8]) -> Result<(), String> {
    let sftp = open_sftp(session).await?;
    let mut file = sftp
        .open_with_flags(remote_path, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("Failed to open remote file for writing '{}': {}", remote_path, e))?;
    file.write_all(data)
        .await
        .map_err(|e| format!("Failed to write to remote file '{}': {}", remote_path, e))?;
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush remote file '{}': {}", remote_path, e))?;
    Ok(())
}

/// Upload file content via `sudo tee` (base64-encoded to handle binary safely).
async fn sudo_upload(
    session: &Arc<SshSession>,
    remote_path: &str,
    data: &[u8],
    sudo_password: &str,
) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(data);
    // Use printf + base64 -d | sudo tee to avoid shell quoting issues with large data
    // Write the base64 to a temp file, decode with sudo tee
    let tmp_b64 = "/tmp/.wrench_upload_b64";
    let tmp_bin = "/tmp/.wrench_upload_bin";

    // Step 1: Write base64 to temp file (small enough for echo)
    // For large files, use heredoc
    let write_b64_cmd = if b64.len() < 4000 {
        format!("echo {} | base64 -d > {}", shell_escape(&b64), tmp_bin)
    } else {
        // Split into chunks and write
        let mut cmds = Vec::new();
        cmds.push(format!("> {}", tmp_bin));
        for chunk in b64.as_bytes().chunks(4000) {
            let chunk_str = std::str::from_utf8(chunk).unwrap_or("");
            cmds.push(format!("echo -n {} >> {}", shell_escape(chunk_str), tmp_b64));
        }
        cmds.push(format!("base64 -d {} > {}", tmp_b64, tmp_bin));
        cmds.join(" && ")
    };

    // Step 2: sudo tee to target path
    let cmd = format!(
        "{} && echo {} | sudo -S tee {} > /dev/null && rm -f {} {}",
        write_b64_cmd,
        shell_escape(sudo_password),
        shell_escape(remote_path),
        tmp_bin,
        tmp_b64,
    );

    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("sudo upload failed: {}", e))?;
    if result.exit_code != 0 {
        let stderr = result.stderr.trim();
        // Filter out sudo password prompt noise
        let clean_err = stderr.lines()
            .filter(|l| !l.contains("[sudo]") && !l.contains("password for"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("sudo tee failed (exit {}): {}", result.exit_code, clean_err));
    }
    Ok(())
}

/// Recursively delete a directory tree via SFTP.
async fn remove_dir_recursive(sftp: &SftpSession, path: &str) -> Result<(), String> {
    let entries = sftp
        .read_dir(path)
        .await
        .map_err(|e| format!("Failed to read directory '{}': {}", path, e))?;

    for entry in entries {
        let child = entry.path();
        let meta = entry.metadata();
        if meta.is_dir() {
            Box::pin(remove_dir_recursive(sftp, &child)).await?;
        } else {
            sftp.remove_file(&child)
                .await
                .map_err(|e| format!("Failed to remove file '{}': {}", child, e))?;
        }
    }

    sftp.remove_dir(path)
        .await
        .map_err(|e| format!("Failed to remove directory '{}': {}", path, e))?;

    Ok(())
}

/// Delete a file or directory via SFTP.
/// Falls back to `sudo rm` via SSH exec if SFTP fails due to permissions.
pub async fn delete_file(
    session: &Arc<SshSession>,
    remote_path: &str,
    recursive: bool,
    sudo_password: Option<&str>,
) -> Result<(), String> {
    // Try SFTP first
    let result = delete_file_sftp(session, remote_path, recursive).await;
    match result {
        Ok(()) => return Ok(()),
        Err(e) if sudo_password.is_some() => {
            tracing::info!("SFTP delete failed ({}), trying sudo rm for '{}'", e, remote_path);
        }
        Err(e) => return Err(e),
    }
    sudo_rm(session, remote_path, recursive, sudo_password.unwrap()).await
}

/// SFTP delete (no sudo fallback)
async fn delete_file_sftp(session: &Arc<SshSession>, remote_path: &str, recursive: bool) -> Result<(), String> {
    let sftp = open_sftp(session).await?;
    let abs_path = sftp
        .canonicalize(remote_path)
        .await
        .map_err(|e| format!("Failed to canonicalize '{}': {}", remote_path, e))?;
    let meta = sftp
        .metadata(&abs_path)
        .await
        .map_err(|e| format!("Failed to stat '{}': {}", abs_path, e))?;
    if meta.is_dir() && recursive {
        remove_dir_recursive(&sftp, &abs_path).await?;
    } else if meta.is_dir() {
        sftp.remove_dir(&abs_path)
            .await
            .map_err(|e| format!("Failed to remove directory '{}': {}", abs_path, e))?;
    } else {
        sftp.remove_file(&abs_path)
            .await
            .map_err(|e| format!("Failed to remove file '{}': {}", abs_path, e))?;
    }
    Ok(())
}

/// Delete via `sudo rm -rf` or `sudo rm -f`.
async fn sudo_rm(
    session: &Arc<SshSession>,
    remote_path: &str,
    recursive: bool,
    sudo_password: &str,
) -> Result<(), String> {
    let flag = if recursive { "-rf" } else { "-f" };
    let cmd = format!(
        "echo {} | sudo -S rm {} {} 2>&1",
        shell_escape(sudo_password),
        flag,
        shell_escape(remote_path),
    );
    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("sudo rm failed: {}", e))?;
    if result.exit_code != 0 {
        let stderr = result.stderr.trim();
        let clean_err = stderr.lines()
            .filter(|l| !l.contains("[sudo]") && !l.contains("password for"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("sudo rm failed (exit {}): {}", result.exit_code, clean_err));
    }
    Ok(())
}

/// Create a directory via SFTP.
/// Falls back to `sudo mkdir` via SSH exec if SFTP fails due to permissions.
pub async fn create_dir(
    session: &Arc<SshSession>,
    remote_path: &str,
    sudo_password: Option<&str>,
) -> Result<(), String> {
    let sftp = open_sftp(session).await;
    match sftp {
        Ok(sftp) => {
            let result = sftp.create_dir(remote_path).await;
            match result {
                Ok(()) => return Ok(()),
                Err(e) if sudo_password.is_some() => {
                    tracing::info!("SFTP mkdir failed ({}), trying sudo mkdir for '{}'", e, remote_path);
                }
                Err(e) => return Err(format!("Failed to create directory '{}': {}", remote_path, e)),
            }
        }
        Err(e) if sudo_password.is_some() => {
            tracing::info!("SFTP open failed ({}), trying sudo mkdir for '{}'", e, remote_path);
        }
        Err(e) => return Err(format!("Failed to open SFTP session: {}", e)),
    }
    sudo_mkdir(session, remote_path, sudo_password.unwrap()).await
}

/// Create directory via `sudo mkdir -p`.
async fn sudo_mkdir(
    session: &Arc<SshSession>,
    remote_path: &str,
    sudo_password: &str,
) -> Result<(), String> {
    let cmd = format!(
        "echo {} | sudo -S mkdir -p {} 2>&1",
        shell_escape(sudo_password),
        shell_escape(remote_path),
    );
    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("sudo mkdir failed: {}", e))?;
    if result.exit_code != 0 {
        let stderr = result.stderr.trim();
        let clean_err = stderr.lines()
            .filter(|l| !l.contains("[sudo]") && !l.contains("password for"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("sudo mkdir failed (exit {}): {}", result.exit_code, clean_err));
    }
    Ok(())
}

/// Rename (move) a file/directory via SFTP.
/// Falls back to `sudo mv` via SSH exec if SFTP fails due to permissions.
pub async fn rename(
    session: &Arc<SshSession>,
    from: &str,
    to: &str,
    sudo_password: Option<&str>,
) -> Result<(), String> {
    let sftp = open_sftp(session).await;
    match sftp {
        Ok(sftp) => {
            let result = sftp.rename(from, to).await;
            match result {
                Ok(()) => return Ok(()),
                Err(e) if sudo_password.is_some() => {
                    tracing::info!("SFTP rename failed ({}), trying sudo mv '{}' -> '{}'", e, from, to);
                }
                Err(e) => return Err(format!("Failed to rename '{}' to '{}': {}", from, to, e)),
            }
        }
        Err(e) if sudo_password.is_some() => {
            tracing::info!("SFTP open failed ({}), trying sudo mv '{}' -> '{}'", e, from, to);
        }
        Err(e) => return Err(format!("Failed to open SFTP session: {}", e)),
    }
    sudo_mv(session, from, to, sudo_password.unwrap()).await
}

/// Rename/move via `sudo mv`.
async fn sudo_mv(
    session: &Arc<SshSession>,
    from: &str,
    to: &str,
    sudo_password: &str,
) -> Result<(), String> {
    let cmd = format!(
        "echo {} | sudo -S mv {} {} 2>&1",
        shell_escape(sudo_password),
        shell_escape(from),
        shell_escape(to),
    );
    let result = crate::ssh::executor::execute_command(session, &cmd).await
        .map_err(|e| format!("sudo mv failed: {}", e))?;
    if result.exit_code != 0 {
        let stderr = result.stderr.trim();
        let clean_err = stderr.lines()
            .filter(|l| !l.contains("[sudo]") && !l.contains("password for"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("sudo mv failed (exit {}): {}", result.exit_code, clean_err));
    }
    Ok(())
}

/// Get file metadata (stat) via SFTP.
pub async fn stat(session: &Arc<SshSession>, remote_path: &str) -> Result<FileEntry, String> {
    let sftp = open_sftp(session).await?;
    let abs_path = sftp
        .canonicalize(remote_path)
        .await
        .map_err(|e| format!("Failed to canonicalize '{}': {}", remote_path, e))?;

    let metadata = sftp
        .metadata(&abs_path)
        .await
        .map_err(|e| format!("Failed to stat '{}': {}", abs_path, e))?;

    let name = abs_path.rsplit('/').next().unwrap_or(&abs_path).to_string();

    Ok(attrs_to_entry(name, &abs_path, &metadata))
}

/// Set file permissions via SSH exec (chmod command).
/// Falls back to `sudo chmod` if the first attempt fails due to permissions.
pub async fn chmod_via_ssh(
    session: &Arc<SshSession>,
    remote_path: &str,
    permissions: u32,
    sudo_password: Option<&str>,
) -> Result<(), String> {
    let octal = format!("{:04}", permissions & 0o7777);
    let cmd = format!("chmod {} {}", octal, shell_escape(remote_path));
    let result = crate::ssh::executor::execute_command(session, &cmd)
        .await
        .map_err(|e| format!("chmod failed: {}", e))?;
    if result.exit_code == 0 {
        return Ok(());
    }
    // Fallback to sudo chmod
    if let Some(pwd) = sudo_password {
        tracing::info!("chmod failed ({}), trying sudo chmod for '{}'", result.stderr.trim(), remote_path);
        let sudo_cmd = format!(
            "echo {} | sudo -S chmod {} {} 2>&1",
            shell_escape(pwd),
            octal,
            shell_escape(remote_path),
        );
        let sudo_result = crate::ssh::executor::execute_command(session, &sudo_cmd).await
            .map_err(|e| format!("sudo chmod failed: {}", e))?;
        if sudo_result.exit_code == 0 {
            return Ok(());
        }
        let stderr = sudo_result.stderr.trim();
        let clean_err = stderr.lines()
            .filter(|l| !l.contains("[sudo]") && !l.contains("password for"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(format!("sudo chmod failed (exit {}): {}", sudo_result.exit_code, clean_err));
    }
    Err(format!("chmod exited with code {}: {}", result.exit_code, result.stderr))
}

/// Escape a path for safe use in shell commands.
fn shell_escape(path: &str) -> String {
    // Wrap in single quotes, escaping any embedded single quotes
    let escaped = path.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// Check if an SFTP error is likely a permission issue.
fn is_permission_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    lower.contains("permission denied")
        || lower.contains("permission")
        || lower.contains("access denied")
        || lower.contains("failure")
        || lower.contains("ssh_fx_permission")
}

#[cfg(test)]
#[allow(clippy::needless_update)]
mod tests {
    use super::*;
    use russh_sftp::protocol::FileAttributes;

    #[test]
    fn test_attrs_to_entry_regular_file() {
        let attrs = FileAttributes {
            permissions: Some(0o100644), // regular file, rw-r--r--
            size: Some(1024),
            mtime: Some(1705314600),
            ..FileAttributes::default()
        };

        let entry = attrs_to_entry("test.txt".into(), "/home/user", &attrs);
        assert_eq!(entry.name, "test.txt");
        assert_eq!(entry.r#type, "file");
        assert_eq!(entry.size, 1024);
        assert_eq!(entry.permissions, "644");
        assert_eq!(entry.modify_time, 1705314600);
        assert!(entry.target_type.is_none());
        assert!(entry.link_target.is_none());
    }

    #[test]
    fn test_attrs_to_entry_directory() {
        // Directory: S_IFDIR = 0o040000, permissions 0o40755
        let attrs = FileAttributes {
            permissions: Some(0o40755),
            size: Some(4096),
            ..FileAttributes::default()
        };

        let entry = attrs_to_entry("subdir".into(), "/home/user", &attrs);
        assert_eq!(entry.name, "subdir");
        assert_eq!(entry.r#type, "directory");
        assert_eq!(entry.permissions, "755");
    }

    #[test]
    fn test_attrs_to_entry_symlink() {
        // Symlink: S_IFLNK = 0o120000, permissions 0o120777
        let attrs = FileAttributes {
            permissions: Some(0o120777),
            size: Some(0),
            mtime: Some(1705314600),
            ..FileAttributes::default()
        };

        let entry = attrs_to_entry("link".into(), "/usr/bin", &attrs);
        assert_eq!(entry.name, "link");
        assert_eq!(entry.r#type, "symlink");
        assert_eq!(entry.permissions, "777");
    }

    #[test]
    fn test_attrs_to_entry_no_permissions() {
        let attrs = FileAttributes { permissions: Some(0), size: Some(0), ..FileAttributes::default() };

        let entry = attrs_to_entry("unknown".into(), "/tmp", &attrs);
        assert_eq!(entry.r#type, "file");
        assert_eq!(entry.permissions, "0");
        assert_eq!(entry.size, 0);
    }

    #[test]
    fn test_attrs_to_entry_path_construction() {
        let attrs = FileAttributes::default();
        let entry = attrs_to_entry("file.txt".into(), "/root", &attrs);
        assert_eq!(entry.path, "/root/file.txt");
    }

    #[test]
    fn test_attrs_to_entry_path_with_trailing_slash() {
        let attrs = FileAttributes::default();
        let entry = attrs_to_entry("file.txt".into(), "/root/", &attrs);
        assert_eq!(entry.path, "/root/file.txt");
    }

    #[test]
    fn test_file_type_from_permissions() {
        assert_eq!(file_type_from_permissions(Some(0o100644)), "file");
        assert_eq!(file_type_from_permissions(Some(0o40755)), "directory");
        assert_eq!(file_type_from_permissions(Some(0o120777)), "symlink");
        assert_eq!(file_type_from_permissions(Some(0o060644)), "block_device");
        assert_eq!(file_type_from_permissions(Some(0o020644)), "char_device");
        assert_eq!(file_type_from_permissions(Some(0o010644)), "fifo");
        assert_eq!(file_type_from_permissions(Some(0o140644)), "socket");
        assert_eq!(file_type_from_permissions(None), "file");
    }

    #[test]
    fn test_attrs_to_entry_owner_group() {
        let attrs = FileAttributes {
            permissions: Some(0o100644),
            size: Some(256),
            user: Some("root".to_string()),
            group: Some("admin".to_string()),
            ..FileAttributes::default()
        };
        let entry = attrs_to_entry("owned.txt".into(), "/home/user", &attrs);
        assert_eq!(entry.owner, "root");
        assert_eq!(entry.group, "admin");
    }

    #[test]
    fn test_attrs_to_entry_owner_group_defaults() {
        let attrs = FileAttributes {
            permissions: Some(0o100644),
            size: Some(128),
            ..FileAttributes::default()
        };
        let entry = attrs_to_entry("noowner.txt".into(), "/tmp", &attrs);
        assert_eq!(entry.owner, "");
        assert_eq!(entry.group, "");
    }
}
