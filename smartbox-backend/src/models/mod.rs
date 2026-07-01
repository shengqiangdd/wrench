use serde::{Deserialize, Serialize};

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
    pub commands: Vec<String>,
    pub panels: Vec<String>,
}
