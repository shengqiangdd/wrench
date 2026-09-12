//! api/system.rs — System maintenance endpoints
//!
//! Provides database info, backup download, and other system-level operations
//! accessible from the web UI.

use crate::app_state::AppState;
use crate::error::AppError;
use crate::response::ApiResponse;
use axum::{
    Json,
    extract::{Extension, State},
};
use serde::Serialize;
use std::sync::Arc;

use crate::space::SpaceCtx;

/// Database info response.
#[derive(Debug, Serialize)]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub size_human: String,
    pub tables: Vec<TableInfo>,
}

#[derive(Debug, Serialize)]
pub struct TableInfo {
    pub name: String,
    pub row_count: i64,
}

/// GET /api/system/db-info — Returns database size and **本空间** row counts.
///
/// 注意：绝不返回数据库文件本身。多人共用下一个整库下载等于把所有人的
/// SSH 凭据与 Vault 交给任意访客，因此 `/system/db-download` 已被移除。
pub async fn db_info(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> Result<Json<ApiResponse<DbInfo>>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("No persistent database configured".into()))?;

    // Get database path from the underlying connection
    let path = {
        let config = &state.config;
        config.database_url.clone().unwrap_or_else(|| ":memory:".into())
    };

    // Get file size
    let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let size_human = byte_size_human(size_bytes);

    // Get table info
    let raw = db
        .list_table_counts(&space.id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to query tables: {}", e)))?;
    let tables: Vec<TableInfo> = raw
        .into_iter()
        .map(|(name, count)| TableInfo { name, row_count: count })
        .collect();

    Ok(Json(ApiResponse::success(DbInfo { path, size_bytes, size_human, tables })))
}

fn byte_size_human(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
    let mut size = bytes as f64;
    let mut unit_idx = 0;
    while size > 1024.0 && unit_idx < UNITS.len() - 1 {
        size /= 1024.0;
        unit_idx += 1;
    }
    format!("{:.1} {}", size, UNITS[unit_idx])
}
