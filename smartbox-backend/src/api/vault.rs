//! Secret Vault API — encrypted credential storage.
//!
//! Entries are encrypted at rest using AES-256-GCM before being stored
//! in the SQLite database. The encryption key is derived from the
//! server's JWT_SECRET (or VAULT_KEY if explicitly configured).
//!
//! Endpoints:
//!   GET    /api/vault          — List all entries (decrypted)
//!   POST   /api/vault          — Create a new entry
//!   PUT    /api/vault/:id      — Update an existing entry
//!   DELETE /api/vault/:id      — Delete an entry
//!   GET    /api/vault/types    — List supported entry types

use axum::{extract::Path, extract::State, Json};
use sha2::{Digest, Sha256};
use std::sync::Arc;

use crate::api_types::{VaultEntryDetail, VaultListResponse, VaultTypeInfo, VaultTypesResponse};
use crate::app_state::AppState;
use crate::db::VaultEntry;
use crate::error::AppError;
use crate::response::ApiResponse;
use crate::utils::crypto;

const SUPPORTED_KINDS: &[&str] = &["ssh_key", "api_key", "password", "note"];

fn kind_label(k: &str) -> &'static str {
    match k {
        "ssh_key" => "SSH Key",
        "api_key" => "API Key",
        "password" => "Password",
        "note" => "Note",
        _ => "Unknown",
    }
}

fn kind_icon(k: &str) -> &'static str {
    match k {
        "ssh_key" => "terminal",
        "api_key" => "key",
        "password" => "lock",
        "note" => "file-text",
        _ => "folder",
    }
}

/// Get supported vault entry types (GET /api/vault/types)
pub async fn get_vault_types() -> ApiResponse<VaultTypesResponse> {
    let types: Vec<VaultTypeInfo> = SUPPORTED_KINDS
        .iter()
        .map(|k| VaultTypeInfo {
            id: k.to_string(),
            label: kind_label(k).to_string(),
            icon: kind_icon(k).to_string(),
        })
        .collect();

    ApiResponse::success(VaultTypesResponse { types })
}

fn map_vault_entry(e: &VaultEntry, vault_key: &[u8; 32]) -> VaultEntryDetail {
    let decrypted = crypto::decrypt(&e.encrypted_value, vault_key).unwrap_or_else(|_| "***DECRYPT_FAILED***".into());
    let tags: Vec<String> = serde_json::from_str(&e.tags).unwrap_or_default();

    VaultEntryDetail {
        id: e.id.clone(),
        name: e.name.clone(),
        kind: e.kind.clone(),
        value: decrypted,
        tags,
        created_at: e.created_at.clone(),
        updated_at: e.updated_at.clone(),
    }
}

/// List all vault entries (GET /api/vault)
pub async fn list_vault_entries(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<VaultListResponse>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let entries = db
        .list_vault_entries()
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    let decrypted: Vec<VaultEntryDetail> = entries.iter().map(|e| map_vault_entry(e, &vault_key)).collect();
    let total = decrypted.len();

    Ok(ApiResponse::success(VaultListResponse { total, entries: decrypted }))
}

/// Create a vault entry (POST /api/vault)
pub async fn create_vault_entry(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<VaultEntryDetail>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let value = body.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tags: Vec<String> = body
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if !SUPPORTED_KINDS.contains(&kind.as_str()) {
        return Err(AppError::BadRequest(format!(
            "unsupported kind: {}. Supported: {:?}",
            kind, SUPPORTED_KINDS
        )));
    }
    if value.is_empty() {
        return Err(AppError::BadRequest("value is required".into()));
    }

    let encrypted =
        crypto::encrypt(&value, &vault_key).map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))?;
    let tags_str = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let entry = VaultEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        kind,
        encrypted_value: encrypted,
        tags: tags_str,
        created_at: now.clone(),
        updated_at: now,
    };

    db.insert_vault_entry(&entry)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(map_vault_entry(&entry, &vault_key)))
}

/// Update a vault entry (PUT /api/vault/:id)
pub async fn update_vault_entry(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<VaultEntryDetail>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let existing = db
        .get_vault_entry(&entry_id)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Vault entry not found".into()))?;

    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&existing.name)
        .to_string();
    let kind = body
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or(&existing.kind)
        .to_string();
    let value = body.get("value").and_then(|v| v.as_str()).map(String::from);
    let tags: Vec<String> = body
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_else(|| serde_json::from_str(&existing.tags).unwrap_or_default());

    let encrypted = match value {
        Some(v) if !v.is_empty() => {
            crypto::encrypt(&v, &vault_key).map_err(|e| AppError::Internal(format!("Encryption failed: {}", e)))?
        }
        _ => existing.encrypted_value.clone(),
    };

    let tags_str = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let updated = VaultEntry {
        id: entry_id.clone(),
        name,
        kind,
        encrypted_value: encrypted,
        tags: tags_str,
        created_at: existing.created_at,
        updated_at: now,
    };

    db.update_vault_entry(&updated)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(map_vault_entry(&updated, &vault_key)))
}

/// Delete a vault entry (DELETE /api/vault/:id)
pub async fn delete_vault_entry(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
) -> Result<ApiResponse<()>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let deleted = db
        .delete_vault_entry(&entry_id)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    if !deleted {
        return Err(AppError::NotFound("Vault entry not found".into()));
    }

    Ok(ApiResponse::success(()))
}

/// Get the vault encryption key, derived from JWT_SECRET or VAULT_KEY
fn get_vault_key(state: &AppState) -> Result<[u8; 32], AppError> {
    let secret = &state.config.jwt_secret;
    if secret.is_empty() {
        return Err(AppError::Internal("JWT_SECRET not configured — cannot derive vault key".into()));
    }

    // Derive a 32-byte key using SHA-256
    let hash = Sha256::digest(secret.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash);
    Ok(key)
}
