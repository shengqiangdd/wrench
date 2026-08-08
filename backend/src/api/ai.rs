//! AI / LLM Provider API — fetch available free models from providers.
//!
//! Supported providers: OpenRouter, OpenAI, SiliconFlow.
//!
//! Endpoints:
//!   GET  /api/ai/config            — Get global AI config
//!   GET  /api/ai/fetch-free-models — Fetch free models from OpenRouter
//!   GET  /api/ai/fetch-all-models  — Fetch models with optional `?provider=`
//!   POST /api/ai/chat              — Proxy chat completions to LLM provider

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{Response, StatusCode};
use serde::Deserialize;
use std::sync::Arc;

use crate::api_types::{AiConfigResponse, ModelListItem, ModelsListResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Determine if a model is free based on its pricing info.
/// Handles both OpenRouter format (`prompt`/`completion` as strings) and
/// generic format (`request` as f64).
fn is_free_model(pricing: &serde_json::Value) -> bool {
    // Try "prompt" field first (OpenRouter format: "0" as string)
    if let Some(prompt) = pricing.get("prompt").and_then(|v| v.as_str()) {
        if let Ok(val) = prompt.parse::<f64>() {
            if val > 0.0 {
                return false;
            }
        }
    }
    // Fallback to "request" field (generic format)
    if let Some(req) = pricing.get("request").and_then(|v| v.as_f64()) {
        if req > 0.0 {
            return false;
        }
    }
    // If neither field exists or both are 0, treat as free
    true
}

#[derive(Debug, Deserialize)]
pub struct ModelQuery {
    pub provider: Option<String>,
    /// Frontend-provided API key (fallback when server-side key is absent)
    pub api_key: Option<String>,
    /// Base URL for the provider (e.g. https://api.agnes.dev/v1)
    pub base_url: Option<String>,
}

/// Get AI config (GET /api/ai/config)
pub async fn get_ai_config(State(state): State<Arc<AppState>>) -> ApiResponse<AiConfigResponse> {
    let api_key_hint = state.config.openrouter_api_key.as_ref().map(|k| {
        if k.len() <= 8 {
            "*".repeat(k.len())
        } else {
            format!("{}...{}", &k[..4], &k[k.len() - 4..])
        }
    });

    ApiResponse::success(AiConfigResponse {
        enabled: state.config.openrouter_api_key.is_some(),
        provider: "openrouter".into(),
        models: Vec::new(),
        api_key_hint,
    })
}

/// Fetch free models from OpenRouter (GET /api/ai/fetch-free-models)
pub async fn fetch_free_models(
    State(state): State<Arc<AppState>>,
) -> ApiResponse<ModelsListResponse> {
    let api_key = state.config.openrouter_api_key.clone();

    let client = reqwest::Client::new();
    let mut req_builder = client.get("https://openrouter.ai/api/v1/models");

    if let Some(ref key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    match req_builder.send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                let data: serde_json::Value = resp.json().await.unwrap_or_default();
                let models = data
                    .get("data")
                    .and_then(|d| d.as_array())
                    .cloned()
                    .unwrap_or_default();
                let free_models: Vec<ModelListItem> = models
                    .into_iter()
                    .filter(|m| {
                        let pricing = m.get("pricing").cloned().unwrap_or_default();
                        is_free_model(&pricing)
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
                        description: m
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                    })
                    .collect();

                ApiResponse::success(ModelsListResponse {
                    models: free_models,
                    error: None,
                })
            } else {
                ApiResponse::success(ModelsListResponse {
                    models: Vec::new(),
                    error: Some("Failed to fetch models from OpenRouter".into()),
                })
            }
        }
        Err(e) => ApiResponse::success(ModelsListResponse {
            models: Vec::new(),
            error: Some(e.to_string()),
        }),
    }
}

