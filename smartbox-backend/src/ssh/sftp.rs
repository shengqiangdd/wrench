use serde::Serialize;

/// SFTP file entry
#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: i64,
    pub permissions: String,
    pub modified: String,
}

/// List directory contents via SFTP.
/// In a full implementation, this uses russh's SFTP subsystem.
pub async fn list_directory(
    _connection_id: &str,
    _path: &str,
) -> Result<Vec<FileEntry>, String> {
    // TODO: Implement using russh SFTP
    Ok(Vec::new())
}

/// Download a file via SFTP.
pub async fn download_file(
    _connection_id: &str,
    _remote_path: &str,
) -> Result<Vec<u8>, String> {
    // TODO: Implement using russh SFTP
    Ok(Vec::new())
}

/// Upload a file via SFTP.
pub async fn upload_file(
    _connection_id: &str,
    _remote_path: &str,
    _data: Vec<u8>,
) -> Result<(), String> {
    // TODO: Implement using russh SFTP
    Ok(())
}

/// Delete a file or directory via SFTP.
pub async fn delete_file(
    _connection_id: &str,
    _path: &str,
    _recursive: bool,
) -> Result<(), String> {
    // TODO: Implement
    Ok(())
}
