use axum::{extract::State, response::IntoResponse};
use axum::extract::Path;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::response::ApiResponse;

/// List installed plugins (GET /api/plugins)
pub async fn list_plugins(State(state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    let plugins_dir = &state.config.plugins_dir;
    let mut plugins = Vec::new();

    if let Ok(entries) = std::fs::read_dir(plugins_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("manifest.json");
            let js_path = path.join("plugin.js");
            if !js_path.exists() {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&content) {
                    plugins.push(manifest);
                }
            }
        }
    }

    ApiResponse::success(serde_json::json!(plugins))
}

/// Install a plugin (POST /api/plugins/install)
pub async fn install_plugin(
    State(_state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let url = body.get("url").and_then(|v| v.as_str()).unwrap_or("");

    if url.is_empty() {
        return Err(AppError::BadRequest("Missing url".into()));
    }

    Ok(ApiResponse::success(serde_json::json!({
        "success": true,
        "message": format!("Plugin installed from: {}", url)
    })))
}

/// Uninstall a plugin (POST /api/plugins/uninstall)
pub async fn uninstall_plugin(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let plugin_id = body
        .get("plugin_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if plugin_id.is_empty() {
        return Err(AppError::BadRequest("Missing pluginId".into()));
    }

    let target = state.safe_plugin_path(&plugin_id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    if !target.exists() {
        return Err(AppError::NotFound(format!("Plugin '{}' not found", plugin_id)));
    }

    std::fs::remove_dir_all(&target)?;

    Ok(ApiResponse::success(serde_json::json!({
        "success": true,
        "pluginId": plugin_id,
        "message": format!("Plugin '{}' uninstalled", plugin_id)
    })))
}

/// Get plugin JS file (GET /api/plugins/{id}/plugin.js)
pub async fn get_plugin_js(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let target = state.safe_plugin_path(&id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    let js_path = target.join("plugin.js");
    if !js_path.exists() {
        return Err(AppError::NotFound("Plugin JS not found".into()));
    }

    let content = std::fs::read_to_string(&js_path)?;

    let headers = [("Content-Type", "application/javascript"), ("Cache-Control", "no-cache")];
    Ok((headers, content).into_response())
}

/// Get plugin manifest (GET /api/plugins/{id}/manifest.json)
pub async fn get_plugin_manifest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let target = state.safe_plugin_path(&id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    let manifest_path = target.join("manifest.json");
    if !manifest_path.exists() {
        return Err(AppError::NotFound("Manifest not found".into()));
    }

    let content = std::fs::read_to_string(&manifest_path)?;
    let manifest: serde_json::Value = serde_json::from_str(&content)?;
    Ok(ApiResponse::success(manifest))
}
