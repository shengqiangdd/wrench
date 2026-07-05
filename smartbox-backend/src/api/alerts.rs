use axum::{extract::State, Json};
use std::sync::Arc;

use crate::api_types::AlertsResponse;
use crate::app_state::{AlertEntry, AppState};
use crate::response::ApiResponse;

/// List alerts (GET /api/alerts)
pub async fn list_alerts(State(state): State<Arc<AppState>>) -> ApiResponse<AlertsResponse> {
    let alerts = state.alerts.read();
    let total = alerts.len();
    let result: Vec<AlertEntry> = alerts.iter().rev().cloned().collect();

    ApiResponse::success(AlertsResponse { total, alerts: result })
}

/// Create alert (POST /api/alerts)
pub async fn create_alert(State(state): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> ApiResponse<()> {
    let msg = body.get("message").and_then(|v| v.as_str()).unwrap_or("");
    if msg.is_empty() {
        return ApiResponse::error(400, "message required");
    }

    let alert = AlertEntry {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        level: body
            .get("level")
            .and_then(|v| v.as_str())
            .unwrap_or("warning")
            .to_string(),
        host: body.get("host").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        metric: body.get("metric").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        message: msg.to_string(),
        value: body.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0),
        threshold: body.get("threshold").and_then(|v| v.as_f64()).unwrap_or(0.0),
    };

    state.add_alert(alert);
    ApiResponse::success_msg("Alert created")
}
