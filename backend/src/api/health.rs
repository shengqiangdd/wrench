use axum::extract::State;
use std::sync::Arc;

use crate::api_types::{ConnectionsInfo, HealthResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;

const BUILD_INFO_PATH: &str = "/app/.build-info";

fn build_info_value(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key)
            .then(|| value.trim().to_owned())
            .filter(|value| !value.is_empty() && value != "0")
    })
}

fn configured_build_value(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty() && value != "0")
}

/// Return a public, non-secret deployment identifier for health/debugging.
///
/// Runtime configuration wins, followed by the image's build-info file. The
/// package version remains the local/dev fallback when no image metadata was
/// supplied.
fn build_version() -> String {
    configured_build_value("WRENCH_VERSION")
        .or_else(|| configured_build_value("BUILD_HASH"))
        .or_else(|| {
            std::fs::read_to_string(BUILD_INFO_PATH)
                .ok()
                .and_then(|contents| build_info_value(&contents, "BUILD_HASH"))
        })
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_owned())
}

/// Enhanced health check (GET /api/health)
pub async fn health_check(State(state): State<Arc<AppState>>) -> ApiResponse<HealthResponse> {
    let conn_count = state.connections.len();
    ApiResponse::success(HealthResponse {
        status: "ok".into(),
        uptime: state.start_time.elapsed().as_secs(),
        version: env!("CARGO_PKG_VERSION"),
        build: build_version(),
        connections: ConnectionsInfo { active: conn_count },
    })
}

#[cfg(test)]
mod tests {
    use super::build_info_value;

    #[test]
    fn build_info_parser_ignores_empty_and_default_values() {
        let info = "BUILD_HASH=0\nBUILD_TIME=2026-09-20T00:00:00Z\n";
        assert_eq!(build_info_value(info, "BUILD_HASH"), None);
        assert_eq!(build_info_value("BUILD_HASH=abc123\n", "BUILD_HASH"), Some("abc123".into()));
    }
}
