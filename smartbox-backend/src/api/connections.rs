//! `api/connections.rs` — SSH connection persistence API
//!
//! CRUD endpoints for saving/loading SSH connection configs via SQLite.
//! Integrates with the Secret Vault: `auth_type = "vault_ref"` stores a
//! vault entry ID in `config.vault_entry_id` for encrypted credential retrieval.

use crate::app_state::AppState;
use crate::db::SshConnection;
use crate::error::AppError;
use crate::response::ApiResponse;
use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// JSON body for creating/updating an SSH connection.
#[derive(Debug, Deserialize)]
pub struct UpsertConnectionRequest {
    pub id: Option<String>, // omit or null for new; provide to update
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_username")]
    pub username: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default)]
    pub config: String, // JSON string
    #[serde(default)]
    pub sort_order: i32,
}

fn default_port() -> u16 {
    22
}
fn default_username() -> String {
    "root".to_string()
}
fn default_auth_type() -> String {
    "password".to_string()
}

/// JSON response body for a connection.
#[derive(Debug, Serialize)]
pub struct ConnectionResponse {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,
    pub config: String,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

impl From<SshConnection> for ConnectionResponse {
    fn from(c: SshConnection) -> Self {
        Self {
            id: c.id,
            name: c.name,
            host: c.host,
            port: c.port,
            username: c.username,
            auth_type: c.auth_type,
            config: c.config,
            sort_order: c.sort_order,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// GET /api/connections — list all saved connections
pub async fn list_connections(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<ConnectionResponse>>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let conns = db
        .list_ssh_connections()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let resp: Vec<ConnectionResponse> = conns.into_iter().map(Into::into).collect();
    Ok(Json(ApiResponse::success(resp)))
}

/// POST /api/connections — create or update a connection
pub async fn upsert_connection(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<UpsertConnectionRequest>,
) -> Result<Json<ApiResponse<ConnectionResponse>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = payload.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let conn = SshConnection {
        id,
        name: payload.name,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        auth_type: payload.auth_type,
        config: payload.config,
        sort_order: payload.sort_order,
        created_at: now.clone(),
        updated_at: now,
    };

    db.upsert_ssh_connection(&conn)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let saved = db
        .list_ssh_connections()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .into_iter()
        .find(|c| c.id == conn.id)
        .ok_or_else(|| AppError::Internal("Failed to verify saved connection".into()))?;

    Ok(Json(ApiResponse::success(saved.into())))
}

/// DELETE /api/connections/:id — delete a connection
pub async fn delete_connection(
    State(state): State<Arc<AppState>>,
    Path(connection_id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let deleted = db
        .delete_ssh_connection(&connection_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if !deleted {
        return Err(AppError::NotFound("Connection not found".into()));
    }
    Ok(Json(ApiResponse::success(true)))
}
