use axum::{extract::State, Json};
use std::sync::Arc;

use crate::app_state::{AlertEntry, AppState};
use crate::response::ApiResponse;

/// List alerts (GET /api/alerts)
pub async fn list_alerts(
    State(state): State<Arc<AppState>>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> ApiResponse<serde_json::Value> {
    let limit: usize = params
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(50)
        .min(500);

    let level = params.get("level");
    let host = params.get("host");

    let alerts = state.alerts.read();
    let mut result: Vec<AlertEntry> = alerts.iter().rev().cloned().collect();

    if let Some(lvl) = level {
        result.retain(|a| a.level == *lvl);
    }
    if let Some(h) = host {
        result.retain(|a| a.host == *h);
    }
    result.truncate(limit);

    ApiResponse::success(serde_json::json!({
        "total": result.len(),
        "alerts": result
    }))
}

/// Create an alert (POST /api/alerts)
pub async fn create_alert(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> ApiResponse<serde_json::Value> {
    let message = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if message.is_empty() {
        return ApiResponse::error(400, "message required");
    }

    let clamp = |s: &str, max: usize| -> String { s.chars().take(max).collect() };

    let entry = AlertEntry {
        id: format!("{:x}", chrono::Utc::now().timestamp_millis())
            + &uuid::Uuid::new_v4().to_string()[..4],
        timestamp: chrono::Utc::now().to_rfc3339(),
        level: body
            .get("level")
            .and_then(|v| v.as_str())
            .unwrap_or("warning")
            .to_string(),
        host: clamp(
            body.get("host").and_then(|v| v.as_str()).unwrap_or("unknown"),
            128,
        ),
        metric: clamp(
            body.get("metric").and_then(|v| v.as_str()).unwrap_or("custom"),
            32,
        ),
        message: clamp(&message, 1024),
        value: body.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0),
        threshold: body
            .get("threshold")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
    };

    state.add_alert(entry);
    ApiResponse::success_msg("Alert created")
}
