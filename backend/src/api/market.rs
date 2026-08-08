use crate::app_state::AppState;
use axum::extract::State;
use axum::response::IntoResponse;
use std::sync::Arc;

/// A plugin listing from the marketplace index
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketPluginListing {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub icon: String,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub manifest_url: String,
    #[serde(default)]
    pub plugin_url: String,
    #[serde(default)]
    pub downloads: Option<u64>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// Get marketplace index (GET /api/market/index)
/// 策略：先尝试远程市场，失败则返回本地内置插件列表
pub async fn get_market_index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // 1. 尝试从远程市场获取
    if let Ok(index_url) = std::env::var("MARKET_INDEX_URL") {
        if !index_url.is_empty() {
            if let Ok(resp) = reqwest::get(&index_url).await {
                if resp.status().is_success() {
                    if let Ok(data) = resp.json::<serde_json::Value>().await {
                        if let Some(arr) = data.get("plugins").and_then(|v| v.as_array()) {
                            let mut plugins: Vec<MarketPluginListing> = arr
                                .iter()
                                .filter_map(|p| serde_json::from_value(p.clone()).ok())
                                .collect();
                            // 远程列表去重
                            let mut seen = std::collections::HashSet::new();
                            plugins.retain(|p| seen.insert(p.id.clone()));
                            if !plugins.is_empty() {
                                // 缓存
                                let manifests: Vec<crate::models::PluginManifest> = plugins
                                    .iter()
                                    .map(|p| crate::models::PluginManifest {
                                        id: p.id.clone(),
                                        name: p.name.clone(),
                                        version: p.version.clone(),
                                        description: p.description.clone(),
                                        author: p.author.clone(),
                                        icon: p.icon.clone(),
                                        commands: vec![],
                                        panels: vec![],
                                    })
                                    .collect();
                                *state.marketplace_cache.write() = Some(manifests);

                                return axum::Json(serde_json::json!({
                                    "plugins": plugins,
                                    "updated_at": chrono::Local::now().to_rfc3339(),
                                    "source": "remote"
                                }))
                                .into_response();
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. 远程不可用，从本地插件目录生成市场列表（自动去重）
    let plugins_dir = &state.config.plugins_dir;
    let mut plugins: Vec<MarketPluginListing> = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    if let Ok(entries) = std::fs::read_dir(plugins_dir) {
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let manifest_path = path.join("manifest.json");
            let js_path = path.join("plugin.js");
            if !js_path.exists() || !manifest_path.exists() {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) =
                    serde_json::from_str::<crate::models::PluginManifest>(&content)
                {
                    if !seen_ids.insert(manifest.id.clone()) {
                        continue; // 跳过重复 ID
                    }
                    plugins.push(MarketPluginListing {
                        id: manifest.id.clone(),
                        name: manifest.name.clone(),
                        version: manifest.version.clone(),
                        description: manifest.description.clone(),
                        author: manifest.author.clone(),
                        icon: manifest.icon.clone(),
                        tags: Some(vec!["内置".to_string()]),
                        manifest_url: String::new(),
                        plugin_url: String::new(),
                        downloads: None,
                        updated_at: None,
                    });
                }
            }
        }
    }

    // 缓存
    let manifests: Vec<crate::models::PluginManifest> = plugins
        .iter()
        .map(|p| crate::models::PluginManifest {
            id: p.id.clone(),
            name: p.name.clone(),
            version: p.version.clone(),
            description: p.description.clone(),
            author: p.author.clone(),
            icon: p.icon.clone(),
            commands: vec![],
            panels: vec![],
        })
        .collect();
    *state.marketplace_cache.write() = Some(manifests);

    axum::Json(serde_json::json!({
        "plugins": plugins,
        "updated_at": chrono::Local::now().to_rfc3339(),
        "source": "local"
    }))
    .into_response()
}
