use serde::{Deserialize, Serialize};

// ─── SFTP 类型：用于 WebSocket SFTP 操作 ───

/// WebSocket SFTP 请求参数（统一解析所有 operation 的公共字段）
#[derive(Debug, Deserialize)]
pub struct SftpRequest {
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    pub operation: String,
    pub path: Option<String>,
    pub target: Option<String>,
    /// Base64 编码的文件内容（writefile 用）
    pub content: Option<String>,
}

/// SFTP 响应（统一信封 + 操作级负载字段）
#[derive(Debug, Default, Serialize)]
pub struct SftpResponse {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub operation: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<crate::ssh::sftp::FileEntry>>,
    /// Base64 编码的文件内容（readfile 用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permissions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SftpResponse {
    /// 创建一个成功的 SFTP 响应外壳
    pub fn success(operation: &str) -> Self {
        Self {
            msg_type: "sftp-result".into(),
            operation: operation.into(),
            success: true,
            files: None,
            content: None,
            size: None,
            is_dir: None,
            permissions: None,
            modified: None,
            error: None,
        }
    }

    /// 创建一个失败的 SFTP 响应外壳
    pub fn error(operation: &str, msg: impl Into<String>) -> Self {
        Self {
            msg_type: "sftp-result".into(),
            operation: operation.into(),
            success: false,
            error: Some(msg.into()),
            files: None,
            content: None,
            size: None,
            is_dir: None,
            permissions: None,
            modified: None,
        }
    }

    /// 设置 files 列表（list 操作）
    pub fn with_files(mut self, files: Vec<crate::ssh::sftp::FileEntry>) -> Self {
        self.files = Some(files);
        self
    }

    /// 设置文件读取结果（readfile 操作）
    pub fn with_content(mut self, content: String, size: u64) -> Self {
        self.content = Some(content);
        self.size = Some(size);
        self
    }

    /// 设置 stat 结果
    pub fn with_stat(mut self, entry: &crate::ssh::sftp::FileEntry) -> Self {
        self.size = Some(entry.size as u64);
        self.is_dir = Some(entry.r#type == "directory");
        self.permissions = Some(entry.permissions.clone());
        self.modified = Some(chrono::DateTime::from_timestamp(entry.modify_time, 0)
            .unwrap_or_default()
            .format("%Y-%m-%d %H:%M:%S")
            .to_string());
        self
    }
}

/// Host configuration model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Host {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: AuthType,
    pub group: String,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthType {
    Password,
    Key,
}

/// Script template model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub id: String,
    pub name: String,
    pub command: String,
    pub group: String,
    pub description: String,
    pub is_favorite: bool,
    pub created_at: String,
}

/// Plugin manifest model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon: String,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
    #[serde(default)]
    pub panels: Vec<PluginPanel>,
}

/// 插件命令定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCommand {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
}

/// 插件面板定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPanel {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub icon: String,
}