/// Fetch models for any provider (GET /api/ai/fetch-all-models?provider=openrouter&api_key=xxx&base_url=xxx)
pub async fn fetch_all_models(
    State(state): State<Arc<AppState>>,
    Query(params): Query<ModelQuery>,
) -> ApiResponse<ModelsListResponse> {
    let provider = params.provider.as_deref().unwrap_or("openrouter");

    // Resolve API key: query param > server env
    let resolved_key = params.api_key.as_deref().or(state.config.openrouter_api_key.as_deref());

    // If base_url is provided, use generic OpenAI-compatible fetch (works for any provider)
    let result = if let Some(base_url) = &params.base_url {
        fetch_models_from_url(base_url, resolved_key).await
    } else {
        match provider {
            "openrouter" => fetch_openrouter_models(&state, resolved_key).await,
            "openai" => fetch_openai_models().await,
            "siliconflow" => fetch_siliconflow_models().await,
            other => ModelsListResponse {
                models: Vec::new(),
                error: Some(format!("Unknown provider: {}", other)),
            },
        }
    };

    ApiResponse::success(result)
}

async fn fetch_openrouter_models(
    state: &AppState,
    api_key_override: Option<&str>,
) -> ModelsListResponse {
    let api_key = api_key_override
        .map(|k| k.to_string())
        .or_else(|| state.config.openrouter_api_key.clone());

    let client = reqwest::Client::new();
    let mut req_builder = client.get("https://openrouter.ai/api/v1/models");

    // Only add Authorization if we have a key
    if let Some(ref key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    match req_builder.send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = data
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| {
                    let pricing = m.get("pricing").cloned().unwrap_or_default();
                    ModelListItem {
                        value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        label: m
                            .get("name")
                            .or_else(|| m.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        free: is_free_model(&pricing),
                        description: None,
                    }
                })
                .collect();
            ModelsListResponse {
                models: items,
                error: None,
            }
        }
        Ok(resp) => ModelsListResponse {
            models: Vec::new(),
            error: Some(format!("HTTP {}", resp.status())),
        },
        Err(e) => ModelsListResponse {
            models: Vec::new(),
            error: Some(e.to_string()),
        },
    }
}

async fn fetch_openai_models() -> ModelsListResponse {
    let client = reqwest::Client::new();
    match client.get("https://api.openai.com/v1/models").send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = data
                .get("data")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| ModelListItem {
                    value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    label: m
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    free: true,
                    description: None,
                })
                .collect();
            ModelsListResponse {
                models: items,
                error: None,
            }
        }
        Ok(resp) => ModelsListResponse {
            models: Vec::new(),
            error: Some(format!("HTTP {}", resp.status())),
        },
        Err(e) => ModelsListResponse {
            models: Vec::new(),
            error: Some(e.to_string()),
        },
    }
}

async fn fetch_siliconflow_models() -> ModelsListResponse {
    let client = reqwest::Client::new();
    match client
        .get("https://api.siliconflow.cn/v1/models")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            let models = if let Some(arr) = data.as_array() {
                arr.clone()
            } else if let Some(arr) = data.get("data").and_then(|d| d.as_array()) {
                arr.clone()
            } else {
                Vec::new()
            };
            let items: Vec<ModelListItem> = models
                .into_iter()
                .map(|m| {
                    let pricing = m.get("pricing").cloned().unwrap_or_default();
                    ModelListItem {
                        value: m.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        label: m
                            .get("name")
                            .or_else(|| m.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        free: is_free_model(&pricing),
                        description: None,
                    }
                })
                .collect();
            ModelsListResponse {
                models: items,
                error: None,
            }
        }
        Ok(resp) => ModelsListResponse {
            models: Vec::new(),
            error: Some(format!("HTTP {}", resp.status())),
        },
        Err(e) => ModelsListResponse {
            models: Vec::new(),
            error: Some(e.to_string()),
        },
    }
}

