use crate::app_state::AppState;
use axum::extract::State;
use axum::http::StatusCode;
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
    pub tags: Option<Vec<String>>,
    pub manifest_url: String,
    pub plugin_url: String,
    pub downloads: Option<u64>,
    pub updated_at: Option<String>,
}

/// Marketplace index response
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketIndex {
    pub plugins: Vec<MarketPluginListing>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Fetch marketplace index from remote source
async fn fetch_marketplace_index_inner() -> Result<Vec<MarketPluginListing>, String> {
    // Default marketplace index URL — replace with actual marketplace URL
    let index_url = "https://wrench-market.example.com/index.json";

    let resp = reqwest::get(index_url)
        .await
        .map_err(|e| format!("Failed to fetch marketplace index: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Marketplace index returned status: {}", resp.status()));
    }

    let index: MarketIndex = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse marketplace index: {}", e))?;

    Ok(index.plugins)
}

/// Get marketplace index (GET /api/market/index)
pub async fn get_market_index(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    // Check cache first
    {
        let cache = state.marketplace_cache.read();
        if let Some(cached) = cache.as_ref() {
            if !cached.is_empty() {
                // Return cached data serialized as MarketPluginListing-compatible format
                let listings: Vec<MarketPluginListing> = cached
                    .iter()
                    .map(|p| MarketPluginListing {
                        id: p.id.clone(),
                        name: p.name.clone(),
                        version: p.version.clone(),
                        description: p.description.clone(),
                        author: p.author.clone(),
                        icon: p.icon.clone(),
                        tags: None,
                        manifest_url: String::new(),
                        plugin_url: String::new(),
                        downloads: None,
                        updated_at: None,
                    })
                    .collect();
                drop(cache);
                return axum::Json(serde_json::json!({
                    "plugins": listings,
                    "message": "Cached marketplace index"
                }))
                .into_response();
            }
        }
    }

    // Fetch from remote
    let plugins = match fetch_marketplace_index_inner().await {
        Ok(p) => p,
        Err(e) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to fetch marketplace: {}", e)).into_response();
        }
    };

    // Convert to PluginManifest and cache
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

    {
        *state.marketplace_cache.write() = Some(manifests);
    }

    axum::Json(serde_json::json!({
        "plugins": plugins,
        "updated_at": chrono::Utc::now().to_rfc3339()
    }))
    .into_response()
}
