use axum::extract::State;
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
/// Downloads manifest.json and plugin.js from provided URLs
pub async fn install_plugin(
    State(state): State<Arc<AppState>>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> Result<ApiResponse<serde_json::Value>, AppError> {
    let plugin_id = body
        .get("pluginId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let manifest_url = body
        .get("manifestUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let plugin_url = body
        .get("pluginUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if plugin_id.is_empty() {
        return Err(AppError::BadRequest("Missing pluginId".into()));
    }
    if manifest_url.is_empty() {
        return Err(AppError::BadRequest("Missing manifestUrl".into()));
    }
    if plugin_url.is_empty() {
        return Err(AppError::BadRequest("Missing pluginUrl".into()));
    }

    // Validate plugin ID (path traversal protection)
    let target_dir = state
        .safe_plugin_path(plugin_id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    // Create the plugin directory
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create plugin dir: {}", e)))?;

    // Download manifest.json
    let manifest_content = reqwest::get(manifest_url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to download manifest: {}", e)))?
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read manifest: {}", e)))?;

    // Download plugin.js
    let plugin_content = reqwest::get(plugin_url)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to download plugin: {}", e)))?
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read plugin: {}", e)))?;

    // Write manifest.json
    tokio::fs::write(target_dir.join("manifest.json"), &manifest_content)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write manifest: {}", e)))?;

    // Write plugin.js
    tokio::fs::write(target_dir.join("plugin.js"), &plugin_content)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write plugin: {}", e)))?;

    // Invalidate marketplace cache
    *state.marketplace_cache.write() = None;

    Ok(ApiResponse::success(serde_json::json!({
        "success": true,
        "pluginId": plugin_id,
        "message": format!("Plugin '{}' installed successfully", plugin_id),
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
        return Err(AppError::BadRequest("Missing plugin_id".into()));
    }

    let target = state
        .safe_plugin_path(&plugin_id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    if !target.exists() {
        return Err(AppError::NotFound(format!(
            "Plugin '{}' not found",
            plugin_id
        )));
    }

    std::fs::remove_dir_all(&target)?;

    Ok(ApiResponse::success(serde_json::json!({
        "success": true,
        "pluginId": plugin_id,
        "message": format!("Plugin '{}' uninstalled", plugin_id),
    })))
}

/// Get plugin JS file (GET /api/plugins/{id}/plugin.js)
pub async fn get_plugin_js(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let target = state
        .safe_plugin_path(&id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    let js_path = target.join("plugin.js");
    if !js_path.exists() {
        return Err(AppError::NotFound(format!("Plugin '{}' JS not found", id)));
    }

    let content = tokio::fs::read_to_string(&js_path).await?;

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/javascript; charset=utf-8")
        .header(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        )
        .body(axum::body::Body::from(content))
        .unwrap())
}

/// Get plugin manifest (GET /api/plugins/{id}/manifest.json)
pub async fn get_plugin_manifest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<axum::response::Response, AppError> {
    let target = state
        .safe_plugin_path(&id)
        .ok_or_else(|| AppError::BadRequest("Invalid plugin ID".into()))?;

    let manifest_path = target.join("manifest.json");
    if !manifest_path.exists() {
        return Err(AppError::NotFound(format!(
            "Plugin '{}' manifest not found",
            id
        )));
    }

    let content = tokio::fs::read_to_string(&manifest_path).await?;

    Ok(axum::response::Response::builder()
        .header("Content-Type", "application/json; charset=utf-8")
        .header(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate",
        )
        .body(axum::body::Body::from(content))
        .unwrap())
}
