use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use std::sync::Arc;
use tracing::info;

use crate::app_state::AppState;

/// WebSocket Docker stats handler (/ws/docker/stats)
///
/// This endpoint is **deprecated**. Docker stats are now served via the
/// REST API `GET /api/docker/stats`. The WebSocket handler sends a
/// deprecation notice and closes the connection immediately.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> axum::response::Response {
    // 统一走 WS 并发闸门（这条虽是 legacy stub，也不能成为绕过闸门的入口）。
    let Some(slot) = state.try_open_ws() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": "Too many open WebSocket connections on this instance. Please retry later.",
                "code": "ws_limit_reached",
            })),
        )
            .into_response();
    };
    ws.on_upgrade(move |socket| async move {
        let _slot = slot;
        handle_docker_stats_socket(socket).await
    })
}

async fn handle_docker_stats_socket(mut socket: WebSocket) {
    info!("Docker stats WebSocket connected (legacy stub — closing)");
    let msg = serde_json::json!({
        "type": "error",
        "message": "Docker stats WebSocket is deprecated. Use REST API /api/docker/stats instead."
    });
    let _ = socket
        .send(Message::Text(serde_json::to_string(&msg).unwrap().into()))
        .await;
    let _ = socket.send(Message::Close(None)).await;
}
