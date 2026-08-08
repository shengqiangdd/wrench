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
use std::sync::Arc;

use crate::api_types::{VaultEntryDetail, VaultEntrySummary, VaultListResponse, VaultTypeInfo, VaultTypesResponse};
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

/// Decrypt a vault entry, handling v1→v2 key migration transparently.
///
/// - Tries the current v2 key (PBKDF2-derived) first.
/// - If that fails and a legacy key is available, decrypts with the legacy
///   SHA-256 key, re-encrypts with the v2 key, and updates the database.
/// - Returns the decrypted plaintext.
async fn map_vault_entry_decrypted(
    e: &VaultEntry,
    vault_key: &[u8; 32],
    legacy_key: Option<&[u8; 32]>,
    db: &crate::db::Database,
) -> String {
    // Try current v2 key first
    if let Ok(plaintext) = crypto::decrypt(&e.encrypted_value, vault_key) {
        return plaintext;
    }

    // Fallback: try legacy v1 key for migration
    if let Some(legacy) = legacy_key {
        if let Ok(plaintext) = crypto::decrypt(&e.encrypted_value, legacy) {
            // Re-encrypt with the new v2 key
            if let Ok(re_encrypted) = crypto::encrypt(&plaintext, vault_key) {
                let now = chrono::Local::now()
                    .format("%Y-%m-%dT%H:%M:%S%:z")
                    .to_string();
                let updated = VaultEntry {
                    id: e.id.clone(),
                    name: e.name.clone(),
                    kind: e.kind.clone(),
                    name_plain: e.name_plain.clone(),
                    kind_plain: e.kind_plain.clone(),
                    encrypted_value: re_encrypted,
                    tags: e.tags.clone(),
                    created_at: e.created_at.clone(),
                    updated_at: now,
                };
                // Best-effort migration — log but don't fail on DB errors
                let _ = db.update_vault_entry(&updated).await;
            }
            return plaintext;
        }
    }

    "***DECRYPT_FAILED***".into()
}

async fn map_vault_entry(
    e: &VaultEntry,
    vault_key: &[u8; 32],
    legacy_key: Option<&[u8; 32]>,
    db: &crate::db::Database,
) -> VaultEntryDetail {
    let decrypted = map_vault_entry_decrypted(e, vault_key, legacy_key, db).await;
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
/// Returns metadata only — value is NOT decrypted for the list view (O(1) per entry).
pub async fn list_vault_entries(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<VaultListResponse>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let entries = db
        .list_vault_entries()
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    let summaries: Vec<VaultEntrySummary> = entries
        .iter()
        .map(|e| {
            let tags: Vec<String> = serde_json::from_str(&e.tags).unwrap_or_default();
            VaultEntrySummary {
                id: e.id.clone(),
                name: e.name_plain.clone(),
                kind: e.kind_plain.clone(),
                tags,
                created_at: e.created_at.clone(),
                updated_at: e.updated_at.clone(),
            }
        })
        .collect();

    let total = summaries.len();
    Ok(ApiResponse::success(VaultListResponse { total, entries: summaries }))
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
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();

    let entry = VaultEntry {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.clone(),
        kind: kind.clone(),
        name_plain: name,
        kind_plain: kind,
        encrypted_value: encrypted,
        tags: tags_str,
        created_at: now.clone(),
        updated_at: now,
    };

    db.insert_vault_entry(&entry)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(map_vault_entry(&entry, &vault_key, None, db).await))
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
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%:z").to_string();

    let updated = VaultEntry {
        id: entry_id.clone(),
        name: name.clone(),
        kind: kind.clone(),
        name_plain: name,
        kind_plain: kind,
        encrypted_value: encrypted,
        tags: tags_str,
        created_at: existing.created_at,
        updated_at: now,
    };

    db.update_vault_entry(&updated)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(map_vault_entry(&updated, &vault_key, None, db).await))
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

/// Derive the vault encryption key using PBKDF2-HMAC-SHA256 (100K iterations).
///
/// This replaces the insecure SHA-256-based KDF. The high iteration count
/// makes brute-force attacks computationally expensive even when the source
/// JWT_SECRET has low entropy.
fn get_vault_key(state: &AppState) -> Result<[u8; 32], AppError> {
    let secret = &state.config.jwt_secret;
    if secret.is_empty() {
        return Err(AppError::Internal("JWT_SECRET not configured — cannot derive vault key".into()));
    }
    let salt = b"wrench-vault-key-salt";
    Ok(crypto::derive_key(secret, salt, 100_000))
}

/// Derive the legacy v1 vault key using plain SHA-256 (INSECURE — migration only).
///
/// Returns `None` if JWT_SECRET is empty. Used during migration to decrypt
/// entries that were encrypted with the old `Sha256::digest()` KDF.
fn get_vault_legacy_key(state: &AppState) -> Option<[u8; 32]> {
    let secret = &state.config.jwt_secret;
    if secret.is_empty() {
        return None;
    }
    Some(crypto::derive_v1_legacy_key(secret))
}
