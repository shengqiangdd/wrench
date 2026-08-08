use axum::extract::State;
use std::sync::Arc;

use crate::api_types::{ConnectionsInfo, HealthResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

/// Enhanced health check (GET /api/health)
pub async fn health_check(State(state): State<Arc<AppState>>) -> ApiResponse<HealthResponse> {
    let conn_count = state.connections.len();
    ApiResponse::success(HealthResponse {
        status: "ok".into(),
        uptime: state.start_time.elapsed().as_secs(),
        version: env!("CARGO_PKG_VERSION"),
        connections: ConnectionsInfo { active: conn_count },
    })
}
