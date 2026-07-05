//! AI / LLM Provider API — fetch available free models from providers.
//!
//! Supported providers: OpenRouter, OpenAI, SiliconFlow.
//!
//! Endpoints:
//!   GET /api/ai/config            — Get global AI config
//!   GET /api/ai/fetch-free-models — Fetch free models from OpenRouter
//!   GET /api/ai/fetch-all-models  — Fetch models with optional `?provider=`

use axum::{extract::Query, extract::State};
use serde::Deserialize;
use std::sync::Arc;

use crate::api_types::{AiConfigResponse, ModelListItem, ModelsListResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

#[derive(Debug, Deserialize)]
pub struct ModelQuery {
    pub provider: Option<String>,
}

/// Get AI config (GET /api/ai/config)
pub async fn get_ai_config(State(state): State<Arc<AppState>>) -> ApiResponse<AiConfigResponse> {
    ApiResponse::success(AiConfigResponse {
        enabled: state.config.openrouter_api_key.is_some(),
        provider: "openrouter".into(),
        models: Vec::new(),
    })
}

/// Fetch free models from OpenRouter (GET /api/ai/fetch-free-models)
pub async fn fetch_free_models(State(state): State<Arc<AppState>>) -> ApiResponse<ModelsListResponse> {
    let api_key = match &state.config.openrouter_api_key {
        Some(k) => k.clone(),
        None => {
            return ApiResponse::success(ModelsListResponse {
                models: Vec::new(),
                error: Some("OpenRouter API Key 未配置".into()),
            });
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
                let free_models: Vec<ModelListItem> = models
                    .into_iter()
                    .filter(|m| {
                        m.get("pricing")
                            .and_then(|p| p.get("request"))
                            .and_then(|r| r.as_f64())
                            .map(|v| v <= 0.0)
                            .unwrap_or(false)
                    })
                    .map(|m| ModelListItem {
                        value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        label: m
                            .get("name")
                            .or_else(|| m.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        free: true,
                        description: m.get("description").and_then(|v| v.as_str()).map(String::from),
                    })
                    .collect();

                ApiResponse::success(ModelsListResponse { models: free_models, error: None })
            } else {
                ApiResponse::success(ModelsListResponse {
                    models: Vec::new(),
                    error: Some("Failed to fetch models from OpenRouter".into()),
                })
            }
        }
        Err(e) => ApiResponse::success(ModelsListResponse { models: Vec::new(), error: Some(e.to_string()) }),
    }
}

/// Fetch models for any provider (GET /api/ai/fetch-all-models?provider=openrouter)
pub async fn fetch_all_models(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ModelQuery>,
) -> ApiResponse<ModelsListResponse> {
    let provider = params.provider.as_deref().unwrap_or("openrouter");

    let result = match provider {
        "openrouter" => fetch_openrouter_models(&state).await,
        "openai" => fetch_openai_models().await,
        "siliconflow" => fetch_siliconflow_models().await,
        other => ModelsListResponse { models: Vec::new(), error: Some(format!("Unknown provider: {}", other)) },
    };

    ApiResponse::success(result)
}

async fn fetch_openrouter_models(state: &AppState) -> ModelsListResponse {
    let api_key = match &state.config.openrouter_api_key {
        Some(k) => k,
        None => {
            return ModelsListResponse { models: Vec::new(), error: Some("API key not configured".into()) };
        }
    };

    let client = reqwest::Client::new();
    match client
        .get("https://openrouter.ai/api/v1/models")
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = data.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| ModelListItem {
                    value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    label: m
                        .get("name")
                        .or_else(|| m.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    free: m
                        .get("pricing")
                        .and_then(|p| p.get("request"))
                        .and_then(|r| r.as_f64())
                        .map(|v| v <= 0.0)
                        .unwrap_or(false),
                    description: None,
                })
                .collect();
            ModelsListResponse { models: items, error: None }
        }
        Ok(resp) => ModelsListResponse { models: Vec::new(), error: Some(format!("HTTP {}", resp.status())) },
        Err(e) => ModelsListResponse { models: Vec::new(), error: Some(e.to_string()) },
    }
}

async fn fetch_openai_models() -> ModelsListResponse {
    let client = reqwest::Client::new();
    match client.get("https://api.openai.com/v1/models").send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = data.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| ModelListItem {
                    value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    label: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    free: true,
                    description: None,
                })
                .collect();
            ModelsListResponse { models: items, error: None }
        }
        Ok(resp) => ModelsListResponse { models: Vec::new(), error: Some(format!("HTTP {}", resp.status())) },
        Err(e) => ModelsListResponse { models: Vec::new(), error: Some(e.to_string()) },
    }
}

async fn fetch_siliconflow_models() -> ModelsListResponse {
    let client = reqwest::Client::new();
    match client.get("https://api.siliconflow.cn/v1/models").send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            // SiliconFlow returns an array directly
            let models = if let Some(arr) = data.as_array() {
                arr.clone()
            } else if let Some(arr) = data.get("data").and_then(|d| d.as_array()) {
                arr.clone()
            } else {
                Vec::new()
            };
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| ModelListItem {
                    value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    label: m
                        .get("name")
                        .or_else(|| m.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    free: m
                        .get("pricing")
                        .and_then(|p| p.get("request"))
                        .and_then(|r| r.as_f64())
                        .map(|v| v <= 0.0)
                        .unwrap_or(true),
                    description: None,
                })
                .collect();
            ModelsListResponse { models: items, error: None }
        }
        Ok(resp) => ModelsListResponse { models: Vec::new(), error: Some(format!("HTTP {}", resp.status())) },
        Err(e) => ModelsListResponse { models: Vec::new(), error: Some(e.to_string()) },
    }
}
