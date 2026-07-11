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

    // Resolve symlink targets in batch — stat each symlink to get resolved type
    for entry in &mut entries {
        if entry.r#type == "symlink" {
            // First try canonicalize (resolves relative symlinks)
            if let Ok(resolved) = sftp.canonicalize(&entry.path).await {
                if let Ok(meta) = sftp.metadata(&resolved).await {
                    entry.target_type = Some(file_type_from_permissions(meta.permissions));
                    entry.link_target = Some(resolved);
                    // Also update size to reflect target size
                    entry.size = meta.size.unwrap_or(0) as i64;
                    let perm_str = meta
                        .permissions
                        .map(|p| format!("{:o}", p & 0o7777))
                        .unwrap_or_else(|| "----".to_string());
                    entry.permissions = perm_str;
                } else {
                    // canonicalize worked but metadata failed — broken symlink
                    entry.target_type = Some("broken".to_string());
                    entry.link_target = Some(resolved);
                }
            } else {
                // canonicalize failed — try metadata on the path directly
                // (russh-sftp metadata follows symlinks by default)
                if let Ok(meta) = sftp.metadata(&entry.path).await {
                    let resolved_type = file_type_from_permissions(meta.permissions);
                    // If it resolved to something other than "symlink", it's a followable link
                    if resolved_type != "symlink" {
                        entry.target_type = Some(resolved_type);
                        entry.link_target = Some(entry.path.clone());
                        entry.size = meta.size.unwrap_or(0) as i64;
                        let perm_str = meta
                            .permissions
                            .map(|p| format!("{:o}", p & 0o7777))
                            .unwrap_or_else(|| "----".to_string());
                        entry.permissions = perm_str;
                    } else {
                        entry.target_type = Some("broken".to_string());
                    }
                }
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

    let mut file = sftp
        .open(&abs_path)
        .await
        .map_err(|e| format!("Failed to open remote file '{}': {}", abs_path, e))?;

    let mut data = Vec::new();
    file.read_to_end(&mut data)
        .await
        .map_err(|e| format!("Failed to read remote file '{}': {}", abs_path, e))?;

    Ok(data)
}

/// Upload a file via SFTP.
pub async fn upload_file(session: &Arc<SshSession>, remote_path: &str, data: Vec<u8>) -> Result<(), String> {
    let sftp = open_sftp(session).await?;

    let mut file = sftp
        .open_with_flags(remote_path, OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE)
        .await
        .map_err(|e| format!("Failed to open remote file for writing '{}': {}", remote_path, e))?;

    file.write_all(&data)
        .await
        .map_err(|e| format!("Failed to write to remote file '{}': {}", remote_path, e))?;

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush remote file '{}': {}", remote_path, e))?;

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
pub async fn delete_file(session: &Arc<SshSession>, remote_path: &str, recursive: bool) -> Result<(), String> {
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

    // Clear SFTP cache on error to force re-create next time
    Ok(())
}

/// Create a directory via SFTP.
pub async fn create_dir(session: &Arc<SshSession>, remote_path: &str) -> Result<(), String> {
    let sftp = open_sftp(session).await?;
    sftp.create_dir(remote_path)
        .await
        .map_err(|e| format!("Failed to create directory '{}': {}", remote_path, e))?;
    Ok(())
}

/// Rename (move) a file/directory via SFTP.
pub async fn rename(session: &Arc<SshSession>, from: &str, to: &str) -> Result<(), String> {
    let sftp = open_sftp(session).await?;
    sftp.rename(from, to)
        .await
        .map_err(|e| format!("Failed to rename '{}' to '{}': {}", from, to, e))?;
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
/// More reliable than SFTP setstat across different SSH server configurations.
pub async fn chmod_via_ssh(
    session: &Arc<SshSession>,
    remote_path: &str,
    permissions: u32,
) -> Result<(), String> {
    // Convert numeric permissions to octal string (e.g., 493 → "755")
    let octal = format!("{:04}", permissions & 0o7777);
    let cmd = format!("chmod {} {}", octal, shell_escape(remote_path));
    let result = crate::ssh::executor::execute_command(session, &cmd)
        .await
        .map_err(|e| format!("chmod failed: {}", e))?;
    if result.exit_code != 0 {
        return Err(format!("chmod exited with code {}: {}", result.exit_code, result.stderr));
    }
    Ok(())
}

/// Escape a path for safe use in shell commands.
fn shell_escape(path: &str) -> String {
    // Wrap in single quotes, escaping any embedded single quotes
    let escaped = path.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

#[cfg(test)]
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