/// Generic fetch models from any OpenAI-compatible `/v1/models` endpoint
async fn fetch_models_from_url(base_url: &str, api_key: Option<&str>) -> ModelsListResponse {
    let models_url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut req_builder = client.get(&models_url);

    if let Some(key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    match req_builder.send().await {
        Ok(resp) if resp.status().is_success() => {
            let data: serde_json::Value = resp.json().await.unwrap_or_default();
            // OpenAI-compatible: { "data": [{ "id": "...", "name": "..." }] }
            // Some APIs return flat array: [{ "id": "..." }]
            let models = if let Some(arr) = data.get("data").and_then(|d| d.as_array()) {
                arr.clone()
            } else if let Some(arr) = data.as_array() {
                arr.clone()
            } else {
                Vec::new()
            };
            let items: Vec<ModelListItem> = models
                .into_iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(|v| v.as_str())?;
                    let pricing = m.get("pricing").cloned().unwrap_or_default();
                    Some(ModelListItem {
                        value: id.to_string(),
                        label: m
                            .get("name")
                            .or_else(|| m.get("id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or(id)
                            .to_string(),
                        free: is_free_model(&pricing),
                        description: None,
                    })
                })
                .collect();
            ModelsListResponse {
                models: items,
                error: None,
            }
        }
        Ok(resp) => ModelsListResponse {
            models: Vec::new(),
            error: Some(format!("HTTP {}", resp.status())),
        },
        Err(e) => ModelsListResponse {
            models: Vec::new(),
            error: Some(format!("{} ({})", e, models_url)),
        },
    }
}

// ─── Chat Proxy ───

/// POST body for /api/ai/chat — mirrors OpenRouter chat completions format
#[derive(Deserialize)]
pub struct ChatRequest {
    pub model: Option<String>,
    pub messages: Option<Vec<serde_json::Value>>,
    pub stream: Option<bool>,
    pub max_tokens: Option<u32>,
    /// Frontend-provided API key (fallback to server-side OPENROUTER_API_KEY)
    pub api_key: Option<String>,
    /// Base URL override (defaults to OpenRouter)
    pub base_url: Option<String>,
}

/// Proxy chat completions to the LLM provider (POST /api/ai/chat)
///
/// The backend uses its own OPENROUTER_API_KEY when the frontend doesn't
/// provide one, so users don't need to configure a key themselves.
pub async fn chat_proxy(
    State(state): State<Arc<AppState>>,
    axum::Json(req): axum::Json<ChatRequest>,
) -> Response<Body> {
    // Resolve API key: frontend > server env (optional — some platforms don't need one)
    let api_key = req
        .api_key
        .filter(|k| !k.is_empty())
        .or_else(|| state.config.openrouter_api_key.clone());

    let base_url = req
        .base_url
        .as_deref()
        .unwrap_or("https://openrouter.ai/api/v1");
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let model = req
        .model
        .unwrap_or_else(|| "google/gemma-4-31b-it:free".into());
    let messages = req.messages.unwrap_or_default();
    let stream = req.stream.unwrap_or(false);

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": stream,
        "max_tokens": req.max_tokens.unwrap_or(4096),
    });

    let client = reqwest::Client::new();
    let mut req_builder = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("HTTP-Referer", "https://wrench.app")
        .header("X-Title", "Wrench")
        .body(body.to_string());

    // Only add Authorization if we have a key (some platforms don't need one)
    if let Some(ref key) = api_key {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", key));
    }

    let resp = match req_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(
                    serde_json::json!({ "error": e.to_string() }).to_string(),
                ))
                .unwrap();
        }
    };

    let status = resp.status();
    let content_type = resp
        .headers()
        .get("content-type")
        .cloned();

    if stream {
        // Streaming: forward the SSE stream directly
        let mut builder = Response::builder().status(status.as_u16());
        if let Some(ct) = content_type {
            builder = builder.header("content-type", ct);
        }
        builder
            .body(Body::from_stream(resp.bytes_stream()))
            .unwrap()
    } else {
        // Non-streaming: forward the full response
        let bytes = resp.bytes().await.unwrap_or_default();
        let body_str = String::from_utf8_lossy(&bytes);

        // If upstream returned an error status, wrap in a JSON envelope
        // so the frontend can always parse the response as JSON
        if !status.is_success() {
            let error_body = serde_json::json!({
                "error": {
                    "message": body_str.trim(),
                    "status": status.as_u16(),
                    "code": status.canonical_reason().unwrap_or("Unknown"),
                }
            });
            return Response::builder()
                .status(status.as_u16())
                .header("content-type", "application/json")
                .body(Body::from(error_body.to_string()))
                .unwrap();
        }

        let mut builder = Response::builder().status(status.as_u16());
        if let Some(ct) = content_type {
            builder = builder.header("content-type", ct);
        }
        builder.body(Body::from(bytes)).unwrap()
    }
}
