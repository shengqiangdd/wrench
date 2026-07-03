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

use axum::{extract::State, extract::Path, Json};
use base64::Engine;
use sha2::{Sha256, Digest};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::db::VaultEntry;
use crate::error::AppError;
use crate::response::ApiResponse;
use crate::utils::crypto;

const SUPPORTED_KINDS: &[&str] = &["ssh_key", "api_key", "password", "note"];

/// Get supported vault entry types (GET /api/vault/types)
pub async fn get_vault_types() -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({
        "types": SUPPORTED_KINDS.iter().map(|k| serde_json::json!({
            "id": k,
            "label": match *k {
                "ssh_key" => "SSH Key",
                "api_key" => "API Key",
                "password" => "Password",
                "note" => "Note",
                _ => k,
            },
            "icon": match *k {
                "ssh_key" => "terminal",
                "api_key" => "key",
                "password" => "lock",
                "note" => "file-text",
                _ => "folder",
            }
        })).collect::<Vec<_>>()
    }))
}

/// List all vault entries (GET /api/vault)
pub async fn list_vault_entries(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let db = state.db.as_ref().ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let entries = db.list_vault_entries().await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    let decrypted: Vec<serde_json::Value> = entries
        .iter()
        .map(|e| {
            let decrypted = crypto::decrypt(&e.encrypted_value, &vault_key).unwrap_or_else(|_| "***DECRYPT_FAILED***".into());
            let tags: Vec<String> = serde_json::from_str(&e.tags).unwrap_or_default();
            serde_json::json!({
                "id": e.id,
                "name": e.name,
                "kind": e.kind,
                "value": decrypted,
                "tags": tags,
                "createdAt": e.created_at,
                "updatedAt": e.updated_at,
            })
        })
        .collect();

    Ok(ApiResponse::success(serde_json::json!(decrypted)))
}

/// Create a vault entry (POST /api/vault)
pub async fn create_vault_entry(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let db = state.db.as_ref().ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let kind = body.get("kind").and_then(|v| v.as_str()).unwrap_or("password").to_string();
    let value = body.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let tags: Vec<String> = body.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if name.is_empty() || value.is_empty() {
        return Err(AppError::BadRequest("name and value are required".into()));
    }
    if !SUPPORTED_KINDS.contains(&kind.as_str()) {
        return Err(AppError::BadRequest(format!("unsupported kind: {}. Supported: {:?}", kind, SUPPORTED_KINDS)));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let encrypted = crypto::encrypt(&value, &vault_key)
        .map_err(|e| AppError::Internal(format!("Encryption error: {}", e)))?;
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());

    let entry = VaultEntry {
        id: id.clone(),
        name,
        kind,
        encrypted_value: encrypted,
        tags: tags_json,
        created_at: now.clone(),
        updated_at: now,
    };

    db.insert_vault_entry(&entry).await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(serde_json::json!({
        "id": id,
        "message": "Vault entry created"
    })))
}

/// Update a vault entry (PUT /api/vault/:id)
pub async fn update_vault_entry(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let db = state.db.as_ref().ok_or_else(|| AppError::NotFound("Database not available".into()))?;
    let vault_key = get_vault_key(&state)?;

    let existing = db.get_vault_entry(&entry_id).await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?
        .ok_or_else(|| AppError::NotFound("Vault entry not found".into()))?;

    let name = body.get("name").and_then(|v| v.as_str()).map(String::from).unwrap_or(existing.name);
    let kind = body.get("kind").and_then(|v| v.as_str()).map(String::from).unwrap_or(existing.kind);
    let tags: Vec<String> = body.get("tags")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_else(|| serde_json::from_str(&existing.tags).unwrap_or_default());

    let encrypted_value = if let Some(value) = body.get("value").and_then(|v| v.as_str()) {
        if !value.is_empty() {
            crypto::encrypt(value, &vault_key)
                .map_err(|e| AppError::Internal(format!("Encryption error: {}", e)))?
        } else {
            existing.encrypted_value
        }
    } else {
        existing.encrypted_value
    };

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());

    let entry = VaultEntry {
        id: entry_id,
        name,
        kind,
        encrypted_value,
        tags: tags_json,
        created_at: existing.created_at,
        updated_at: now,
    };

    db.update_vault_entry(&entry).await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(serde_json::json!({ "message": "Vault entry updated" })))
}

/// Delete a vault entry (DELETE /api/vault/:id)
pub async fn delete_vault_entry(
    State(state): State<Arc<AppState>>,
    Path(entry_id): Path<String>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let db = state.db.as_ref().ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let deleted = db.delete_vault_entry(&entry_id).await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    if !deleted {
        return Err(AppError::NotFound("Vault entry not found".into()));
    }

    Ok(ApiResponse::success(serde_json::json!({ "message": "Vault entry deleted" })))
}

/// Derive the vault encryption key from config.
fn get_vault_key(state: &AppState) -> Result<[u8; 32], AppError> {
    // Use VAULT_KEY if explicitly set, else derive from JWT_SECRET
    if let Some(ref vk) = state.config.vault_key {
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(vk)
            .map_err(|e| AppError::Internal(format!("Invalid VAULT_KEY (not base64): {}", e)))?;
        if decoded.len() != 32 {
            return Err(AppError::Internal("VAULT_KEY must be 32 bytes (base64)".into()));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    // Derive from JWT_SECRET via SHA-256
    let jwt = state.config.jwt_secret.as_bytes();
    let mut hasher = Sha256::new();
    hasher.update(jwt);
    let result = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&result);
    Ok(key)
}
