use axum::{extract::State};
use std::sync::Arc;

use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Get AI config (GET /api/ai/config)
pub async fn get_ai_config(State(state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    ApiResponse::success(serde_json::json!({
        "apiKey": state.config.openrouter_api_key.as_deref().unwrap_or("")
    }))
}

/// Fetch free models from OpenRouter (GET /api/ai/fetch-free-models)
pub async fn fetch_free_models(State(state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    let api_key = match &state.config.openrouter_api_key {
        Some(k) => k.clone(),
        None => {
            return ApiResponse::error(503, "OpenRouter API Key 未配置");
        }
    };

    let client = reqwest::Client::new();
    match client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(resp) => {
            if resp.status().is_success() {
                let data: serde_json::Value = resp.json().await.unwrap_or_default();
                let models = data.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
                let free_models: Vec<serde_json::Value> = models
                    .into_iter()
                    .filter(|m| {
                        m.get("pricing")
                            .and_then(|p| p.get("request"))
                            .and_then(|r| r.as_f64())
                            .map(|v| v <= 0.0)
                            .unwrap_or(false)
                    })
                    .map(|m| {
                        serde_json::json!({
                            "value": m.get("id"),
                            "label": m.get("name").or(m.get("id")),
                            "free": true,
                            "description": m.get("description").unwrap_or(&serde_json::Value::Null),
                        })
                    })
                    .collect();

                ApiResponse::success(serde_json::json!({ "models": free_models }))
            } else {
                ApiResponse::error(502, "Failed to fetch models from OpenRouter")
            }
        }
        Err(e) => {
            ApiResponse::success(serde_json::json!({
                "models": [],
                "error": e.to_string()
            }))
        }
    }
}

/// Fetch all models (GET /api/ai/fetch-all-models)
pub async fn fetch_all_models(State(state): State<Arc<AppState>>) -> ApiResponse<serde_json::Value> {
    fetch_free_models(State(state)).await
}
