//! api/system.rs — System maintenance endpoints
//!
//! Provides database info, backup download, and other system-level operations
//! accessible from the web UI.

use crate::app_state::AppState;
use crate::error::AppError;
use crate::response::ApiResponse;
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::Serialize;
use std::sync::Arc;

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

/// GET /api/system/db-info — Returns database path, size, and table row counts.
pub async fn db_info(State(state): State<Arc<AppState>>) -> Result<Json<ApiResponse<DbInfo>>, AppError> {
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
        .list_table_counts()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to query tables: {}", e)))?;
    let tables: Vec<TableInfo> = raw
        .into_iter()
        .map(|(name, count)| TableInfo { name, row_count: count })
        .collect();

    Ok(Json(ApiResponse::success(DbInfo { path, size_bytes, size_human, tables })))
}

/// GET /api/system/db-download — Download the SQLite database file.
pub async fn db_download(State(state): State<Arc<AppState>>) -> Result<impl IntoResponse, AppError> {
    let config = &state.config;
    let path = config
        .database_url
        .as_ref()
        .ok_or_else(|| AppError::NotFound("No persistent database configured".into()))?;

    if !std::path::Path::new(path).exists() {
        return Err(AppError::NotFound("Database file not found".into()));
    }

    let data = tokio::fs::read(path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read database: {}", e)))?;

    let filename = format!("wrench-{}.db", chrono::Utc::now().format("%Y%m%d_%H%M%S"));
    let content_type = "application/x-sqlite3".to_string();

    let headers = [
        (header::CONTENT_TYPE, content_type),
        (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename)),
    ];

    let mut response = axum::response::Response::new(axum::body::Body::from(data));
    *response.status_mut() = StatusCode::OK;
    for (name, value) in headers {
        response.headers_mut().insert(name, value.parse().unwrap());
    }
    Ok(response)
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
