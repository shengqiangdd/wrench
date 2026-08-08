use std::path::{Path, PathBuf};

/// Validate and sanitize a file path to prevent path traversal attacks.
///
/// Returns `Some(PathBuf)` if the path is safe (resolves inside `root`),
/// or `None` if path traversal is detected.
pub fn safe_path(root: &Path, user_path: &str) -> Option<PathBuf> {
    // Reject absolute paths
    let cleaned = user_path.trim_start_matches('/').trim_start_matches('\\');

    // Normalize the path
    let resolved = root.join(cleaned);

    // Canonicalize to resolve any ../ components
    let canonical = resolved.canonicalize().ok()?;

    // Check the path is within root
    if canonical.starts_with(root) {
        Some(canonical)
    } else {
        None
    }
}

/// Check if a filename contains path traversal characters.
pub fn is_safe_filename(name: &str) -> bool {
    !name.contains("..") && !name.contains('/') && !name.contains('\\') && !name.is_empty()
}

/// Sanitize a plugin ID to prevent path traversal.
/// Allows only alphanumeric, dash, underscore, and dot.
pub fn sanitize_plugin_id(id: &str) -> Option<String> {
    let sanitized: String = id
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .collect();

    if sanitized.is_empty() || sanitized != id {
        return None;
    }
    Some(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_safe_path_within_root() {
        let root = Path::new("/tmp/testroot");
        std::fs::create_dir_all(root.join("subdir")).ok();
        let result = safe_path(root, "subdir");
        assert!(result.is_some());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_path_traversal_rejected() {
        let root = Path::new("/tmp/testroot2");
        std::fs::create_dir_all(root).ok();
        let result = safe_path(root, "../../etc/passwd");
        assert!(result.is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_sanitize_plugin_id() {
        assert_eq!(sanitize_plugin_id("my-plugin_v2").unwrap(), "my-plugin_v2");
        assert!(sanitize_plugin_id("../../etc").is_none());
        assert!(sanitize_plugin_id("").is_none());
    }
}
