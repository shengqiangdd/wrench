use axum::extract::State;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::api_types::MetricsResponse;
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Get monitoring metrics (GET /api/metrics)
pub async fn get_metrics(State(state): State<Arc<AppState>>) -> ApiResponse<MetricsResponse> {
    ApiResponse::success(MetricsResponse {
        hosts: Vec::new(),
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        exec_started: state.exec_metrics.started.load(std::sync::atomic::Ordering::Relaxed),
        exec_completed: state.exec_metrics.completed.load(std::sync::atomic::Ordering::Relaxed),
        exec_cancelled: state.exec_metrics.cancelled.load(std::sync::atomic::Ordering::Relaxed),
        exec_active: state.exec_cancellations.len(),
    })
}
